'use server'

import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getCurrentUserId } from '@/lib/supabaseServer'

export async function joinProjectSafe(projectId: string) {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')

  // 1) Reuse existing participant if present
  const { data: existing, error: qErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .limit(1)

  if (qErr) throw new Error(`participants select: ${qErr.message}`)

  let participantId = existing?.[0]?.id as string | undefined

  // 2) Otherwise create a participant (role must be 'member' per CHECK)
  if (!participantId) {
    const payload = {
      project_id: projectId,
      user_id: uid,
      role: 'member',
      short_code: null,
    }

    console.log('[joinProjectSafe] inserting participant payload =', payload)

    const { data: ins, error: iErr } = await supabaseAdmin
      .from('participants')
      .insert(payload)
      .select('id, role')
      .single()

    if (iErr) {
      console.error('[joinProjectSafe] insert error', iErr)
      throw new Error(
        `participants insert: ${iErr.message} (code ${iErr.code}, details ${JSON.stringify(
          iErr.details
        )}, hint ${iErr.hint || 'none'})`
      )
    }

    console.log('[joinProjectSafe] inserted participant', ins?.id, 'role=', ins?.role)
    participantId = ins!.id
  }

  // 3) Clone active user-level payment links into this participant (skip dups)
  const [{ data: myUPOs, error: uErr }, { data: existingPOs, error: eErr }] =
    await Promise.all([
      supabaseAdmin
        .from('user_payment_options')
        .select('type,label,value,priority,is_active')
        .eq('user_id', uid)
        .eq('is_active', true),
      supabaseAdmin
        .from('payment_options')
        .select('type,value,participant_id')
        .eq('participant_id', participantId!),
    ])

  if (uErr) throw new Error(`user_payment_options select: ${uErr.message}`)
  if (eErr) throw new Error(`payment_options select: ${eErr.message}`)

  const existingPairs = new Set((existingPOs ?? []).map(po => `${po.type}::${po.value}`))

  const rows =
    (myUPOs ?? [])
      .filter(x => x.is_active)
      .filter(x => !existingPairs.has(`${x.type}::${x.value}`))
      .map(x => ({
        project_id: projectId,
        participant_id: participantId!,
        type: x.type as 'revolut' | 'swedbank' | 'iban',
        label: x.label,
        value: x.value,
        priority: x.priority ?? 1,
        is_active: true,
      }))

  console.log('[joinProjectSafe] payment_options rows about to insert', rows)

  if (rows.length > 0) {
    const { error: pErr } = await supabaseAdmin.from('payment_options').insert(rows)
    if (pErr) {
      throw new Error(
        `Failed to create payment options: ${pErr.message} (code: ${pErr.code}, details: ${JSON.stringify(
          pErr.details
        )})`
      )
    }
  }

  revalidatePath(`/project/${projectId}`)
}
