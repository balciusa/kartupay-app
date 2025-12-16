'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getCurrentUserId } from '@/lib/supabaseServer'

export async function setCollector(projectId: string, participantId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not signed in')

  // Verify caller is an active organizer of this project
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .eq('role', 'organizer')
    .is('left_at', null)
    .limit(1)
  if (orgErr) throw orgErr
  if (!org?.length) throw new Error('Not authorized')

  // Ensure target participant belongs to this project and is active
  const { data: part, error: partErr } = await supabaseAdmin
    .from('participants')
    .select('id, project_id, left_at')
    .eq('id', participantId)
    .single()
  if (partErr) throw partErr
  if (!part || part.project_id !== projectId || part.left_at) throw new Error('Invalid participant')

  const { error: updErr } = await supabaseAdmin
    .from('projects')
    .update({ collector_participant_id: participantId })
    .eq('id', projectId)
  if (updErr) throw updErr

  revalidatePath(`/project/${projectId}`)
}

export async function cancelProject(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const nowIso = new Date().toISOString()

  const { data: me, error: meErr } = await supabaseAdmin
    .from('participants')
    .select('id, role')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .is('left_at', null)
    .limit(1)
  if (meErr) throw meErr
  if (!me?.length || me[0].role !== 'organizer') throw new Error('Not authorized')

  const { error: uErr } = await supabaseAdmin
    .from('projects')
    .update({ status: 'canceled', canceled_at: nowIso })
    .eq('id', projectId)
  if (uErr) {
    const needsFallback = (uErr as any)?.code === '23514' || uErr?.message?.includes('projects_status_check')
    if (needsFallback) {
      console.warn('[cancelProject] status value not allowed by constraint, falling back to canceled_at only', uErr)
      const { error: fbErr } = await supabaseAdmin
        .from('projects')
        .update({ canceled_at: nowIso })
        .eq('id', projectId)
      if (fbErr) throw fbErr
    } else {
      throw uErr
    }
  }

  revalidatePath(`/project/${projectId}`)
}

export async function leaveProject(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')

  const { data: me, error: meErr } = await supabaseAdmin
    .from('participants')
    .select('id, role')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .is('left_at', null)
    .limit(1)
    .maybeSingle()
  if (meErr) throw meErr
  if (!me) { revalidatePath(`/project/${projectId}`); return { ok: true } }

  if (me.role === 'organizer') {
    const { data: organizers, error: orgErr } = await supabaseAdmin
      .from('participants')
      .select('id')
      .eq('project_id', projectId)
      .eq('role', 'organizer')
      .is('left_at', null)
    if (orgErr) throw orgErr
    if ((organizers?.length ?? 0) <= 1) {
      throw new Error('You are the only organizer. Assign another organizer before leaving.')
    }
  }

  const { error: updErr } = await supabaseAdmin
    .from('participants')
    .update({ left_at: new Date().toISOString() })
    .eq('id', me.id)
  if (updErr) throw updErr

  revalidatePath(`/project/${projectId}`)
  redirect(`/project/${projectId}`)
}

