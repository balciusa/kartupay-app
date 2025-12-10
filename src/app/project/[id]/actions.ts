'use server'

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getCurrentUserId } from '@/lib/supabaseServer'
import { joinProjectSafe } from './joinProject.safe'

// Route all join calls to the clean implementation
export async function joinProject(projectId: string) { return joinProjectSafe(projectId) }

/**
 * Mark a participant's payment as received.
 * If after the deadline, it won't count toward the threshold (is_counted = false).
 */
export async function markReceived(participantId: string) {
  const { data: participant, error: e1 } = await supabaseAdmin
    .from('participants')
    .select('id, project_id')
    .eq('id', participantId)
    .single()
  if (e1 || !participant) throw new Error('Participant not found')

  const { data: project, error: e2 } = await supabaseAdmin
    .from('projects')
    .select('deadline_at')
    .eq('id', participant.project_id)
    .single()
  if (e2 || !project) throw new Error('Project not found')

  const isCounted = project.deadline_at
    ? new Date() <= new Date(project.deadline_at as any)
    : true

  const { error: e3 } = await supabaseAdmin
    .from('payments')
    .insert({ participant_id: participantId, is_counted: isCounted })
  if (e3) throw e3

  revalidatePath(`/project/${participant.project_id}`)
}

/** Post a discussion message */
export async function postMessage(projectId: string, body: string) {
  const { error } = await supabaseAdmin
    .from('messages')
    .insert({ project_id: projectId, body })
  if (error) throw error
  revalidatePath(`/project/${projectId}`)
}

/** Cast a vote for an add-on */
export async function castVote(addonId: string) {
  const { error } = await supabaseAdmin
    .from('addon_votes')
    .insert({ addon_id: addonId })
  if (error) throw error
  revalidatePath('/') // simple revalidate; UI may refetch counts where needed
}

/**
 * When a late user joins after everyone already paid:
 * create transfers from newcomer -> each already-paid participant.
 */
export async function createLateJoinTransfers(projectId: string, newcomerParticipantId: string) {
  const [{ data: project, error: pErr }, { data: participants, error: partErr }, { data: payments, error: payErr }] =
    await Promise.all([
      supabaseAdmin.from('projects')
        .select('id, total_cents')
        .eq('id', projectId)
        .single(),
      supabaseAdmin.from('participants')
        .select('id, project_id, role')
        .eq('project_id', projectId),
      supabaseAdmin.from('payments')
        .select('participant_id, is_counted')
        .eq('is_counted', true),
    ])
  if (pErr || !project) throw new Error('Project not found')
  if (partErr) throw partErr
  if (payErr) throw payErr

  const paidSet = new Set((payments ?? []).filter(p => p.is_counted).map(p => p.participant_id))
  const recipients = (participants ?? []).filter(p => p.id !== newcomerParticipantId && paidSet.has(p.id))

  if ((participants?.length ?? 0) === 0) return
  const perPerson = Math.floor(project.total_cents / ((participants?.length ?? 0) + 1))

  const rows = recipients.map(rec => ({
    project_id: projectId,
    from_participant_id: newcomerParticipantId,
    to_participant_id: rec.id,
    expected_cents: perPerson,
  }))

  if (rows.length === 0) return
  const { error } = await supabaseAdmin
    .from('late_join_transfers')
    .insert(rows)
  if (error) throw error

  revalidatePath(`/project/${projectId}`)
}

/** Confirm that a late-join transfer was received */
export async function confirmLateJoinReceipt(transferId: string) {
  const { data: t, error: e1 } = await supabaseAdmin
    .from('late_join_transfers')
    .select('id, project_id')
    .eq('id', transferId)
    .single()
  if (e1 || !t) throw new Error('Transfer not found')

  const { error } = await supabaseAdmin
    .from('late_join_transfers')
    .update({ received_at: new Date().toISOString() })
    .eq('id', transferId)
  if (error) throw error

  revalidatePath(`/project/${t.project_id}`)
}

/**
 * (Optional, dev/admin) Add me as organizer and attach one payment link.
 * Kept for parity with earlier flows; not used if you’ve moved links to Settings.
 */
export async function addMeAsOrganizerWithPayment(opts: {
  projectId: string
  paymentType: 'revolut' | 'swedbank' | 'iban'
  paymentLabel: string
  paymentValue: string
  priority?: number
}) {
  const { projectId, paymentType, paymentLabel, paymentValue } = opts
  const priority = opts.priority ?? 1

  let uid = await getCurrentUserId()
  if (!uid) {
    // Fallback: create a minimal anonymous auth user (MVP/dev only)
    const anonymousEmail = `anon-${randomUUID()}@temp.local`
    const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: anonymousEmail,
      email_confirm: true,
      user_metadata: { is_anonymous: true },
    })
    if (authErr || !authUser?.user?.id) throw new Error(`Failed to create anonymous user: ${authErr?.message ?? 'unknown'}`)
    uid = authUser.user.id
    // Best-effort public.users sync (ignore if table missing)
    try {
      await supabaseAdmin.from('users').upsert({ id: uid, email: anonymousEmail }, { onConflict: 'id' })
    } catch { /* ignore */ }
  }

  // Ensure participant row exists (organizer)
  const { data: existing, error: qErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .limit(1)
  if (qErr) throw qErr

  let participantId = existing?.[0]?.id as string | undefined
  if (!participantId) {
    const { data: part, error: iErr } = await supabaseAdmin
      .from('participants')
      .insert({ project_id: projectId, user_id: uid, role: 'organizer', short_code: null })
      .select('id')
      .single()
    if (iErr || !part?.id) throw new Error(`Failed to create participant: ${iErr?.message ?? 'unknown'}`)
    participantId = part.id
  }

  const { error: pErr } = await supabaseAdmin
    .from('payment_options')
    .insert({
      participant_id: participantId,
      type: paymentType,
      label: paymentLabel?.trim() || null,
      value: paymentValue.trim(),
      priority,
      is_active: true,
    })
  if (pErr) throw new Error(`Failed to create payment option: ${pErr.message}`)

  revalidatePath(`/project/${projectId}`)
}

/** Add a sample add-on (demo) */
export async function addSampleAddon(projectId: string) {
  const { error } = await supabaseAdmin
    .from('addons')
    .insert({
      project_id: projectId,
      title: 'Sauna',
      description: null,
      extra_cents: 3000,
      required_votes: 2,
    })
  if (error) throw error
  revalidatePath(`/project/${projectId}`)
}
