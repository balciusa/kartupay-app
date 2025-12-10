'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getCurrentUserId } from '@/lib/supabaseServer'

const schema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(2000).optional().nullable(),
  totalEur: z.string().regex(/^\d+(\.\d{1,2})?$/),
  minParticipants: z.coerce.number().int().min(1),
  deadlineDate: z.string().min(1),
  deadlineTime: z.string().min(1),
})

export async function createProject(formData: FormData) {
  const uid = await getCurrentUserId()
  if (!uid) {
    throw new Error('You must be signed in')
  }

  const payload = {
    title: formData.get('title') as string,
    description: (formData.get('description') as string) || null,
    totalEur: (formData.get('totalEur') as string) ?? '',
    minParticipants: formData.get('minParticipants') as any,
    deadlineDate: (formData.get('deadlineDate') as string) ?? '',
    deadlineTime: (formData.get('deadlineTime') as string) ?? '',
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid form: ' + JSON.stringify(parsed.error.flatten().fieldErrors))
  }

  const { title, description, totalEur, minParticipants, deadlineDate, deadlineTime } = parsed.data

  const normalizedAmount = totalEur.replace(',', '.').trim()
  const amountFloat = parseFloat(normalizedAmount)
  if (!isFinite(amountFloat) || amountFloat < 0) {
    throw new Error('Invalid total amount')
  }
  const total_cents = Math.round(amountFloat * 100)

  const deadline_at = new Date(`${deadlineDate}T${deadlineTime}:00`)
  if (isNaN(+deadline_at)) {
    throw new Error('Invalid deadline date or time')
  }

  const { data: proj, error: pErr } = await supabaseAdmin
    .from('projects')
    .insert({
      title,
      description,
      total_cents,
      min_participants: Number(minParticipants),
      deadline_at: deadline_at.toISOString(),
      status: 'collecting',
    })
    .select('id')
    .single()

  if (pErr || !proj?.id) {
    throw new Error(
      `Failed to create project: ${pErr?.message ?? 'unknown'} (code: ${pErr?.code ?? 'n/a'}, details: ${JSON.stringify(pErr?.details)})`
    )
  }

  const { data: part, error: iErr } = await supabaseAdmin
    .from('participants')
    .insert({
      project_id: proj.id,
      user_id: uid,
      role: 'organizer',
      short_code: null,
    })
    .select('id')
    .single()

  if (iErr || !part?.id) {
    throw new Error('Failed to add organizer: ' + (iErr?.message ?? 'unknown'))
  }

  const [{ data: upos, error: uErr }, { data: existingPOs, error: eErr }] = await Promise.all([
    supabaseAdmin.from('user_payment_options')
      .select('type,label,value,priority,is_active')
      .eq('user_id', uid)
      .eq('is_active', true),
    supabaseAdmin.from('payment_options')
      .select('type,value,participant_id')
      .eq('participant_id', part.id),
  ])
  if (uErr) throw new Error('Failed reading user payment links: ' + uErr.message)
  if (eErr) throw new Error('Failed reading project payment options: ' + eErr.message)

  const existingPairs = new Set((existingPOs ?? []).map(po => `${po.type}::${po.value}`))
  const rows = (upos ?? [])
    .filter(x => x.is_active)
    .filter(x => !existingPairs.has(`${x.type}::${x.value}`))
    .map(x => ({
      project_id: proj.id,
      participant_id: part.id,
      type: x.type as 'revolut'|'swedbank'|'iban',
      label: x.label,
      value: x.value,
      priority: x.priority ?? 1,
      is_active: true,
    }))

  if (rows.length > 0) {
    const { error: poErr } = await supabaseAdmin.from('payment_options').insert(rows)
    if (poErr) throw new Error('Failed cloning payment links: ' + poErr.message)
  }

  revalidatePath('/')
  redirect(`/project/${proj.id}`)
}