export async function promoteToOrganizer(participantId: string) {
  'use server'
  const organizerId = await getCurrentUserId()
  if (!organizerId) throw new Error('You must be signed in')

  // Get the participant to promote
  const { data: targetParticipant, error: targetErr } = await supabaseAdmin
    .from('participants')
    .select('id, project_id, role, user_id')
    .eq('id', participantId)
    .single()
  if (targetErr || !targetParticipant) throw new Error('Participant not found')

  // Verify the current user is an organizer
  const { data: organizerRow, error: orgErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', targetParticipant.project_id)
    .eq('user_id', organizerId)
    .eq('role', 'organizer')
    .is('left_at', null)
    .single()
  if (orgErr || !organizerRow) throw new Error('Only organizers can promote members')

  // Verify the target participant is a member (not already an organizer)
  if (targetParticipant.role === 'organizer') {
    throw new Error('This participant is already an organizer')
  }

  // Promote to organizer
  const { error: updErr } = await supabaseAdmin
    .from('participants')
    .update({ role: 'organizer' })
    .eq('id', participantId)
  if (updErr) throw updErr

  console.log('[promoteToOrganizer] Promoted participant to organizer', { participantId, projectId: targetParticipant.project_id })
  revalidatePath(`/project/${targetParticipant.project_id}`)
  redirect(`/project/${targetParticipant.project_id}`)
}

// FormData-based wrapper for leaveProject
export async function leaveProjectFromForm(formData: FormData) {
  'use server'
  const projectId = String(formData.get('projectId') || '')
  if (!projectId) {
    console.error('[leaveProjectFromForm] Missing projectId')
    return
  }
  console.log('[leaveProjectFromForm] Leaving project', { projectId })
  try {
    await leaveProject(projectId)
  } catch (err: any) {
    // Redirect is expected; surface it without logging as a failure.
    if (err?.message === 'NEXT_REDIRECT' || err?.digest === 'NEXT_REDIRECT') throw err
    console.error('[leaveProjectFromForm] error', err?.message || err)
    throw err
  }
}

// FormData-based wrapper for promoteToOrganizer
export async function promoteToOrganizerFromForm(formData: FormData) {
  'use server'
  const participantId = String(formData.get('participantId') || '')
  if (!participantId) {
    console.error('[promoteToOrganizerFromForm] Missing participantId')
    return
  }
  console.log('[promoteToOrganizerFromForm] Promoting participant', { participantId })
  try {
    await promoteToOrganizer(participantId)
  } catch (err: any) {
    // Redirect is expected; surface it without logging as a failure.
    if (err?.message === 'NEXT_REDIRECT' || err?.digest === 'NEXT_REDIRECT') throw err
    console.error('[promoteToOrganizerFromForm] error', err?.message || err)
    throw err
  }
}

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

  console.log('[requestJoin] start', { projectId, uid })

  const { data: project, error: pErr } = await supabaseAdmin
    .from('projects')
    .select('id, status, deadline_at, canceled_at')
    .eq('id', projectId)
    .single()
  if (pErr || !project) {
    console.error('[requestJoin] project fetch error', pErr)
    revalidatePath(`/project/${projectId}`)
    return { ok: false, reason: 'project_fetch_failed' as const }
  }

  const canceled = project.status === 'canceled' || !!project.canceled_at
  if (canceled) {
    console.log('[requestJoin] blocked - project canceled', { projectId, status: project.status, canceled_at: project.canceled_at })
    revalidatePath(`/project/${projectId}`)
    return { ok: false as const, blocked: true as const }
  }

  const { data: mine, error: mineErr } = await supabaseAdmin
    .from('participants')
    .select('id, left_at')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .limit(1)
  if (mineErr) console.warn('[requestJoin] participants probe error', mineErr)

  const existing = mine?.[0]
  if (existing && !existing.left_at) {
    console.log('[requestJoin] already active participant', existing.id)
    revalidatePath(`/project/${projectId}`)
    return { ok: true, joined: true as const }
  }

  // Check if there's an existing request (including rejected ones)
  const { data: existingReq, error: checkErr } = await supabaseAdmin
    .from('join_requests')
    .select('id, status')
    .eq('project_id', projectId)
    .eq('requester_user_id', uid)
    .maybeSingle()
  
  if (checkErr) {
    console.error('[requestJoin] check existing request error', checkErr)
    // Continue anyway - try to upsert which will handle conflicts
  }

  if (existingReq && !checkErr) {
    // Update existing request (whether pending, rejected, or approved)
    const { error: upErr } = await supabaseAdmin
      .from('join_requests')
      .update({
        status: 'pending',
        created_at: new Date().toISOString(), // Reset created_at for new request
      })
      .eq('id', existingReq.id)
    
    if (upErr) {
      console.error('[requestJoin] update join_requests error', upErr, { requestId: existingReq.id })
      revalidatePath(`/project/${projectId}`)
      return { ok: false, reason: 'update_failed' as const }
    }
    console.log('[requestJoin] updated existing request to pending', { requestId: existingReq.id, oldStatus: existingReq.status })
  } else {
    // Create new request (or upsert if check failed)
    // Try insert first, if it fails due to conflict, then update
    const insertData = {
      project_id: projectId,
      requester_user_id: uid,
      status: 'pending' as const,
    }
    
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('join_requests')
      .insert(insertData)
      .select()
      .single()
    
    if (insErr) {
      // If it's a unique constraint violation, try to update instead
      if (insErr.code === '23505' || insErr.message?.includes('duplicate') || insErr.message?.includes('unique')) {
        console.log('[requestJoin] Insert failed due to conflict, trying update instead', insErr)
        
        // Find the existing request and update it
        const { data: existingForUpdate, error: findErr } = await supabaseAdmin
          .from('join_requests')
          .select('id')
          .eq('project_id', projectId)
          .eq('requester_user_id', uid)
          .maybeSingle()
        
        if (findErr || !existingForUpdate) {
          console.error('[requestJoin] Could not find existing request to update', findErr)
          revalidatePath(`/project/${projectId}`)
          return { ok: false, reason: 'upsert_failed' as const, error: insErr.message }
        }
        
        const { error: upErr } = await supabaseAdmin
          .from('join_requests')
          .update({
            status: 'pending',
            created_at: new Date().toISOString(),
          })
          .eq('id', existingForUpdate.id)
        
        if (upErr) {
          console.error('[requestJoin] Update after conflict failed', upErr)
          revalidatePath(`/project/${projectId}`)
          return { ok: false, reason: 'upsert_failed' as const, error: upErr.message }
        }
        
        console.log('[requestJoin] Updated existing request after conflict')
      } else {
        console.error('[requestJoin] insert join_requests error', insErr)
        revalidatePath(`/project/${projectId}`)
        return { ok: false, reason: 'upsert_failed' as const, error: insErr.message }
      }
    } else {
      console.log('[requestJoin] created new pending request', inserted?.id)
    }
  }

  console.log('[requestJoin] pending request created/updated successfully')
  revalidatePath(`/project/${projectId}`)
  return { ok: true, pending: true as const }
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

  // Check for existing participant (including those who left)
  const { data: participantExisting, error: existingErr } = await supabaseAdmin
    .from('participants')
    .select('id, left_at, role')
    .eq('project_id', req.project_id)
    .eq('user_id', req.requester_user_id)
    .maybeSingle()
  
  if (existingErr) {
    console.error('[approveJoinRequest] Error checking existing participant:', existingErr)
    throw existingErr
  }

  let participantId = participantExisting?.id as string | undefined
  
  if (!participantId) {
    // Create new participant
    console.log('[approveJoinRequest] Creating new participant for user', req.requester_user_id)
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('participants')
      .insert({
        project_id: req.project_id,
        user_id: req.requester_user_id,
        role: 'member',
      })
      .select('id')
      .single()
    if (insertErr || !inserted?.id) {
      console.error('[approveJoinRequest] Failed to create participant:', insertErr)
      throw insertErr || new Error('Failed to create participant')
    }
    participantId = inserted.id
    console.log('[approveJoinRequest] Created new participant', { participantId, userId: req.requester_user_id })
  } else if (participantExisting?.left_at) {
    // Reactivate participant who left
    console.log('[approveJoinRequest] Reactivating participant who left', { participantId, left_at: participantExisting.left_at })
    const { error: reactErr } = await supabaseAdmin
      .from('participants')
      .update({ left_at: null })
      .eq('id', participantId)
    if (reactErr) {
      console.error('[approveJoinRequest] Failed to reactivate participant:', reactErr)
      throw reactErr
    }
    console.log('[approveJoinRequest] Reactivated participant', participantId)
    
    // Verify reactivation
    const { data: verify } = await supabaseAdmin
      .from('participants')
      .select('id, left_at')
      .eq('id', participantId)
      .single()
    console.log('[approveJoinRequest] Verification after reactivate:', verify)
  } else {
    console.log('[approveJoinRequest] Participant already active', { participantId, left_at: participantExisting?.left_at })
  }

  if (!participantId) {
    throw new Error('Failed to get or create participant')
  }

  await clonePaymentOptionsForParticipant(participantId, req.requester_user_id)

  const { error: updErr } = await supabaseAdmin
    .from('join_requests')
    .update({
      status: 'approved',
    })
    .eq('id', requestId)
  if (updErr) {
    console.error('[approveJoinRequest] Failed to update request status:', updErr)
    throw updErr
  }

  // Verify participant is active
  const { data: verifyParticipant } = await supabaseAdmin
    .from('participants')
    .select('id, left_at, role')
    .eq('id', participantId)
    .single()
  
  console.log('[approveJoinRequest] Final verification:', {
    requestId,
    participantId,
    participantActive: verifyParticipant?.left_at === null,
    participantRole: verifyParticipant?.role,
    requesterUserId: req.requester_user_id
  })

  console.log('[approveJoinRequest] Request approved, participant active', { requestId, participantId })
  revalidatePath(`/project/${req.project_id}`)
  redirect(`/project/${req.project_id}`)
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
    })
    .eq('id', requestId)
  if (updErr) throw updErr

  console.log('[rejectJoinRequest] Request rejected', { requestId })
  revalidatePath(`/project/${req.project_id}`)
  redirect(`/project/${req.project_id}`)
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

