'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getCurrentUserId } from '@/lib/supabaseServer'
import { joinProjectSafe } from './joinProject.safe'

async function clonePaymentOptionsForParticipant(participantId: string, userId: string) {
  const [{ data: userOptions, error: userErr }, { data: existingOpts, error: existingErr }] = await Promise.all([
    supabaseAdmin
      .from('user_payment_options')
      .select('type,label,value,priority,is_active')
      .eq('user_id', userId)
      .eq('is_active', true),
    supabaseAdmin
      .from('payment_options')
      .select('type,value,participant_id')
      .eq('participant_id', participantId),
  ])

  if (userErr) throw userErr
  if (existingErr) throw existingErr

  const existingPairs = new Set((existingOpts ?? []).map(po => `${po.type}::${po.value}`))
  const rows =
    (userOptions ?? [])
      .filter(x => x.is_active)
      .filter(x => !existingPairs.has(`${x.type}::${x.value}`))
      .map(x => ({
        participant_id: participantId,
        type: x.type as 'revolut' | 'swedbank' | 'iban',
        label: x.label,
        value: x.value,
        priority: x.priority ?? 1,
        is_active: true,
      }))

  if (rows.length === 0) return

  const { error: insertErr } = await supabaseAdmin.from('payment_options').insert(rows)
  if (insertErr) throw insertErr
}

export async function requestJoin(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .limit(1)
  if (existingErr) throw existingErr

  if (existing?.[0]?.id) {
    revalidatePath(`/project/${projectId}`)
    return { joined: true }
  }

  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('status, deadline_at')
    .eq('id', projectId)
    .single()
  if (projectErr || !project) throw new Error('Project not found')

  const now = new Date()
  const beforeDeadline = project.deadline_at ? now <= new Date(project.deadline_at as any) : true
  const canJoinNow = project.status === 'collecting' && beforeDeadline

  if (canJoinNow) {
    await joinProjectSafe(projectId)
    revalidatePath(`/project/${projectId}`)
    return { joined: true }
  }

  await supabaseAdmin
    .from('join_requests')
    .upsert({
      project_id: projectId,
      requester_user_id: uid,
      status: 'pending',
    }, {
      onConflict: 'project_id,requester_user_id,status',
      ignoreDuplicates: true,
    })

  revalidatePath(`/project/${projectId}`)
  return { requested: true }
}

export async function approveJoinRequest(requestId: string) {
  'use server'
  const organizerId = await getCurrentUserId()
  if (!organizerId) throw new Error('You must be signed in')

  const { data: req, error: reqErr } = await supabaseAdmin
    .from('join_requests')
    .select('id, project_id, requester_user_id, status')
    .eq('id', requestId)
    .single()
  if (reqErr || !req) throw new Error('Join request not found')

  const { data: organizerRow, error: orgErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', req.project_id)
    .eq('user_id', organizerId)
    .eq('role', 'organizer')
    .single()
  if (orgErr || !organizerRow) throw new Error('Only organizers can approve requests')

  if (req.status !== 'pending') {
    revalidatePath(`/project/${req.project_id}`)
    return
  }

  const { data: participantExisting, error: existingErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', req.project_id)
    .eq('user_id', req.requester_user_id)
    .limit(1)
  if (existingErr) throw existingErr

  let participantId = participantExisting?.[0]?.id as string | undefined
  if (!participantId) {
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('participants')
      .insert({
        project_id: req.project_id,
        user_id: req.requester_user_id,
        role: 'member',
      })
      .select('id')
      .single()
    if (insertErr || !inserted?.id) throw insertErr || new Error('Failed to create participant')
    participantId = inserted.id
  }

  await clonePaymentOptionsForParticipant(participantId, req.requester_user_id)

  const { error: updErr } = await supabaseAdmin
    .from('join_requests')
    .update({
      status: 'approved',
      decided_at: new Date().toISOString(),
      decided_by: organizerId,
    })
    .eq('id', requestId)
  if (updErr) throw updErr

  revalidatePath(`/project/${req.project_id}`)
}

export async function rejectJoinRequest(requestId: string) {
  'use server'
  const organizerId = await getCurrentUserId()
  if (!organizerId) throw new Error('You must be signed in')

  const { data: req, error: reqErr } = await supabaseAdmin
    .from('join_requests')
    .select('id, project_id, status')
    .eq('id', requestId)
    .single()
  if (reqErr || !req) throw new Error('Join request not found')

  const { data: organizerRow, error: orgErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', req.project_id)
    .eq('user_id', organizerId)
    .eq('role', 'organizer')
    .single()
  if (orgErr || !organizerRow) throw new Error('Only organizers can reject requests')

  if (req.status !== 'pending') {
    revalidatePath(`/project/${req.project_id}`)
    return
  }

  const { error: updErr } = await supabaseAdmin
    .from('join_requests')
    .update({
      status: 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: organizerId,
    })
    .eq('id', requestId)
  if (updErr) throw updErr

  revalidatePath(`/project/${req.project_id}`)
}

// Route all join calls to the clean implementation
export async function joinProject(projectId: string) { return requestJoin(projectId) }

// FormData-based to avoid bind quirks
export async function joinProjectFromForm(formData: FormData) {
  'use server'
  try {
    const projectId = String(formData.get('projectId') || '')
    if (!projectId) throw new Error('Missing projectId')

    console.log('[joinProjectFromForm] start', { projectId })

    await requestJoin(projectId)

    console.log('[joinProjectFromForm] success', { projectId })
    revalidatePath(`/project/${projectId}`)
    return redirect(`/project/${projectId}`)
  } catch (err: any) {
    // Redirect is expected; surface it without logging as a failure.
    if (err?.message === 'NEXT_REDIRECT' || err?.digest === 'NEXT_REDIRECT') throw err
    console.error('[joinProjectFromForm] error', err?.message || err)
    throw err
  }
}

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
 * (Optional, dev/admin) Add me as organizer and attach one payment link.
 * Kept for parity with earlier flows; not used if you've moved links to Settings.
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
