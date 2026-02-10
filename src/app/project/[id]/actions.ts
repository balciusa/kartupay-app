'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { recordProjectActivity } from '@/lib/activityLog'
import { getCurrentUserId } from '@/lib/supabaseServer'
import { buildExtraDueRows } from '@/lib/extraPayments'

export async function setCollector(projectId: string, participantId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not signed in')
  await requireActiveManager(projectId, uid)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)
  const { data: projectBefore } = await supabaseAdmin
    .from('projects')
    .select('collector_participant_id')
    .eq('id', projectId)
    .maybeSingle()

  // Ensure target participant belongs to this project and is active
  const { data: part, error: partErr } = await supabaseAdmin
    .from('participants')
    .select('id, user_id, project_id, left_at')
    .eq('id', participantId)
    .single()
  if (partErr) throw partErr
  if (!part || part.project_id !== projectId || part.left_at) throw new Error('Invalid participant')

  const { error: updErr } = await supabaseAdmin
    .from('projects')
    .update({ collector_participant_id: participantId })
    .eq('id', projectId)
  if (updErr) throw updErr

  await recordProjectActivity({
    projectId,
    entryType: 'collector_changed',
    actorUserId,
    actorParticipantId,
    targetUserId: part.user_id ?? null,
    targetParticipantId: participantId,
    metadata: {
      previous_collector_participant_id: projectBefore?.collector_participant_id ?? null,
      new_collector_participant_id: participantId,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

export async function cancelProject(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const nowIso = new Date().toISOString()
  await requireActiveManager(projectId, uid)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)
  const { data: projectBefore } = await supabaseAdmin
    .from('projects')
    .select('status, canceled_at')
    .eq('id', projectId)
    .maybeSingle()

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

  await recordProjectActivity({
    projectId,
    entryType: 'project_status_changed',
    actorUserId,
    actorParticipantId,
    metadata: {
      from_status: projectBefore?.status ?? null,
      to_status: 'canceled',
      previous_canceled_at: projectBefore?.canceled_at ?? null,
      canceled_at: nowIso,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

export async function finalizeProject(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not signed in')
  await requireActiveManager(projectId, uid)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

  const values = { status: 'closed' as const, finalized_at: new Date().toISOString() }

  const { error } = await supabaseAdmin
    .from('projects')
    .update(values)
    .eq('id', projectId)
    .eq('status', 'collecting')
  if (error) {
    if (missingColumn(error, 'finalized_at')) {
      const { error: retryErr } = await supabaseAdmin
        .from('projects')
        .update({ status: 'closed' })
        .eq('id', projectId)
        .eq('status', 'collecting')
      if (retryErr) {
        if (statusConstraintViolated(retryErr)) {
          const { error: fallbackErr } = await supabaseAdmin
            .from('projects')
            .update({ finalized_at: values.finalized_at })
            .eq('id', projectId)
          if (fallbackErr) throw new Error(fallbackErr.message ?? 'Failed to finalize project')
        } else {
          throw new Error(retryErr.message ?? 'Failed to finalize project')
        }
      }
    } else if (statusConstraintViolated(error)) {
      const { error: fallbackErr } = await supabaseAdmin
        .from('projects')
        .update({ finalized_at: values.finalized_at })
        .eq('id', projectId)
      if (fallbackErr) throw new Error(fallbackErr.message ?? 'Failed to finalize project')
    } else {
      throw new Error(error.message ?? 'Failed to finalize project')
    }
  }

  await recordProjectActivity({
    projectId,
    entryType: 'project_status_changed',
    actorUserId,
    actorParticipantId,
    metadata: {
      from_status: 'collecting',
      to_status: 'closed',
      finalized_at: values.finalized_at,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

export async function reopenProject(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not signed in')
  await requireActiveManager(projectId, uid)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

  const values = { status: 'collecting' as const, finalized_at: null }
  const { error } = await supabaseAdmin
    .from('projects')
    .update(values)
    .eq('id', projectId)
    .eq('status', 'closed')
  if (error) {
    if (missingColumn(error, 'finalized_at')) {
      const { error: retryErr } = await supabaseAdmin
        .from('projects')
        .update({ status: 'collecting' })
        .eq('id', projectId)
        .eq('status', 'closed')
      if (retryErr) throw new Error(retryErr.message ?? 'Failed to reopen project')
    } else if (statusConstraintViolated(error)) {
      const { error: fallbackErr } = await supabaseAdmin
        .from('projects')
        .update({ finalized_at: null })
        .eq('id', projectId)
      if (fallbackErr) throw new Error(fallbackErr.message ?? 'Failed to reopen project')
    } else {
      throw new Error(error.message ?? 'Failed to reopen project')
    }
  }

  await recordProjectActivity({
    projectId,
    entryType: 'project_status_changed',
    actorUserId,
    actorParticipantId,
    metadata: {
      from_status: 'closed',
      to_status: 'collecting',
      finalized_at: values.finalized_at,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

export async function abortProject(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not signed in')
  await requireActiveManager(projectId, uid)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)
  const { data: projectBefore } = await supabaseAdmin
    .from('projects')
    .select('status')
    .eq('id', projectId)
    .maybeSingle()

  const { data: participants, error: participantsErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
  if (participantsErr) throw participantsErr

  const participantIds = (participants ?? []).map(p => p.id)
  if (participantIds.length > 0) {
    const { data: payments, error: paymentsErr } = await supabaseAdmin
      .from('payments')
      .select('id')
      .in('participant_id', participantIds)
      .limit(1)
    if (paymentsErr) throw paymentsErr
    if ((payments?.length ?? 0) > 0) {
      throw new Error('Cannot abort: some payments were already recorded')
    }
  }

  const values = { status: 'cancelled' as const, aborted_at: new Date().toISOString() }
  const { error } = await supabaseAdmin
    .from('projects')
    .update(values)
    .eq('id', projectId)
    .in('status', ['collecting', 'closed'])
  if (error) {
    if (missingColumn(error, 'aborted_at')) {
      const { error: retryErr } = await supabaseAdmin
        .from('projects')
        .update({ status: 'cancelled' })
        .eq('id', projectId)
        .in('status', ['collecting', 'closed'])
      if (retryErr) throw new Error(retryErr.message ?? 'Failed to abort project')
    } else if (statusConstraintViolated(error)) {
      const { error: fallbackErr } = await supabaseAdmin
        .from('projects')
        .update({ aborted_at: values.aborted_at })
        .eq('id', projectId)
      if (fallbackErr) throw new Error(fallbackErr.message ?? 'Failed to abort project')
    } else {
      throw new Error(error.message ?? 'Failed to abort project')
    }
  }

  await recordProjectActivity({
    projectId,
    entryType: 'project_status_changed',
    actorUserId,
    actorParticipantId,
    metadata: {
      from_status: projectBefore?.status ?? null,
      to_status: 'cancelled',
      aborted_at: values.aborted_at,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

export async function leaveProject(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

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

  const { error: updErr } = await supabaseAdmin
    .from('participants')
    .update({ left_at: new Date().toISOString() })
    .eq('id', me.id)
  if (updErr) throw updErr

  await recordProjectActivity({
    projectId,
    entryType: 'participant_left',
    actorUserId,
    actorParticipantId,
    targetUserId: uid,
    targetParticipantId: me.id,
  })

  revalidatePath(`/project/${projectId}`)
  redirect(`/project/${projectId}`)
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

async function requireActiveManager(projectId: string, userId: string) {
  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('collector_participant_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectErr) throw projectErr

  if (project?.collector_participant_id) {
    const { data: collector, error: collectorErr } = await supabaseAdmin
      .from('participants')
      .select('id')
      .eq('id', project.collector_participant_id)
      .eq('user_id', userId)
      .is('left_at', null)
      .maybeSingle()
    if (collectorErr) throw collectorErr
    if (collector) return collector
    throw new Error('Not authorized')
  }

  // Backward-compatible fallback for old projects without collector set.
  const { data: me, error: meErr } = await supabaseAdmin
    .from('participants')
    .select('id, role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .is('left_at', null)
    .eq('role', 'organizer')
    .limit(1)
  if (meErr) throw meErr
  if (!me?.length) throw new Error('Not authorized')
  return me[0]
}

async function requireActiveProjectParticipant(projectId: string, userId: string) {
  const { data: me, error: meErr } = await supabaseAdmin
    .from('participants')
    .select('id, project_id, left_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .is('left_at', null)
    .maybeSingle()
  if (meErr) throw meErr
  if (!me) throw new Error('Only active participants can do this')
  return me
}

async function getActiveParticipantContext(projectId: string, userId: string | null | undefined) {
  if (!userId) return { actorUserId: null, actorParticipantId: null as string | null }
  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .is('left_at', null)
    .maybeSingle()
  if (error) {
    console.error('[activity_logs] failed to resolve actor participant context', {
      projectId,
      userId,
      error,
    })
    return { actorUserId: userId, actorParticipantId: null as string | null }
  }
  return {
    actorUserId: userId,
    actorParticipantId: data?.id ?? null,
  }
}

const missingColumn = (
  error: { message?: string; details?: string | null; hint?: string | null; code?: string } | null,
  column: string
) => {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase()
  const columnName = column.toLowerCase()
  if (!haystack.includes(columnName)) return false
  return (
    haystack.includes('does not exist') ||
    haystack.includes('could not find') ||
    haystack.includes('schema cache') ||
    haystack.includes('unknown column') ||
    error?.code === 'PGRST204'
  )
}

const missingTable = (
  error: { message?: string; details?: string | null; hint?: string | null; code?: string } | null,
  table: string
) => {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase()
  const tableName = table.toLowerCase()
  if (!haystack.includes(tableName) && error?.code !== '42P01') return false
  return (
    error?.code === '42P01' ||
    haystack.includes('does not exist') ||
    haystack.includes('could not find') ||
    haystack.includes('schema cache') ||
    haystack.includes('unknown table')
  )
}

const statusConstraintViolated = (error?: { message?: string; code?: string } | null) =>
  !!error && (error.code === '23514' || error.message?.includes('projects_status_check'))

type LateJoinTransferRunResult = {
  processed: boolean
  recipientsCount: number
  perPersonCents: number
  upsertedCount: number
  reason?: string
}

async function runLateJoinTransferUpsert(projectId: string, newcomerParticipantId: string): Promise<LateJoinTransferRunResult> {
  const { data: newcomer, error: newcomerErr } = await supabaseAdmin
    .from('participants')
    .select('id, project_id')
    .eq('id', newcomerParticipantId)
    .single()
  if (newcomerErr || !newcomer) throw newcomerErr || new Error('Participant not found')
  if (newcomer.project_id !== projectId) throw new Error('Participant does not belong to this project')

  const baseProjectFields = 'id, total_cents'
  const projectAttempt = await supabaseAdmin
    .from('projects')
    .select(`${baseProjectFields}, finalized_at`)
    .eq('id', projectId)
    .single()

  let project = projectAttempt.data
  let projectErr = projectAttempt.error

  if (missingColumn(projectAttempt.error, 'finalized_at')) {
    console.warn('[runLateJoinTransferUpsert] finalized_at column missing, falling back without it')
    const fallback = await supabaseAdmin
      .from('projects')
      .select(baseProjectFields)
      .eq('id', projectId)
      .single()
    project = fallback.data ? { ...fallback.data, finalized_at: null } : null
    projectErr = fallback.error
  }

  if (projectErr || !project) throw projectErr || new Error('Project not found for late join logic')

  if (!project.finalized_at) {
    return {
      processed: false,
      recipientsCount: 0,
      perPersonCents: 0,
      upsertedCount: 0,
      reason: 'project_not_finalized',
    }
  }

  const { data: recipients, error: recipientsErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .is('left_at', null)
    .lte('joined_at', project.finalized_at as string)
    .neq('id', newcomerParticipantId)
  if (recipientsErr) throw recipientsErr

  const recipientList = recipients ?? []
  const recipientsCount = recipientList.length
  if (recipientsCount === 0) {
    return {
      processed: false,
      recipientsCount,
      perPersonCents: 0,
      upsertedCount: 0,
      reason: 'no_recipients_at_finalize',
    }
  }

  const numerator = Number(project.total_cents ?? 0)
  const denominator = recipientsCount * (recipientsCount + 1)
  const perPersonCents = denominator > 0 ? Math.floor(numerator / denominator) : 0

  if (recipientsCount === 0) {
    return {
      processed: false,
      recipientsCount,
      perPersonCents,
      upsertedCount: 0,
      reason: 'no_recipients_at_close',
    }
  }

  const rows = recipientList.map(r => ({
    project_id: project.id,
    from_participant_id: newcomerParticipantId,
    to_participant_id: r.id,
    expected_cents: perPersonCents,
  }))

  const { data: upserted, error: upsertErr } = await supabaseAdmin
    .from('late_join_transfers')
    .upsert(rows, {
      onConflict: 'project_id,from_participant_id,to_participant_id',
      ignoreDuplicates: true,
    })
    .select('id')
  if (upsertErr) throw upsertErr

  return {
    processed: true,
    recipientsCount,
    perPersonCents,
    upsertedCount: upserted?.length ?? 0,
  }
}

export async function requestJoin(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')

  console.log('[requestJoin] start', { projectId, uid })

  const { data: project, error: pErr } = await supabaseAdmin
    .from('projects')
    .select('id, status, canceled_at')
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
  let resultingRequestId: string | null = null
  
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
    resultingRequestId = existingReq.id
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
        resultingRequestId = existingForUpdate.id
        
        console.log('[requestJoin] Updated existing request after conflict')
      } else {
        console.error('[requestJoin] insert join_requests error', insErr)
        revalidatePath(`/project/${projectId}`)
        return { ok: false, reason: 'upsert_failed' as const, error: insErr.message }
      }
    } else {
      resultingRequestId = inserted?.id ?? null
      console.log('[requestJoin] created new pending request', inserted?.id)
    }
  }

  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)
  await recordProjectActivity({
    projectId,
    entryType: 'join_request_submitted',
    actorUserId,
    actorParticipantId,
    targetUserId: uid,
    joinRequestId: resultingRequestId,
    metadata: {
      request_id: resultingRequestId,
    },
  })

  console.log('[requestJoin] pending request created/updated successfully')
  revalidatePath(`/project/${projectId}`)
  return { ok: true, pending: true as const }
}

export async function createLateJoinTransfers(
  projectId: string,
  newcomerParticipantId: string,
  opts?: { skipAuth?: boolean; skipRevalidate?: boolean }
) {
  'use server'
  let actorUserId: string | null = null
  let actorParticipantId: string | null = null
  if (!opts?.skipAuth) {
    const uid = await getCurrentUserId()
    if (!uid) throw new Error('You must be signed in')
    await requireActiveManager(projectId, uid)
    const actor = await getActiveParticipantContext(projectId, uid)
    actorUserId = actor.actorUserId
    actorParticipantId = actor.actorParticipantId
  }

  const result = await runLateJoinTransferUpsert(projectId, newcomerParticipantId)

  if (!opts?.skipAuth && result.processed && result.upsertedCount > 0) {
    await recordProjectActivity({
      projectId,
      entryType: 'late_transfer_created',
      actorUserId,
      actorParticipantId,
      targetParticipantId: newcomerParticipantId,
      metadata: {
        recipients_count: result.recipientsCount,
        per_person_cents: result.perPersonCents,
        created_transfers_count: result.upsertedCount,
      },
    })
  }

  if (!opts?.skipRevalidate) {
    revalidatePath(`/project/${projectId}`)
  }

  return result
}

export async function approveJoinRequest(requestId: string) {
  'use server'
  const managerId = await getCurrentUserId()
  if (!managerId) throw new Error('You must be signed in')

  const { data: req, error: reqErr } = await supabaseAdmin
    .from('join_requests')
    .select('id, project_id, requester_user_id, status')
    .eq('id', requestId)
    .single()
  if (reqErr || !req) throw new Error('Join request not found')

  await requireActiveManager(req.project_id, managerId)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(req.project_id, managerId)

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

  const lateJoinResult = await createLateJoinTransfers(req.project_id, participantId, {
    skipAuth: true,
    skipRevalidate: true,
  })
  if (lateJoinResult.processed) {
    console.log('[approveJoinRequest] Late join distribution', {
      requestId,
      projectId: req.project_id,
      participantId,
      recipientsCount: lateJoinResult.recipientsCount,
      perPersonCents: lateJoinResult.perPersonCents,
    })
    console.log('[approveJoinRequest] Late join upserted rows', {
      requestId,
      upsertedCount: lateJoinResult.upsertedCount,
    })
  } else {
    console.log('[approveJoinRequest] Late join skipped', {
      requestId,
      projectId: req.project_id,
      reason: lateJoinResult.reason,
    })
  }

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

  await recordProjectActivity({
    projectId: req.project_id,
    entryType: 'join_request_approved',
    actorUserId,
    actorParticipantId,
    targetUserId: req.requester_user_id,
    targetParticipantId: participantId,
    joinRequestId: req.id,
  })

  await recordProjectActivity({
    projectId: req.project_id,
    entryType: 'participant_joined',
    actorUserId,
    actorParticipantId,
    targetUserId: req.requester_user_id,
    targetParticipantId: participantId,
    joinRequestId: req.id,
    metadata: {
      via_join_request: true,
    },
  })

  if (lateJoinResult.processed && lateJoinResult.upsertedCount > 0) {
    await recordProjectActivity({
      projectId: req.project_id,
      entryType: 'late_transfer_created',
      actorUserId,
      actorParticipantId,
      targetUserId: req.requester_user_id,
      targetParticipantId: participantId,
      joinRequestId: req.id,
      metadata: {
        recipients_count: lateJoinResult.recipientsCount,
        per_person_cents: lateJoinResult.perPersonCents,
        created_transfers_count: lateJoinResult.upsertedCount,
      },
    })
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
  const managerId = await getCurrentUserId()
  if (!managerId) throw new Error('You must be signed in')

  const { data: req, error: reqErr } = await supabaseAdmin
    .from('join_requests')
    .select('id, project_id, requester_user_id, status')
    .eq('id', requestId)
    .single()
  if (reqErr || !req) throw new Error('Join request not found')

  await requireActiveManager(req.project_id, managerId)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(req.project_id, managerId)

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

  await recordProjectActivity({
    projectId: req.project_id,
    entryType: 'join_request_rejected',
    actorUserId,
    actorParticipantId,
    targetUserId: req.requester_user_id ?? null,
    joinRequestId: req.id,
  })

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

export async function selfReportPaid(participantId: string) {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')

  const { data: mine, error: mineErr } = await supabaseAdmin
    .from('participants')
    .select('id, user_id, project_id, left_at')
    .eq('id', participantId)
    .limit(1)
  if (mineErr) throw mineErr
  if (!mine || mine.length === 0) throw new Error('Participant not found')
  const participant = mine[0]
  if (participant.user_id !== uid) throw new Error('Not your participant entry')
  if (participant.left_at) throw new Error('You have left this project')

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('payment_signals')
    .select('id')
    .eq('participant_id', participantId)
    .is('cleared_at', null)
    .limit(1)
  if (existingErr) throw existingErr

  if (!existing || existing.length === 0) {
    const { error: insertErr } = await supabaseAdmin
      .from('payment_signals')
      .insert({ participant_id: participantId })
    if (insertErr) throw insertErr

    await recordProjectActivity({
      projectId: participant.project_id,
      entryType: 'payment_reported',
      actorUserId: uid,
      actorParticipantId: participant.id,
      targetUserId: uid,
      targetParticipantId: participant.id,
      metadata: {
        source: 'payment_signal',
      },
    })
  }

  revalidatePath(`/project/${participant.project_id}`)
}

export async function markLateJoinPaid(transferId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')

  let { data: transfer, error: transferErr } = await supabaseAdmin
    .from('late_join_transfers')
    .select('id, project_id, from_participant_id, to_participant_id, received_at, sender_marked_at')
    .eq('id', transferId)
    .single()
  if (missingColumn(transferErr, 'sender_marked_at')) {
    console.warn('[markLateJoinPaid] sender_marked_at missing, retrying without it')
    const fallback = await supabaseAdmin
      .from('late_join_transfers')
      .select('id, project_id, from_participant_id, to_participant_id, received_at')
      .eq('id', transferId)
      .single()
    transfer = fallback.data
      ? { ...fallback.data, sender_marked_at: null as string | null }
      : null
    transferErr = fallback.error
  }
  if (transferErr || !transfer) throw new Error('Late transfer not found')

  if (transfer.received_at) {
    revalidatePath(`/project/${transfer.project_id}`)
    return
  }

  const { data: sender, error: senderErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('id', transfer.from_participant_id)
    .eq('user_id', uid)
    .limit(1)
  if (senderErr) throw senderErr
  if (!sender || sender.length === 0) throw new Error('Not authorized to mark this transfer')

  const { error: updateErr } = await supabaseAdmin
    .from('late_join_transfers')
    .update({ sender_marked_at: new Date().toISOString() })
    .eq('id', transfer.id)
    .is('sender_marked_at', null)
  if (updateErr) {
    if (missingColumn(updateErr, 'sender_marked_at')) {
      console.warn('[markLateJoinPaid] sender_marked_at missing, skipping mark update')
    } else {
      throw updateErr
    }
  } else {
    await recordProjectActivity({
      projectId: transfer.project_id,
      entryType: 'late_transfer_sender_marked',
      actorUserId: uid,
      actorParticipantId: transfer.from_participant_id,
      targetParticipantId: transfer.to_participant_id,
      lateTransferId: transfer.id,
    })
  }

  revalidatePath(`/project/${transfer.project_id}`)
}

export async function confirmLateJoinReceipt(transferId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')

  const { data: transfer, error: transferErr } = await supabaseAdmin
    .from('late_join_transfers')
    .select('id, project_id, from_participant_id, to_participant_id, received_at')
    .eq('id', transferId)
    .single()
  if (transferErr || !transfer) throw new Error('Late transfer not found')
  if (transfer.received_at) {
    revalidatePath(`/project/${transfer.project_id}`)
    return
  }

  const { data: recipient, error: recipientErr } = await supabaseAdmin
    .from('participants')
    .select('id, user_id, project_id')
    .eq('id', transfer.to_participant_id)
    .single()
  if (recipientErr || !recipient) throw new Error('Recipient participant not found')
  if (recipient.user_id !== uid) throw new Error('Only the recipient can confirm this payment')

  const { error: updateErr } = await supabaseAdmin
    .from('late_join_transfers')
    .update({ received_at: new Date().toISOString() })
    .eq('id', transferId)
  if (updateErr) throw updateErr

  await recordProjectActivity({
    projectId: transfer.project_id,
    entryType: 'late_transfer_collector_confirmed',
    actorUserId: uid,
    actorParticipantId: recipient.id,
    targetParticipantId: transfer.from_participant_id,
    lateTransferId: transfer.id,
  })

  revalidatePath(`/project/${transfer.project_id}`)
}

/**
 * Mark a participant's payment as received.
 */
export async function markReceived(participantId: string) {
  const uid = await getCurrentUserId()
  const { data: participant, error: e1 } = await supabaseAdmin
    .from('participants')
    .select('id, user_id, project_id')
    .eq('id', participantId)
    .single()
  if (e1 || !participant) throw new Error('Participant not found')
  const actor = uid
    ? await getActiveParticipantContext(participant.project_id, uid)
    : { actorUserId: null, actorParticipantId: null as string | null }

  const { data: paymentRow, error: e3 } = await supabaseAdmin
    .from('payments')
    .insert({ participant_id: participantId, is_counted: true })
    .select('id')
    .single()
  if (e3) throw e3

  await recordProjectActivity({
    projectId: participant.project_id,
    entryType: 'payment_confirmed',
    actorUserId: actor.actorUserId,
    actorParticipantId: actor.actorParticipantId,
    targetUserId: participant.user_id ?? null,
    targetParticipantId: participant.id,
    paymentId: paymentRow?.id ?? null,
    metadata: {
      is_counted: true,
    },
  })

  // Clear payment signals if they exist (ignore if table doesn't exist)
  const { error: clrErr } = await supabaseAdmin
    .from('payment_signals')
    .update({ cleared_at: new Date().toISOString() })
    .eq('participant_id', participantId)
    .is('cleared_at', null)
  
  // Don't throw error if table doesn't exist - this is optional functionality
  if (clrErr) {
    const code = (clrErr as any)?.code
    const isMissingTable = code === '42P01' || clrErr.message?.toLowerCase()?.includes('payment_signals')
    if (!isMissingTable) {
      console.error('[markReceived] Error clearing payment signals:', clrErr)
      // Continue anyway - the payment was recorded successfully
    }
  }

  revalidatePath(`/project/${participant.project_id}`)
}

export async function selfReportExtraPaid(extraId: string, payerParticipantId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!extraId || !payerParticipantId) throw new Error('Missing ids')

  const due = await resolveExtraDueForParticipant(extraId, payerParticipantId)
  if (due.payerUserId !== uid) throw new Error('Not your participant entry')
  if (due.collectorParticipantId === due.payerParticipantId) {
    throw new Error('No transfer is needed for this extra')
  }
  if (!due.minParticipantsReached) {
    throw new Error('Waiting for minimum participants')
  }

  const nowIso = new Date().toISOString()
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('extra_payments')
    .select('id, reported_at, confirmed_at')
    .eq('extra_id', extraId)
    .eq('payer_participant_id', payerParticipantId)
    .maybeSingle()
  if (existingErr) {
    if (missingTable(existingErr, 'extra_payments')) throw friendlyExtraPaymentsUnavailableError()
    throw new Error(existingErr.message ?? 'Failed to load extra payment')
  }
  if (existing?.confirmed_at) {
    revalidatePath(`/project/${due.projectId}`)
    return
  }

  if (existing?.id) {
    const { error: updateErr } = await supabaseAdmin
      .from('extra_payments')
      .update({
        collector_participant_id: due.collectorParticipantId,
        amount_cents: due.amountCents,
        reported_at: nowIso,
      })
      .eq('id', existing.id)
    if (updateErr) {
      if (missingTable(updateErr, 'extra_payments')) throw friendlyExtraPaymentsUnavailableError()
      throw new Error(updateErr.message ?? 'Failed to report extra payment')
    }
  } else {
    const { error: insertErr } = await supabaseAdmin
      .from('extra_payments')
      .insert({
        extra_id: extraId,
        payer_participant_id: payerParticipantId,
        collector_participant_id: due.collectorParticipantId,
        amount_cents: due.amountCents,
        reported_at: nowIso,
      })
    if (insertErr) {
      if (missingTable(insertErr, 'extra_payments')) throw friendlyExtraPaymentsUnavailableError()
      throw new Error(insertErr.message ?? 'Failed to report extra payment')
    }
  }

  await recordProjectActivity({
    projectId: due.projectId,
    entryType: 'payment_reported',
    actorUserId: uid,
    actorParticipantId: due.payerParticipantId,
    targetUserId: uid,
    targetParticipantId: due.payerParticipantId,
    extraId,
    metadata: {
      scope: 'extra',
      amount_cents: due.amountCents,
      collector_participant_id: due.collectorParticipantId,
      title: due.extraTitle,
    },
  })

  revalidatePath(`/project/${due.projectId}`)
}

export async function markExtraReceived(extraId: string, payerParticipantId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!extraId || !payerParticipantId) throw new Error('Missing ids')

  const due = await resolveExtraDueForParticipant(extraId, payerParticipantId)
  if (due.collectorParticipantId === due.payerParticipantId) {
    revalidatePath(`/project/${due.projectId}`)
    return
  }
  if (!due.minParticipantsReached) {
    throw new Error('Waiting for minimum participants')
  }

  const me = await requireActiveProjectParticipant(due.projectId, uid)
  if (me.id !== due.collectorParticipantId) throw new Error('Only this extra collector can confirm payment')

  const nowIso = new Date().toISOString()
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('extra_payments')
    .select('id, reported_at, confirmed_at')
    .eq('extra_id', extraId)
    .eq('payer_participant_id', payerParticipantId)
    .maybeSingle()
  if (existingErr) {
    if (missingTable(existingErr, 'extra_payments')) throw friendlyExtraPaymentsUnavailableError()
    throw new Error(existingErr.message ?? 'Failed to load extra payment')
  }
  if (existing?.confirmed_at) {
    revalidatePath(`/project/${due.projectId}`)
    return
  }

  if (existing?.id) {
    const { error: updateErr } = await supabaseAdmin
      .from('extra_payments')
      .update({
        collector_participant_id: due.collectorParticipantId,
        amount_cents: due.amountCents,
        reported_at: existing.reported_at ?? null,
        confirmed_at: nowIso,
        confirmed_by_participant_id: me.id,
      })
      .eq('id', existing.id)
    if (updateErr) {
      if (missingTable(updateErr, 'extra_payments')) throw friendlyExtraPaymentsUnavailableError()
      throw new Error(updateErr.message ?? 'Failed to confirm extra payment')
    }
  } else {
    const { error: insertErr } = await supabaseAdmin
      .from('extra_payments')
      .insert({
        extra_id: extraId,
        payer_participant_id: payerParticipantId,
        collector_participant_id: due.collectorParticipantId,
        amount_cents: due.amountCents,
        confirmed_at: nowIso,
        confirmed_by_participant_id: me.id,
      })
    if (insertErr) {
      if (missingTable(insertErr, 'extra_payments')) throw friendlyExtraPaymentsUnavailableError()
      throw new Error(insertErr.message ?? 'Failed to confirm extra payment')
    }
  }

  await recordProjectActivity({
    projectId: due.projectId,
    entryType: 'payment_confirmed',
    actorUserId: uid,
    actorParticipantId: me.id,
    targetUserId: due.payerUserId,
    targetParticipantId: due.payerParticipantId,
    extraId,
    metadata: {
      scope: 'extra',
      amount_cents: due.amountCents,
      collector_participant_id: due.collectorParticipantId,
      title: due.extraTitle,
    },
  })

  revalidatePath(`/project/${due.projectId}`)
}

export async function postMessage(projectId: string, body: string, parentId?: string | null) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in to post')
  if (!projectId) throw new Error('Missing project id')

  const text = (body ?? '').trim()
  if (!text) throw new Error('Message cannot be empty')
  if (text.length > 2000) throw new Error('Message is too long')

  const parent = parentId?.trim() ? parentId : null

  const { error } = await supabaseAdmin
    .from('messages')
    .insert({ project_id: projectId, user_id: uid, author_user_id: uid, body: text, parent_id: parent })

  if (error) {
    console.error('[postMessage] failed', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    throw new Error(error.message || 'Failed to post message')
  }

  const { error: readErr } = await supabaseAdmin
    .from('chat_reads')
    .upsert(
      {
        project_id: projectId,
        user_id: uid,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,user_id' }
    )
  if (readErr) {
    const msg = readErr.message?.toLowerCase() ?? ''
    const missingTable = readErr.code === '42P01' || msg.includes('chat_reads')
    if (!missingTable) {
      console.error('[postMessage] chat_reads upsert failed', readErr)
    }
  }

  revalidatePath(`/project/${projectId}`)
}

/** Create a poll with options (single choice). */
export async function createPoll(projectId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')

  const title = ((formData.get('project_title') as string) || (formData.get('title') as string) || '').trim()
  const description =
    ((formData.get('project_description') as string) || (formData.get('description') as string) || '').trim() || null
  const extraCostRaw = (formData.get('extra_cost') as string)?.trim() || ''
  const extraIsPerPerson = (formData.get('extra_is_per_person') as string) === 'true'
  const requiredVotesRaw = (formData.get('required_votes') as string)?.trim() || ''
  const optionsRaw = (formData.get('options') as string)?.trim() || ''
  if (!title) throw new Error('Title is required')

  const extraCost = extraCostRaw ? Number(extraCostRaw.replace(',', '.')) : 0
  if (!Number.isFinite(extraCost) || extraCost < 0) throw new Error('Invalid extra cost')
  const extraCents = Math.round(extraCost * 100)

  const requiredVotes = requiredVotesRaw ? Number.parseInt(requiredVotesRaw, 10) : 1
  if (!Number.isFinite(requiredVotes) || requiredVotes < 1) throw new Error('Invalid required votes')

  const options = optionsRaw
    .split(/\r?\n/)
    .map(opt => opt.trim())
    .filter(Boolean)
  if (options.length === 0) throw new Error('At least one option is required')

  const { data: participant, error: participantErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .is('left_at', null)
    .limit(1)
  if (participantErr) throw new Error(participantErr.message ?? 'Failed to verify participant access')
  if (!participant?.length) throw new Error('Only participants can create proposals')

  let poll: { id: string } | null = null
  const insertWithType = await supabaseAdmin
    .from('polls')
    .insert({
      project_id: projectId,
      title,
      description,
      extra_cents: extraCents,
      extra_is_per_person: extraIsPerPerson,
      required_votes: requiredVotes,
      created_by: uid,
    })
    .select('id')
    .single()
  if (insertWithType.error) {
    if (missingColumn(insertWithType.error, 'extra_is_per_person')) {
      const fallbackInsert = await supabaseAdmin
        .from('polls')
        .insert({
          project_id: projectId,
          title,
          description,
          extra_cents: extraCents,
          required_votes: requiredVotes,
          created_by: uid,
        })
        .select('id')
        .single()
      if (fallbackInsert.error) throw new Error(fallbackInsert.error.message ?? 'Failed to create poll')
      poll = fallbackInsert.data
    } else {
      throw new Error(insertWithType.error.message ?? 'Failed to create poll')
    }
  } else {
    poll = insertWithType.data
  }
  if (!poll?.id) throw new Error('Failed to create poll')

  const { error: optionsErr } = await supabaseAdmin
    .from('poll_options')
    .insert(options.map(label => ({ poll_id: poll.id, label })))
  if (optionsErr) throw new Error(optionsErr.message ?? 'Failed to create poll options')

  await recordProjectActivity({
    projectId,
    entryType: 'poll_created',
    actorUserId: uid,
    actorParticipantId: participant[0].id,
    pollId: poll.id,
    metadata: {
      title,
      options_count: options.length,
      extra_cents: extraCents,
      extra_is_per_person: extraIsPerPerson,
      required_votes: requiredVotes,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

/** Cast a vote for a poll option (single choice per poll). */
export async function castPollVote(projectId: string, pollId: string, optionId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')

  const { data: poll, error: pollErr } = await supabaseAdmin
    .from('polls')
    .select('id, project_id')
    .eq('id', pollId)
    .single()
  if (pollErr || !poll) throw pollErr || new Error('Poll not found')
  if (poll.project_id !== projectId) throw new Error('Invalid poll')

  const { data: option, error: optionErr } = await supabaseAdmin
    .from('poll_options')
    .select('id, poll_id')
    .eq('id', optionId)
    .single()
  if (optionErr || !option) throw optionErr || new Error('Option not found')
  if (option.poll_id !== pollId) throw new Error('Invalid option')

  const { data: participant, error: participantErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .is('left_at', null)
    .limit(1)
  if (participantErr) throw participantErr
  if (!participant?.length) throw new Error('Only participants can vote')

  const { data: existingVote, error: existingVoteErr } = await supabaseAdmin
    .from('poll_votes')
    .select('option_id')
    .eq('user_id', uid)
    .eq('poll_id', pollId)
    .maybeSingle()
  if (existingVoteErr) throw existingVoteErr

  const { error: deleteErr } = await supabaseAdmin
    .from('poll_votes')
    .delete()
    .eq('user_id', uid)
    .eq('poll_id', pollId)
  if (deleteErr) throw deleteErr

  const { error } = await supabaseAdmin
    .from('poll_votes')
    .insert({ poll_id: pollId, option_id: optionId, user_id: uid })
  if (error) throw error

  const changedVote = !!existingVote && existingVote.option_id !== optionId
  await recordProjectActivity({
    projectId,
    entryType: changedVote ? 'poll_vote_changed' : 'poll_vote_cast',
    actorUserId: uid,
    actorParticipantId: participant[0].id,
    pollId,
    metadata: {
      previous_option_id: existingVote?.option_id ?? null,
      option_id: optionId,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

async function requirePollManager(projectId: string, pollId: string, uid: string) {
  const { data: poll, error: pollErr } = await supabaseAdmin
    .from('polls')
    .select('id, project_id, created_by, title')
    .eq('id', pollId)
    .single()
  if (pollErr || !poll) throw pollErr || new Error('Poll not found')
  if (poll.project_id !== projectId) throw new Error('Invalid poll')
  if (poll.created_by === uid) return poll

  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('collector_participant_id')
    .eq('id', projectId)
    .single()
  if (projectErr) throw projectErr

  if (project?.collector_participant_id) {
    const { data: collector, error: collectorErr } = await supabaseAdmin
      .from('participants')
      .select('id')
      .eq('id', project.collector_participant_id)
      .eq('user_id', uid)
      .is('left_at', null)
      .maybeSingle()
    if (collectorErr) throw collectorErr
    if (collector) return poll
  }

  throw new Error('Not authorized')
}

export async function updatePoll(projectId: string, pollId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')

  const managedPoll = await requirePollManager(projectId, pollId, uid)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

  const title = ((formData.get('project_title') as string) || (formData.get('title') as string) || '').trim()
  const description =
    ((formData.get('project_description') as string) || (formData.get('description') as string) || '').trim() || null
  const extraCostRaw = (formData.get('extra_cost') as string)?.trim() || ''
  const extraIsPerPerson = (formData.get('extra_is_per_person') as string) === 'true'
  const requiredVotesRaw = (formData.get('required_votes') as string)?.trim() || ''
  const optionsRaw = (formData.get('options') as string)?.trim() || ''
  if (!title) throw new Error('Title is required')

  const extraCost = extraCostRaw ? Number(extraCostRaw.replace(',', '.')) : 0
  if (!Number.isFinite(extraCost) || extraCost < 0) throw new Error('Invalid extra cost')
  const extraCents = Math.round(extraCost * 100)

  const requiredVotes = requiredVotesRaw ? Number.parseInt(requiredVotesRaw, 10) : 1
  if (!Number.isFinite(requiredVotes) || requiredVotes < 1) throw new Error('Invalid required votes')

  const options = optionsRaw
    .split(/\r?\n/)
    .map(opt => opt.trim())
    .filter(Boolean)
  if (options.length === 0) throw new Error('At least one option is required')

  const updateWithType = await supabaseAdmin
    .from('polls')
    .update({
      title,
      description,
      extra_cents: extraCents,
      extra_is_per_person: extraIsPerPerson,
      required_votes: requiredVotes,
    })
    .eq('id', pollId)
    .eq('project_id', projectId)
  if (updateWithType.error) {
    if (missingColumn(updateWithType.error, 'extra_is_per_person')) {
      const fallbackUpdate = await supabaseAdmin
        .from('polls')
        .update({
          title,
          description,
          extra_cents: extraCents,
          required_votes: requiredVotes,
        })
        .eq('id', pollId)
        .eq('project_id', projectId)
      if (fallbackUpdate.error) throw fallbackUpdate.error
    } else {
      throw updateWithType.error
    }
  }

  const { error: deleteErr } = await supabaseAdmin
    .from('poll_options')
    .delete()
    .eq('poll_id', pollId)
  if (deleteErr) throw deleteErr

  const { error: optionsErr } = await supabaseAdmin
    .from('poll_options')
    .insert(options.map(label => ({ poll_id: pollId, label })))
  if (optionsErr) throw optionsErr

  await recordProjectActivity({
    projectId,
    entryType: 'poll_updated',
    actorUserId,
    actorParticipantId,
    pollId,
    metadata: {
      previous_title: managedPoll.title ?? null,
      title,
      options_count: options.length,
      extra_cents: extraCents,
      extra_is_per_person: extraIsPerPerson,
      required_votes: requiredVotes,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

export async function deletePoll(projectId: string, pollId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')

  const managedPoll = await requirePollManager(projectId, pollId, uid)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

  const { error } = await supabaseAdmin
    .from('polls')
    .delete()
    .eq('id', pollId)
    .eq('project_id', projectId)
  if (error) throw error

  await recordProjectActivity({
    projectId,
    entryType: 'poll_deleted',
    actorUserId,
    actorParticipantId,
    pollId,
    metadata: {
      title: managedPoll.title ?? null,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

type ExtraCollectionMode = 'project_collector' | 'dedicated_collector'

const parseExtraCollectionMode = (value: string | null | undefined): ExtraCollectionMode =>
  value === 'dedicated_collector' ? 'dedicated_collector' : 'project_collector'

const normalizeEuroAmountToCents = (value: string | null | undefined) => {
  const raw = (value ?? '').trim()
  const parsed = raw ? Number(raw.replace(',', '.')) : 0
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Invalid amount')
  }
  return Math.round(parsed * 100)
}

const friendlyExtrasUnavailableError = () =>
  new Error('Extras are unavailable until the latest database migration is applied')

const friendlyExtraPaymentsUnavailableError = () =>
  new Error('Extra payments are unavailable until the latest database migration is applied')

type ResolvedExtraDue = {
  projectId: string
  extraTitle: string | null
  payerParticipantId: string
  payerUserId: string | null
  collectorParticipantId: string
  amountCents: number
  minParticipantsReached: boolean
}

const resolveExtraDueForParticipant = async (
  extraId: string,
  payerParticipantId: string
): Promise<ResolvedExtraDue> => {
  const { data: extra, error: extraErr } = await supabaseAdmin
    .from('extras')
    .select(
      'id, project_id, title, amount_cents, amount_is_per_person, collection_mode, dedicated_collector_participant_id'
    )
    .eq('id', extraId)
    .maybeSingle()
  if (extraErr) {
    if (missingTable(extraErr, 'extras')) throw friendlyExtrasUnavailableError()
    throw new Error(extraErr.message ?? 'Failed to load extra')
  }
  if (!extra) throw new Error('Extra not found')

  const { data: payerParticipant, error: payerErr } = await supabaseAdmin
    .from('participants')
    .select('id, user_id, project_id, left_at')
    .eq('id', payerParticipantId)
    .maybeSingle()
  if (payerErr) throw new Error(payerErr.message ?? 'Failed to load participant')
  if (!payerParticipant || payerParticipant.project_id !== extra.project_id || !!payerParticipant.left_at) {
    throw new Error('Participant is not active in this project')
  }

  const [
    { data: project, error: projectErr },
    { data: activeParticipants, error: activeParticipantsErr },
    { data: memberships, error: membershipsErr },
  ] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('id, collector_participant_id, min_participants')
      .eq('id', extra.project_id)
      .maybeSingle(),
    supabaseAdmin
      .from('participants')
      .select('id')
      .eq('project_id', extra.project_id)
      .is('left_at', null),
    supabaseAdmin
      .from('extra_memberships')
      .select('extra_id, participant_id, left_at')
      .eq('extra_id', extraId)
      .is('left_at', null),
  ])

  if (projectErr) throw new Error(projectErr.message ?? 'Failed to load project')
  if (!project) throw new Error('Project not found')
  if (activeParticipantsErr) throw new Error(activeParticipantsErr.message ?? 'Failed to load participants')
  if (membershipsErr) {
    if (missingTable(membershipsErr, 'extra_memberships')) throw friendlyExtrasUnavailableError()
    throw new Error(membershipsErr.message ?? 'Failed to load extra members')
  }

  const activeParticipantIds = new Set((activeParticipants ?? []).map(participant => participant.id))
  const dueRows = buildExtraDueRows({
    extras: [
      {
        id: extra.id,
        title: extra.title ?? null,
        amount_cents: Number(extra.amount_cents ?? 0),
        amount_is_per_person: !!extra.amount_is_per_person,
        collection_mode: extra.collection_mode ?? null,
        dedicated_collector_participant_id: extra.dedicated_collector_participant_id ?? null,
      },
    ],
    memberships: (memberships ?? []).map(membership => ({
      extra_id: membership.extra_id,
      participant_id: membership.participant_id,
      left_at: membership.left_at,
    })),
    activeParticipantIds,
    projectCollectorParticipantId: project.collector_participant_id ?? null,
  })

  const due = dueRows.find(row => row.payer_participant_id === payerParticipant.id)
  if (!due || due.amount_cents <= 0) throw new Error('No payable share for this extra')
  const minParticipants =
    typeof project.min_participants === 'number' && Number.isFinite(project.min_participants)
      ? project.min_participants
      : null
  const minParticipantsReached = minParticipants === null || activeParticipantIds.size >= minParticipants

  return {
    projectId: extra.project_id,
    extraTitle: extra.title ?? null,
    payerParticipantId: payerParticipant.id,
    payerUserId: payerParticipant.user_id ?? null,
    collectorParticipantId: due.collector_participant_id,
    amountCents: due.amount_cents,
    minParticipantsReached,
  }
}

export async function createExtra(projectId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')

  const me = await requireActiveProjectParticipant(projectId, uid)

  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const amountRaw = String(formData.get('amount') ?? '').trim()
  if (!amountRaw) throw new Error('Amount is required')
  const amountCents = normalizeEuroAmountToCents(amountRaw)
  const amountIsPerPerson = String(formData.get('amount_is_per_person') ?? '') === 'true'
  const collectionMode = parseExtraCollectionMode(String(formData.get('collection_mode') ?? ''))
  const dedicatedCollectorRaw = String(formData.get('dedicated_collector_participant_id') ?? '').trim()
  if (!title) throw new Error('Title is required')

  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('id, collector_participant_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectErr) throw new Error(projectErr.message ?? 'Failed to read project')
  if (!project) throw new Error('Project not found')

  let dedicatedCollectorId: string | null = null
  if (collectionMode === 'dedicated_collector') {
    if (!dedicatedCollectorRaw) throw new Error('Select an extra collector')
    const { data: target, error: targetErr } = await supabaseAdmin
      .from('participants')
      .select('id, project_id, left_at')
      .eq('id', dedicatedCollectorRaw)
      .maybeSingle()
    if (targetErr) throw new Error(targetErr.message ?? 'Failed to verify dedicated collector')
    if (!target || target.project_id !== projectId || !!target.left_at) {
      throw new Error('Extra collector must be an active participant')
    }
    dedicatedCollectorId = target.id
  }

  const { data: created, error: createErr } = await supabaseAdmin
    .from('extras')
    .insert({
      project_id: projectId,
      title,
      description,
      amount_cents: amountCents,
      amount_is_per_person: amountIsPerPerson,
      collection_mode: collectionMode,
      dedicated_collector_participant_id: dedicatedCollectorId,
      created_by: uid,
    })
    .select('id')
    .single()
  if (createErr) {
    if (missingTable(createErr, 'extras')) throw friendlyExtrasUnavailableError()
    throw new Error(createErr.message ?? 'Failed to create extra')
  }
  if (!created?.id) throw new Error('Failed to create extra')

  const { error: membershipErr } = await supabaseAdmin
    .from('extra_memberships')
    .upsert(
      {
        extra_id: created.id,
        participant_id: me.id,
        joined_at: new Date().toISOString(),
        left_at: null,
      },
      { onConflict: 'extra_id,participant_id' }
    )
  if (membershipErr) {
    if (missingTable(membershipErr, 'extra_memberships')) throw friendlyExtrasUnavailableError()
    throw new Error(membershipErr.message ?? 'Failed to join created extra')
  }

  if (dedicatedCollectorId && dedicatedCollectorId !== me.id) {
    const { error: dedicatedMembershipErr } = await supabaseAdmin
      .from('extra_memberships')
      .upsert(
        {
          extra_id: created.id,
          participant_id: dedicatedCollectorId,
          joined_at: new Date().toISOString(),
          left_at: null,
        },
        { onConflict: 'extra_id,participant_id' }
      )
    if (dedicatedMembershipErr) {
      if (missingTable(dedicatedMembershipErr, 'extra_memberships')) throw friendlyExtrasUnavailableError()
      throw new Error(dedicatedMembershipErr.message ?? 'Failed to add extra collector')
    }
  }

  await recordProjectActivity({
    projectId,
    entryType: 'extra_created',
    actorUserId: uid,
    actorParticipantId: me.id,
    targetParticipantId: dedicatedCollectorId,
    extraId: created.id,
    metadata: {
      title,
      amount_cents: amountCents,
      amount_is_per_person: amountIsPerPerson,
      collection_mode: collectionMode,
      dedicated_collector_participant_id: dedicatedCollectorId,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

export async function joinExtra(projectId: string, extraId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId || !extraId) throw new Error('Missing ids')

  const me = await requireActiveProjectParticipant(projectId, uid)
  const { data: extra, error: extraErr } = await supabaseAdmin
    .from('extras')
    .select('id, project_id, title')
    .eq('id', extraId)
    .maybeSingle()
  if (extraErr) {
    if (missingTable(extraErr, 'extras')) throw friendlyExtrasUnavailableError()
    throw new Error(extraErr.message ?? 'Failed to load extra')
  }
  if (!extra || extra.project_id !== projectId) throw new Error('Extra not found')

  const { error: membershipErr } = await supabaseAdmin
    .from('extra_memberships')
    .upsert(
      {
        extra_id: extraId,
        participant_id: me.id,
        joined_at: new Date().toISOString(),
        left_at: null,
      },
      { onConflict: 'extra_id,participant_id' }
    )
  if (membershipErr) {
    if (missingTable(membershipErr, 'extra_memberships')) throw friendlyExtrasUnavailableError()
    throw new Error(membershipErr.message ?? 'Failed to join extra')
  }

  await recordProjectActivity({
    projectId,
    entryType: 'extra_joined',
    actorUserId: uid,
    actorParticipantId: me.id,
    targetUserId: uid,
    targetParticipantId: me.id,
    extraId,
    metadata: {
      title: extra.title ?? null,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

export async function leaveExtra(projectId: string, extraId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId || !extraId) throw new Error('Missing ids')

  const me = await requireActiveProjectParticipant(projectId, uid)
  const { data: extra, error: extraErr } = await supabaseAdmin
    .from('extras')
    .select('id, project_id, title, collection_mode, dedicated_collector_participant_id')
    .eq('id', extraId)
    .maybeSingle()
  if (extraErr) {
    if (missingTable(extraErr, 'extras')) throw friendlyExtrasUnavailableError()
    throw new Error(extraErr.message ?? 'Failed to load extra')
  }
  if (!extra || extra.project_id !== projectId) throw new Error('Extra not found')

  const { error: leaveErr } = await supabaseAdmin
    .from('extra_memberships')
    .update({ left_at: new Date().toISOString() })
    .eq('extra_id', extraId)
    .eq('participant_id', me.id)
    .is('left_at', null)
  if (leaveErr) {
    if (missingTable(leaveErr, 'extra_memberships')) throw friendlyExtrasUnavailableError()
    throw new Error(leaveErr.message ?? 'Failed to leave extra')
  }

  await recordProjectActivity({
    projectId,
    entryType: 'extra_left',
    actorUserId: uid,
    actorParticipantId: me.id,
    targetUserId: uid,
    targetParticipantId: me.id,
    extraId,
    metadata: {
      title: extra.title ?? null,
    },
  })

  if (
    extra.collection_mode === 'dedicated_collector' &&
    extra.dedicated_collector_participant_id &&
    extra.dedicated_collector_participant_id === me.id
  ) {
    const { error: fallbackCollectorErr } = await supabaseAdmin
      .from('extras')
      .update({
        collection_mode: 'project_collector',
        dedicated_collector_participant_id: null,
      })
      .eq('id', extraId)
    if (fallbackCollectorErr) {
      throw new Error(fallbackCollectorErr.message ?? 'Failed to reset extra collector')
    }

    await recordProjectActivity({
      projectId,
      entryType: 'extra_collector_changed',
      actorUserId: uid,
      actorParticipantId: me.id,
      extraId,
      metadata: {
        title: extra.title ?? null,
        from_collection_mode: 'dedicated_collector',
        to_collection_mode: 'project_collector',
        from_dedicated_collector_participant_id: me.id,
        to_dedicated_collector_participant_id: null,
      },
    })
  }

  revalidatePath(`/project/${projectId}`)
}

export async function updateExtraCollector(projectId: string, extraId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId || !extraId) throw new Error('Missing ids')
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

  const { data: extra, error: extraErr } = await supabaseAdmin
    .from('extras')
    .select('id, project_id, created_by, title, collection_mode, dedicated_collector_participant_id')
    .eq('id', extraId)
    .maybeSingle()
  if (extraErr) {
    if (missingTable(extraErr, 'extras')) throw friendlyExtrasUnavailableError()
    throw new Error(extraErr.message ?? 'Failed to load extra')
  }
  if (!extra || extra.project_id !== projectId) throw new Error('Extra not found')

  if (extra.created_by !== uid) {
    await requireActiveManager(projectId, uid)
  }

  const collectionMode = parseExtraCollectionMode(String(formData.get('collection_mode') ?? ''))
  const dedicatedCollectorRaw = String(formData.get('dedicated_collector_participant_id') ?? '').trim()

  let dedicatedCollectorId: string | null = null
  if (collectionMode === 'dedicated_collector') {
    if (!dedicatedCollectorRaw) throw new Error('Select an extra collector')
    const { data: target, error: targetErr } = await supabaseAdmin
      .from('participants')
      .select('id, project_id, left_at')
      .eq('id', dedicatedCollectorRaw)
      .maybeSingle()
    if (targetErr) throw new Error(targetErr.message ?? 'Failed to verify dedicated collector')
    if (!target || target.project_id !== projectId || !!target.left_at) {
      throw new Error('Extra collector must be an active participant')
    }
    dedicatedCollectorId = target.id
  }

  const { error: updateErr } = await supabaseAdmin
    .from('extras')
    .update({
      collection_mode: collectionMode,
      dedicated_collector_participant_id: dedicatedCollectorId,
    })
    .eq('id', extraId)
  if (updateErr) {
    if (missingTable(updateErr, 'extras')) throw friendlyExtrasUnavailableError()
    throw new Error(updateErr.message ?? 'Failed to update collector')
  }

  if (dedicatedCollectorId) {
    const { error: dedicatedMembershipErr } = await supabaseAdmin
      .from('extra_memberships')
      .upsert(
        {
          extra_id: extraId,
          participant_id: dedicatedCollectorId,
          joined_at: new Date().toISOString(),
          left_at: null,
        },
        { onConflict: 'extra_id,participant_id' }
      )
  if (dedicatedMembershipErr) {
      if (missingTable(dedicatedMembershipErr, 'extra_memberships')) throw friendlyExtrasUnavailableError()
      throw new Error(dedicatedMembershipErr.message ?? 'Failed to add extra collector')
    }
  }

  await recordProjectActivity({
    projectId,
    entryType: 'extra_collector_changed',
    actorUserId,
    actorParticipantId,
    targetParticipantId: dedicatedCollectorId,
    extraId,
    metadata: {
      title: extra.title ?? null,
      from_collection_mode: extra.collection_mode,
      to_collection_mode: collectionMode,
      from_dedicated_collector_participant_id: extra.dedicated_collector_participant_id ?? null,
      to_dedicated_collector_participant_id: dedicatedCollectorId,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

export async function updateProjectSettings(projectId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select(
      'id, collector_participant_id, title, description, total_cents, total_is_per_person, min_participants, max_participants, event_start_at, event_end_at'
    )
    .eq('id', projectId)
    .single()
  if (projectErr || !project) throw projectErr || new Error('Project not found')

  if (!project.collector_participant_id) {
    throw new Error('Collector not set')
  }

  const { data: collector, error: collectorErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('id', project.collector_participant_id)
    .eq('user_id', uid)
    .is('left_at', null)
    .maybeSingle()
  if (collectorErr) throw collectorErr
  if (!collector) throw new Error('Not authorized')

  const title = ((formData.get('project_title') as string) || (formData.get('title') as string) || '').trim()
  const description =
    ((formData.get('project_description') as string) || (formData.get('description') as string) || '').trim() || null
  const totalEur = (formData.get('totalEur') as string) ?? ''
  const totalIsPerPerson = (formData.get('total_is_per_person') as string) === 'true'
  const minRaw = String(formData.get('min_participants') ?? '').trim()
  const maxRaw = String(formData.get('max_participants') ?? '').trim()
  const eventStartDate = (formData.get('event_start_date') as string) ?? null
  const eventStartTime = (formData.get('event_start_time') as string) ?? null
  const eventEndDate = (formData.get('event_end_date') as string) ?? null
  const eventEndTime = (formData.get('event_end_time') as string) ?? null
  if (!title) throw new Error('Title is required')

  const normalizedAmount = totalEur.replace(',', '.').trim()
  const amountFloat = parseFloat(normalizedAmount)
  if (!isFinite(amountFloat) || amountFloat < 0) {
    throw new Error('Invalid total amount')
  }
  const total_cents = Math.round(amountFloat * 100)

  const minParticipants = minRaw === '' ? null : Number(minRaw)
  const maxParticipants = maxRaw === '' ? null : Number(maxRaw)
  if (minParticipants !== null && (!Number.isFinite(minParticipants) || minParticipants < 1)) {
    throw new Error('Min participants must be at least 1')
  }
  if (maxParticipants !== null && (!Number.isFinite(maxParticipants) || maxParticipants < 1)) {
    throw new Error('Max participants must be at least 1')
  }
  if (minParticipants !== null && maxParticipants !== null && maxParticipants < minParticipants) {
    throw new Error('Max participants must be greater than or equal to min participants')
  }

  const toInputDate = (iso: string | null | undefined) => {
    if (!iso) return ''
    const parsed = new Date(iso)
    if (Number.isNaN(parsed.getTime())) return ''
    const month = String(parsed.getMonth() + 1).padStart(2, '0')
    const day = String(parsed.getDate()).padStart(2, '0')
    return `${parsed.getFullYear()}-${month}-${day}`
  }
  const toInputTime = (iso: string | null | undefined) => {
    if (!iso) return ''
    const parsed = new Date(iso)
    if (Number.isNaN(parsed.getTime())) return ''
    const hours = String(parsed.getHours()).padStart(2, '0')
    const minutes = String(parsed.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  }

  const parseEventDateTime = (
    dateValue: string | null | undefined,
    timeValue: string | null | undefined,
    existingIso: string | null | undefined,
    defaultTime: string
  ) => {
    const dateRaw = (dateValue ?? '').trim()
    const timeRaw = (timeValue ?? '').trim()
    if (!dateRaw && !timeRaw) return null
    if (!dateRaw && timeRaw) {
      throw new Error('Event time requires a date')
    }

    const existingDate = toInputDate(existingIso)
    const existingTime = toInputTime(existingIso)
    if (existingIso && dateRaw && dateRaw === existingDate) {
      if (!timeRaw || timeRaw === existingTime) {
        const localKey = `${existingDate}T${existingTime || defaultTime}`
        return { iso: existingIso, localKey }
      }
    }

    const time =
      timeRaw ||
      (() => {
        if (existingTime) return existingTime
        return defaultTime
      })()
    const combined = `${dateRaw}T${time}`
    const parsed = new Date(combined)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Invalid event date or time')
    }
    return { iso: parsed.toISOString(), localKey: combined }
  }
  const parsedEventStart = parseEventDateTime(eventStartDate, eventStartTime, project.event_start_at, '09:00')
  const parsedEventEnd = parseEventDateTime(eventEndDate, eventEndTime, project.event_end_at, '17:00')
  const eventStartAt = parsedEventStart?.iso ?? null
  const eventEndAt = parsedEventEnd?.iso ?? null
  if (
    parsedEventStart?.localKey &&
    parsedEventEnd?.localKey &&
    parsedEventEnd.localKey < parsedEventStart.localKey
  ) {
    throw new Error('Event end must be after event start')
  }

  const { error } = await supabaseAdmin
    .from('projects')
    .update({
      title,
      description,
      total_cents,
      total_is_per_person: totalIsPerPerson,
      min_participants: minParticipants,
      max_participants: maxParticipants,
      event_start_at: eventStartAt,
      event_end_at: eventEndAt,
    })
    .eq('id', projectId)
  if (error) throw error

  const changedFields: string[] = []
  if ((project.title ?? null) !== title) changedFields.push('title')
  if ((project.description ?? null) !== description) changedFields.push('description')
  if (Number(project.total_cents ?? 0) !== total_cents) changedFields.push('total_cents')
  if (!!project.total_is_per_person !== totalIsPerPerson) changedFields.push('total_is_per_person')
  if ((project.min_participants ?? null) !== minParticipants) changedFields.push('min_participants')
  if ((project.max_participants ?? null) !== maxParticipants) changedFields.push('max_participants')
  if ((project.event_start_at ?? null) !== eventStartAt) changedFields.push('event_start_at')
  if ((project.event_end_at ?? null) !== eventEndAt) changedFields.push('event_end_at')

  await recordProjectActivity({
    projectId,
    entryType: 'project_updated',
    actorUserId,
    actorParticipantId,
    metadata: {
      changed_fields: changedFields,
    },
  })

  revalidatePath(`/project/${projectId}`)
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

export async function markChatRead(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')

  const { data: participant, error: participantErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .is('left_at', null)
    .limit(1)
  if (participantErr) throw participantErr
  if (!participant?.length) return

  const { error } = await supabaseAdmin
    .from('chat_reads')
    .upsert(
      {
        project_id: projectId,
        user_id: uid,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,user_id' }
    )
  if (error) {
    const msg = error.message?.toLowerCase() ?? ''
    const missingTable = error.code === '42P01' || msg.includes('chat_reads')
    if (missingTable) return
    throw error
  }
}

export async function cancelJoinRequest(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

  const { data: requestsToCancel, error: requestsErr } = await supabaseAdmin
    .from('join_requests')
    .select('id, status')
    .eq('project_id', projectId)
    .eq('requester_user_id', uid)
    .neq('status', 'canceled')
  if (requestsErr) {
    console.error('[cancelJoinRequest] read existing requests error', requestsErr)
  }

  const { error: updErr } = await supabaseAdmin
    .from('join_requests')
    .update({ status: 'canceled' })
    .eq('project_id', projectId)
    .eq('requester_user_id', uid)

  if (updErr) {
    console.error('[cancelJoinRequest] update error', updErr)
    revalidatePath(`/project/${projectId}`)
    return { ok: false, error: updErr.message }
  }

  for (const request of requestsToCancel ?? []) {
    await recordProjectActivity({
      projectId,
      entryType: 'join_request_canceled',
      actorUserId,
      actorParticipantId,
      targetUserId: uid,
      joinRequestId: request.id,
      metadata: {
        previous_status: request.status ?? null,
      },
    })
  }

  revalidatePath(`/project/${projectId}`)
  return { ok: true }
}

export async function cancelJoinRequestFromForm(formData: FormData) {
  const projectId = String(formData.get('projectId') || '')
  if (!projectId) {
    console.error('[cancelJoinRequestFromForm] Missing projectId')
    return { ok: false, error: 'Missing projectId' }
  }

  try {
    const result = await cancelJoinRequest(projectId)
    console.log('[cancelJoinRequestFromForm] cancel result', { projectId, result })
    return result
  } catch (err: any) {
    console.error('[cancelJoinRequestFromForm] error', { projectId, error: err?.message || err, stack: err?.stack })
    revalidatePath(`/project/${projectId}`)
    return { ok: false, error: err?.message || 'Unknown error' }
  }
}