// FormData-based wrappers for approve/reject to avoid bind quirks
export async function approveJoinRequestFromForm(formData: FormData) {
  'use server'
  const requestId = String(formData.get('requestId') || '')
  if (!requestId) {
    console.error('[approveJoinRequestFromForm] Missing requestId')
    return
  }
  console.log('[approveJoinRequestFromForm] Approving request', { requestId })
  try {
    await approveJoinRequest(requestId)
  } catch (err: any) {
    // Redirect is expected; surface it without logging as a failure.
    if (err?.message === 'NEXT_REDIRECT' || err?.digest === 'NEXT_REDIRECT') throw err
    console.error('[approveJoinRequestFromForm] error', err?.message || err)
    throw err
  }
}

export async function rejectJoinRequestFromForm(formData: FormData) {
  'use server'
  const requestId = String(formData.get('requestId') || '')
  if (!requestId) {
    console.error('[rejectJoinRequestFromForm] Missing requestId')
    return
  }
  console.log('[rejectJoinRequestFromForm] Rejecting request', { requestId })
  try {
    await rejectJoinRequest(requestId)
  } catch (err: any) {
    // Redirect is expected; surface it without logging as a failure.
    if (err?.message === 'NEXT_REDIRECT' || err?.digest === 'NEXT_REDIRECT') throw err
    console.error('[rejectJoinRequestFromForm] error', err?.message || err)
    throw err
  }
}

// FormData-based wrapper for requestJoin to avoid bind quirks
// Returns result instead of redirecting - let client handle navigation
export async function requestJoinFromForm(formData: FormData) {
  'use server'
  const projectId = String(formData.get('projectId') || '')
  if (!projectId) {
    console.error('[requestJoinFromForm] Missing projectId')
    return { ok: false, error: 'Missing projectId' }
  }

  console.log('[requestJoinFromForm] start', { projectId })

  try {
    const result = await requestJoin(projectId)
    
    console.log('[requestJoinFromForm] requestJoin result', { projectId, result })
    
    // Revalidate the path so fresh data is available
    revalidatePath(`/project/${projectId}`)
    
    return result
  } catch (err: any) {
    console.error('[requestJoinFromForm] error', { projectId, error: err?.message || err, stack: err?.stack })
    revalidatePath(`/project/${projectId}`)
    return { ok: false, error: err?.message || 'Unknown error' }
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
