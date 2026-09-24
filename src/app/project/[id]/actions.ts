'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { recordProjectActivity } from '@/lib/activityLog'
import { calculateProjectPricing, validateBundlePricingConfig } from '@/lib/projectPricing'
import { getCurrentUserId } from '@/lib/supabaseServer'
import { getProjectStatusUiKey } from '@/lib/projectStatusUi'
import { canManageProjectJoinRequests } from '@/lib/projectJoinRequests'
import { buildExtraDueRows } from '@/lib/extraPayments'
import {
  applyTimeToDateOption,
  canRemoveDateOption,
  canSuggestDate,
  normalizeDateOption,
  rankDateOptions,
  reenterViaLateJoinFlow,
  type DateAvailability,
  type DateOptionLike,
  type DateResponseLike,
  type ParticipantAttendanceStatus,
} from '@/lib/projectDateSelection'
import { applySelectedProjectDate, syncProjectDateSelection } from '@/lib/projectDateService'
import {
  FINANCE_HISTORY_ERROR,
  assertManagedFinance,
  getProjectJoinStrategy,
  normalizeExtraFinanceInput,
  normalizeProjectFinanceMode,
  validateProjectFinanceInput,
  type ProjectFinanceMode,
} from '@/lib/projectFinance'

export async function setCollector(projectId: string, participantId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not signed in')
  await requireManagedFinanceProject(projectId)
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
    const needsFallback = uErr?.code === '23514' || uErr?.message?.includes('projects_status_check')
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

export async function startCollecting(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')
  await requireManagedFinanceProject(projectId)

  const manager = await requireActiveManager(projectId, uid)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('id, status, collector_participant_id, min_participants, date_mode, selected_date_option_id')
    .eq('id', projectId)
    .single()
  if (projectErr || !project) throw projectErr || new Error('Project not found')

  if (!project.collector_participant_id || manager.id !== project.collector_participant_id) {
    throw new Error('Only the collector can start collecting')
  }

  const status = normalizeProjectStatus(project.status)
  if (status === 'collecting') {
    revalidatePath(`/project/${projectId}`)
    return
  }
  if (status !== 'pending') {
    throw new Error('Project is not in pending status')
  }
  if (project.date_mode === 'selecting') {
    throw new Error('Select a final project date before opening payments')
  }

  await requireDateReadyForPayment(projectId, project.collector_participant_id)

  const { count: activeParticipantsCount, error: countErr } = await supabaseAdmin
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .is('left_at', null)
    .eq('attendance_status', 'confirmed')
  if (countErr) throw countErr

  const minParticipants = Number(project.min_participants ?? 0)
  if (minParticipants > 0 && (activeParticipantsCount ?? 0) < minParticipants) {
    throw new Error('Waiting for minimum participants')
  }

  const startedAtIso = new Date().toISOString()
  const { error: startErr } = await supabaseAdmin
    .from('projects')
    .update({ status: 'collecting', started_collecting_at: startedAtIso })
    .eq('id', projectId)
    .eq('status', 'pending')
  if (startErr) {
    if (missingColumn(startErr, 'started_collecting_at')) {
      const { error: retryErr } = await supabaseAdmin
        .from('projects')
        .update({ status: 'collecting' })
        .eq('id', projectId)
        .eq('status', 'pending')
      if (retryErr) {
        if (statusConstraintViolated(retryErr)) {
          throw new Error('Pending status is unavailable until the latest database migration is applied')
        }
        throw new Error(retryErr.message ?? 'Failed to start collecting')
      }
    } else {
      if (statusConstraintViolated(startErr)) {
        throw new Error('Pending status is unavailable until the latest database migration is applied')
      }
      throw new Error(startErr.message ?? 'Failed to start collecting')
    }
  }

  const { data: existingCounted, error: existingErr } = await supabaseAdmin
    .from('payments')
    .select('id')
    .eq('participant_id', project.collector_participant_id)
    .eq('is_counted', true)
    .limit(1)
  if (existingErr) throw existingErr

  let basePaymentId: string | null = null
  if ((existingCounted?.length ?? 0) === 0) {
    const { data: paymentRow, error: paymentErr } = await supabaseAdmin
      .from('payments')
      .insert({ participant_id: project.collector_participant_id, is_counted: true })
      .select('id')
      .single()
    if (paymentErr) throw paymentErr
    basePaymentId = paymentRow?.id ?? null
  }

  const { error: clrErr } = await supabaseAdmin
    .from('payment_signals')
    .update({ cleared_at: startedAtIso })
    .eq('participant_id', project.collector_participant_id)
    .is('cleared_at', null)
  if (clrErr) {
    const code = typeof clrErr === 'object' && clrErr !== null && 'code' in clrErr
      ? (clrErr as { code?: string }).code
      : undefined
    const isMissingTable = code === '42P01' || clrErr.message?.toLowerCase()?.includes('payment_signals')
    if (!isMissingTable) {
      console.error('[startCollecting] Error clearing payment signals:', clrErr)
    }
  }

  const { data: extras, error: extrasErr } = await supabaseAdmin
    .from('extras')
    .select(
      'id, title, amount_cents, amount_is_per_person, collection_mode, dedicated_collector_participant_id'
    )
    .eq('project_id', projectId)
  if (extrasErr) {
    if (!missingTable(extrasErr, 'extras')) {
      throw new Error(extrasErr.message ?? 'Failed to load extras')
    }
  }
  const extrasList = extras ?? []
  if (extrasList.length > 0) {
    const extraIds = extrasList.map(extra => extra.id)
    const [
      { data: activeParticipants, error: participantsErr },
      { data: memberships, error: membershipsErr },
    ] = await Promise.all([
      supabaseAdmin
        .from('participants')
        .select('id')
        .eq('project_id', projectId)
        .is('left_at', null)
        .eq('attendance_status', 'confirmed'),
      supabaseAdmin
        .from('extra_memberships')
        .select('extra_id, participant_id, left_at')
        .in('extra_id', extraIds)
        .is('left_at', null),
    ])
    if (participantsErr) throw new Error(participantsErr.message ?? 'Failed to load participants')
    if (membershipsErr) {
      if (missingTable(membershipsErr, 'extra_memberships')) throw friendlyExtrasUnavailableError()
      throw new Error(membershipsErr.message ?? 'Failed to load extra memberships')
    }

    const activeParticipantIds = new Set((activeParticipants ?? []).map(participant => participant.id))
    const dueRows = buildExtraDueRows({
      extras: extrasList.map(extra => ({
        id: extra.id,
        title: extra.title ?? null,
        amount_cents: Number(extra.amount_cents ?? 0),
        amount_is_per_person: !!extra.amount_is_per_person,
        collection_mode: extra.collection_mode ?? null,
        dedicated_collector_participant_id: extra.dedicated_collector_participant_id ?? null,
      })),
      memberships: (memberships ?? []).map(membership => ({
        extra_id: membership.extra_id,
        participant_id: membership.participant_id,
        left_at: membership.left_at,
      })),
      activeParticipantIds,
      projectCollectorParticipantId: project.collector_participant_id,
    })

    const selfRows = dueRows.filter(
      row =>
        row.payer_participant_id === project.collector_participant_id &&
        row.collector_participant_id === project.collector_participant_id &&
        row.amount_cents > 0
    )

    if (selfRows.length > 0) {
      const selfExtraIds = Array.from(new Set(selfRows.map(row => row.extra_id)))
      const { data: existingExtraPayments, error: existingExtraErr } = await supabaseAdmin
        .from('extra_payments')
        .select('id, extra_id, payer_participant_id, reported_at, confirmed_at')
        .eq('payer_participant_id', project.collector_participant_id)
        .in('extra_id', selfExtraIds)
      if (existingExtraErr) {
        if (missingTable(existingExtraErr, 'extra_payments')) throw friendlyExtraPaymentsUnavailableError()
        throw new Error(existingExtraErr.message ?? 'Failed to load extra payment statuses')
      }
      const existingByExtraId = new Map((existingExtraPayments ?? []).map(payment => [payment.extra_id, payment]))

      for (const row of selfRows) {
        const existingPayment = existingByExtraId.get(row.extra_id)
        if (existingPayment?.confirmed_at) continue

        if (existingPayment?.id) {
          const { error: updateErr } = await supabaseAdmin
            .from('extra_payments')
            .update({
              collector_participant_id: project.collector_participant_id,
              amount_cents: row.amount_cents,
              reported_at: existingPayment.reported_at ?? null,
              confirmed_at: startedAtIso,
              confirmed_by_participant_id: project.collector_participant_id,
            })
            .eq('id', existingPayment.id)
          if (updateErr) {
            if (missingTable(updateErr, 'extra_payments')) throw friendlyExtraPaymentsUnavailableError()
            throw new Error(updateErr.message ?? 'Failed to auto-confirm extra payment')
          }
        } else {
          const { error: insertErr } = await supabaseAdmin
            .from('extra_payments')
            .insert({
              extra_id: row.extra_id,
              payer_participant_id: row.payer_participant_id,
              collector_participant_id: row.collector_participant_id,
              amount_cents: row.amount_cents,
              confirmed_at: startedAtIso,
              confirmed_by_participant_id: project.collector_participant_id,
            })
          if (insertErr) {
            if (missingTable(insertErr, 'extra_payments')) throw friendlyExtraPaymentsUnavailableError()
            throw new Error(insertErr.message ?? 'Failed to auto-confirm extra payment')
          }
        }

        await recordProjectActivity({
          projectId,
          entryType: 'payment_confirmed',
          actorUserId,
          actorParticipantId,
          targetUserId: uid,
          targetParticipantId: project.collector_participant_id,
          extraId: row.extra_id,
          metadata: {
            scope: 'extra',
            amount_cents: row.amount_cents,
            collector_participant_id: row.collector_participant_id,
            title: row.extra_title,
            source: 'start_collecting_auto_confirmed',
          },
        })
      }
    }
  }

  await recordProjectActivity({
    projectId,
    entryType: 'project_status_changed',
    actorUserId,
    actorParticipantId,
    metadata: {
      from_status: 'pending',
      to_status: 'collecting',
      started_collecting_at: startedAtIso,
    },
  })

  if (basePaymentId) {
    await recordProjectActivity({
      projectId,
      entryType: 'payment_confirmed',
      actorUserId,
      actorParticipantId,
      targetUserId: uid,
      targetParticipantId: project.collector_participant_id,
      paymentId: basePaymentId,
      metadata: {
        is_counted: true,
        source: 'start_collecting_auto_confirmed',
      },
    })
  }

  revalidatePath(`/project/${projectId}`)
}

export async function finalizeProject(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not signed in')
  await requireManagedFinanceProject(projectId)
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
  await requireManagedFinanceProject(projectId)
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
    .in('status', ['pending', 'collecting', 'closed'])
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

  await requireSafeParticipantLeave(projectId, me)

  const financeMode = await getProjectFinanceMode(projectId)
  const refundSummary = financeMode === 'managed'
    ? await computeParticipantRefundSummary(projectId, me.id)
    : { totalAmountCents: 0 }
  if (financeMode === 'managed' && refundSummary.totalAmountCents > 0) {
    const latestRefund = await getLatestParticipantRefundRequest(projectId, me.id)
    if (!latestRefund) {
      throw new Error(
        `You have ${formatEurCents(refundSummary.totalAmountCents)} in confirmed payments. Request a refund in Payments before leaving.`
      )
    }
    if (latestRefund.status !== 'completed') {
      if (latestRefund.status === 'pending') {
        throw new Error('Your refund request is pending collector approval.')
      }
      if (latestRefund.status === 'approved') {
        throw new Error('Refund was approved. Wait for the collector to mark it as sent.')
      }
      if (latestRefund.status === 'sent') {
        throw new Error('Collector marked refund as sent. Confirm receipt in Payments to finish leaving.')
      }
      if (latestRefund.status === 'rejected' || latestRefund.status === 'canceled') {
        throw new Error('Your refund request was not completed. Submit a new refund request in Payments before leaving.')
      }
      throw new Error('Your refund request must be completed before leaving.')
    }
  }

  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)
  await markParticipantLeftWithActivity({
    projectId,
    participantId: me.id,
    targetUserId: uid,
    actorUserId,
    actorParticipantId,
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
  } catch (err: unknown) {
    // Redirect is expected; surface it without logging as a failure.
    if (isNextRedirectError(err)) throw err
    const info = errorInfo(err)
    console.error('[leaveProjectFromForm] error', info.message || err)
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

async function requireActiveJoinRequestManager(projectId: string, userId: string) {
  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('collector_participant_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectErr) throw projectErr
  if (!project) throw new Error('Project not found')

  const { data: participant, error: participantErr } = await supabaseAdmin
    .from('participants')
    .select('id, role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .is('left_at', null)
    .maybeSingle()
  if (participantErr) throw participantErr

  if (!canManageProjectJoinRequests({
    participantId: participant?.id,
    participantRole: participant?.role,
    collectorParticipantId: project.collector_participant_id,
  })) {
    throw new Error('Not authorized')
  }

  return participant
}

async function requireActiveProjectParticipant(projectId: string, userId: string) {
  const { data: me, error: meErr } = await supabaseAdmin
    .from('participants')
    .select('id, project_id, role, left_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .is('left_at', null)
    .maybeSingle()
  if (meErr) throw meErr
  if (!me) throw new Error('Only active participants can do this')
  return me
}

async function getProjectFinanceMode(projectId: string): Promise<ProjectFinanceMode> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('finance_mode')
    .eq('id', projectId)
    .maybeSingle()
  if (missingColumn(error, 'finance_mode')) return 'managed'
  if (error) throw error
  if (!data) throw new Error('Project not found')
  return normalizeProjectFinanceMode(data.finance_mode)
}

async function requireManagedFinanceProject(projectId: string) {
  const financeMode = await getProjectFinanceMode(projectId)
  assertManagedFinance(financeMode)
  return financeMode
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

async function requireDateReadyForPayment(projectId: string, participantId: string) {
  const [{ data: project, error: projectError }, { data: participant, error: participantError }] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('date_mode, selected_date_option_id')
      .eq('id', projectId)
      .maybeSingle(),
    supabaseAdmin
      .from('participants')
      .select('attendance_status')
      .eq('id', participantId)
      .eq('project_id', projectId)
      .maybeSingle(),
  ])
  if (projectError || participantError) {
    const error = projectError || participantError
    if (missingColumn(error, 'date_mode') || missingColumn(error, 'attendance_status')) return
    throw error
  }
  if (project?.date_mode === 'selecting') {
    throw new Error('Choose your date availability before making a financial commitment')
  }
  if (project?.selected_date_option_id && participant?.attendance_status !== 'confirmed') {
    throw new Error('Only confirmed attendees can make project payments')
  }
}

export async function requestParticipantRefund(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')
  await requireManagedFinanceProject(projectId)

  const me = await requireActiveProjectParticipant(projectId, uid)
  const summary = await computeParticipantRefundSummary(projectId, me.id)
  if (summary.projectStatus === 'pending') {
    throw new Error('Refunds are unavailable before collecting starts')
  }
  if (summary.projectStatus === 'closed' || summary.projectStatus === 'finalized') {
    throw new Error('Refund requests are locked after finalization')
  }
  if (summary.projectStatus === 'canceled' || summary.projectStatus === 'cancelled') {
    throw new Error('Refunds are disabled for canceled projects')
  }
  if (summary.totalAmountCents <= 0) {
    throw new Error('No confirmed payments are eligible for refund')
  }
  if (!summary.collectorParticipantId) {
    throw new Error('Set an active collector before requesting a refund')
  }
  if (summary.collectorParticipantId === me.id) {
    throw new Error('Collectors cannot request participant refunds from themselves')
  }

  const existing = await getLatestParticipantRefundRequest(projectId, me.id)
  if (existing && (existing.status === 'pending' || existing.status === 'approved' || existing.status === 'sent')) {
    revalidatePath(`/project/${projectId}`)
    return
  }

  const nowIso = new Date().toISOString()
  const { data: created, error: createErr } = await supabaseAdmin
    .from('participant_refund_requests')
    .insert({
      project_id: projectId,
      participant_id: me.id,
      collector_participant_id: summary.collectorParticipantId,
      requested_by_participant_id: me.id,
      base_amount_cents: summary.baseAmountCents,
      extras_amount_cents: summary.extrasAmountCents,
      total_amount_cents: summary.totalAmountCents,
      status: 'pending',
      requested_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single()
  if (createErr) {
    if (missingTable(createErr, 'participant_refund_requests')) throw friendlyRefundsUnavailableError()
    throw new Error(createErr.message ?? 'Failed to create refund request')
  }

  await recordProjectActivity({
    projectId,
    entryType: 'refund_requested',
    actorUserId: uid,
    actorParticipantId: me.id,
    targetUserId: uid,
    targetParticipantId: me.id,
    metadata: {
      refund_request_id: created?.id ?? null,
      base_amount_cents: summary.baseAmountCents,
      extras_amount_cents: summary.extrasAmountCents,
      total_amount_cents: summary.totalAmountCents,
    },
  })

  revalidatePath(`/project/${projectId}`)
}

export async function approveParticipantRefund(refundRequestId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!refundRequestId) throw new Error('Missing refund request id')

  const { data: refund, error: refundErr } = await supabaseAdmin
    .from('participant_refund_requests')
    .select(
      'id, project_id, participant_id, collector_participant_id, requested_by_participant_id, base_amount_cents, extras_amount_cents, total_amount_cents, status'
    )
    .eq('id', refundRequestId)
    .maybeSingle()
  if (refundErr) {
    if (missingTable(refundErr, 'participant_refund_requests')) throw friendlyRefundsUnavailableError()
    throw new Error(refundErr.message ?? 'Failed to load refund request')
  }
  if (!refund) throw new Error('Refund request not found')

  await requireManagedFinanceProject(refund.project_id)

  await requireActiveManager(refund.project_id, uid)
  const actor = await getActiveParticipantContext(refund.project_id, uid)

  if (refund.status === 'approved' || refund.status === 'sent' || refund.status === 'completed') {
    revalidatePath(`/project/${refund.project_id}`)
    return
  }
  if (refund.status !== 'pending') throw new Error('Refund request is no longer pending')

  const nowIso = new Date().toISOString()
  const { error: updateErr } = await supabaseAdmin
    .from('participant_refund_requests')
    .update({
      status: 'approved',
      decided_at: nowIso,
      decided_by_participant_id: actor.actorParticipantId,
      updated_at: nowIso,
    })
    .eq('id', refundRequestId)
    .eq('status', 'pending')
  if (updateErr) {
    if (missingTable(updateErr, 'participant_refund_requests')) throw friendlyRefundsUnavailableError()
    throw new Error(updateErr.message ?? 'Failed to approve refund request')
  }

  await recordProjectActivity({
    projectId: refund.project_id,
    entryType: 'refund_approved',
    actorUserId: actor.actorUserId,
    actorParticipantId: actor.actorParticipantId,
    targetParticipantId: refund.participant_id,
    metadata: {
      refund_request_id: refund.id,
      total_amount_cents: Number(refund.total_amount_cents ?? 0),
    },
  })

  revalidatePath(`/project/${refund.project_id}`)
}

export async function rejectParticipantRefund(refundRequestId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!refundRequestId) throw new Error('Missing refund request id')

  const { data: refund, error: refundErr } = await supabaseAdmin
    .from('participant_refund_requests')
    .select('id, project_id, participant_id, total_amount_cents, status')
    .eq('id', refundRequestId)
    .maybeSingle()
  if (refundErr) {
    if (missingTable(refundErr, 'participant_refund_requests')) throw friendlyRefundsUnavailableError()
    throw new Error(refundErr.message ?? 'Failed to load refund request')
  }
  if (!refund) throw new Error('Refund request not found')

  await requireManagedFinanceProject(refund.project_id)

  const manager = await requireActiveManager(refund.project_id, uid)
  const actor = await getActiveParticipantContext(refund.project_id, uid)

  if (refund.status === 'rejected' || refund.status === 'canceled') {
    revalidatePath(`/project/${refund.project_id}`)
    return
  }
  if (refund.status !== 'pending' && refund.status !== 'approved') {
    throw new Error('Only pending or approved refund requests can be rejected')
  }

  const nowIso = new Date().toISOString()
  const { error: updateErr } = await supabaseAdmin
    .from('participant_refund_requests')
    .update({
      status: 'rejected',
      decided_at: nowIso,
      decided_by_participant_id: manager.id,
      updated_at: nowIso,
    })
    .eq('id', refundRequestId)
  if (updateErr) {
    if (missingTable(updateErr, 'participant_refund_requests')) throw friendlyRefundsUnavailableError()
    throw new Error(updateErr.message ?? 'Failed to reject refund request')
  }

  await recordProjectActivity({
    projectId: refund.project_id,
    entryType: 'refund_rejected',
    actorUserId: actor.actorUserId,
    actorParticipantId: actor.actorParticipantId,
    targetParticipantId: refund.participant_id,
    metadata: {
      refund_request_id: refund.id,
      total_amount_cents: Number(refund.total_amount_cents ?? 0),
    },
  })

  revalidatePath(`/project/${refund.project_id}`)
}

export async function markParticipantRefundSent(refundRequestId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!refundRequestId) throw new Error('Missing refund request id')

  const { data: refund, error: refundErr } = await supabaseAdmin
    .from('participant_refund_requests')
    .select('id, project_id, participant_id, total_amount_cents, status')
    .eq('id', refundRequestId)
    .maybeSingle()
  if (refundErr) {
    if (missingTable(refundErr, 'participant_refund_requests')) throw friendlyRefundsUnavailableError()
    throw new Error(refundErr.message ?? 'Failed to load refund request')
  }
  if (!refund) throw new Error('Refund request not found')

  await requireManagedFinanceProject(refund.project_id)

  await requireActiveManager(refund.project_id, uid)
  const actor = await getActiveParticipantContext(refund.project_id, uid)

  if (refund.status === 'sent' || refund.status === 'completed') {
    revalidatePath(`/project/${refund.project_id}`)
    return
  }
  if (refund.status !== 'approved') throw new Error('Refund must be approved before marking as sent')

  const nowIso = new Date().toISOString()
  const { error: updateErr } = await supabaseAdmin
    .from('participant_refund_requests')
    .update({
      status: 'sent',
      collector_marked_sent_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', refundRequestId)
    .eq('status', 'approved')
  if (updateErr) {
    if (missingTable(updateErr, 'participant_refund_requests')) throw friendlyRefundsUnavailableError()
    throw new Error(updateErr.message ?? 'Failed to mark refund as sent')
  }

  await recordProjectActivity({
    projectId: refund.project_id,
    entryType: 'refund_sent',
    actorUserId: actor.actorUserId,
    actorParticipantId: actor.actorParticipantId,
    targetParticipantId: refund.participant_id,
    metadata: {
      refund_request_id: refund.id,
      total_amount_cents: Number(refund.total_amount_cents ?? 0),
    },
  })

  revalidatePath(`/project/${refund.project_id}`)
}

export async function confirmParticipantRefundReceived(refundRequestId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!refundRequestId) throw new Error('Missing refund request id')

  const { data: refund, error: refundErr } = await supabaseAdmin
    .from('participant_refund_requests')
    .select('id, project_id, participant_id, total_amount_cents, status')
    .eq('id', refundRequestId)
    .maybeSingle()
  if (refundErr) {
    if (missingTable(refundErr, 'participant_refund_requests')) throw friendlyRefundsUnavailableError()
    throw new Error(refundErr.message ?? 'Failed to load refund request')
  }
  if (!refund) throw new Error('Refund request not found')

  await requireManagedFinanceProject(refund.project_id)

  const me = await requireActiveProjectParticipant(refund.project_id, uid)
  if (me.id !== refund.participant_id) throw new Error('Only the requesting participant can confirm refund receipt')
  if (refund.status === 'completed') {
    revalidatePath(`/project/${refund.project_id}`)
    return
  }
  if (refund.status !== 'sent') throw new Error('Refund is not marked as sent yet')

  // Completing this refund also leaves the project; validate before either write.
  await requireSafeParticipantLeave(refund.project_id, me)

  const actor = await getActiveParticipantContext(refund.project_id, uid)
  const nowIso = new Date().toISOString()
  const { error: updateErr } = await supabaseAdmin
    .from('participant_refund_requests')
    .update({
      status: 'completed',
      participant_confirmed_at: nowIso,
      completed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', refundRequestId)
    .eq('status', 'sent')
  if (updateErr) {
    if (missingTable(updateErr, 'participant_refund_requests')) throw friendlyRefundsUnavailableError()
    throw new Error(updateErr.message ?? 'Failed to complete refund')
  }

  await recordProjectActivity({
    projectId: refund.project_id,
    entryType: 'refund_completed',
    actorUserId: actor.actorUserId,
    actorParticipantId: actor.actorParticipantId,
    targetUserId: uid,
    targetParticipantId: refund.participant_id,
    metadata: {
      refund_request_id: refund.id,
      total_amount_cents: Number(refund.total_amount_cents ?? 0),
    },
  })

  await markParticipantLeftWithActivity({
    projectId: refund.project_id,
    participantId: refund.participant_id,
    targetUserId: uid,
    actorUserId: actor.actorUserId,
    actorParticipantId: actor.actorParticipantId,
  })

  revalidatePath(`/project/${refund.project_id}`)
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

const errorInfo = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      digest: undefined as string | undefined,
      nestedMessage: undefined as string | undefined,
    }
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as {
      message?: unknown
      stack?: unknown
      digest?: unknown
      error?: { message?: unknown }
    }
    return {
      message: typeof record.message === 'string' ? record.message : undefined,
      stack: typeof record.stack === 'string' ? record.stack : undefined,
      digest: typeof record.digest === 'string' ? record.digest : undefined,
      nestedMessage: typeof record.error?.message === 'string' ? record.error.message : undefined,
    }
  }
  return {
    message: undefined as string | undefined,
    stack: undefined as string | undefined,
    digest: undefined as string | undefined,
    nestedMessage: undefined as string | undefined,
  }
}

const isNextRedirectError = (error: unknown) => {
  const info = errorInfo(error)
  return info.message === 'NEXT_REDIRECT' || info.digest === 'NEXT_REDIRECT'
}

const statusConstraintViolated = (error?: { message?: string; code?: string } | null) =>
  !!error && (error.code === '23514' || error.message?.includes('projects_status_check'))

const normalizeProjectStatus = (status: unknown) => String(status ?? '').trim().toLowerCase()

type RefundRequestStatus = 'pending' | 'approved' | 'rejected' | 'sent' | 'completed' | 'canceled'

type ParticipantRefundRequestRow = {
  id: string
  project_id: string
  participant_id: string
  collector_participant_id: string
  requested_by_participant_id: string
  base_amount_cents: number
  extras_amount_cents: number
  total_amount_cents: number
  status: RefundRequestStatus
  requested_at: string
  decided_at: string | null
  decided_by_participant_id: string | null
  collector_marked_sent_at: string | null
  participant_confirmed_at: string | null
  completed_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

type ParticipantRefundSummary = {
  projectId: string
  participantId: string
  collectorParticipantId: string | null
  projectStatus: string
  baseAmountCents: number
  extrasAmountCents: number
  totalAmountCents: number
}

const formatEurCents = (cents: number) => `EUR ${(Math.max(0, Number(cents ?? 0)) / 100).toFixed(2)}`

const resolveActiveCollectorParticipantId = async (projectId: string, collectorParticipantId: string | null) => {
  if (collectorParticipantId) {
    const { data: collector, error: collectorErr } = await supabaseAdmin
      .from('participants')
      .select('id')
      .eq('id', collectorParticipantId)
      .eq('project_id', projectId)
      .is('left_at', null)
      .maybeSingle()
    if (collectorErr) throw new Error(collectorErr.message ?? 'Failed to load collector')
    if (collector?.id) return collector.id
  }

  const { data: organizer, error: organizerErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('role', 'organizer')
    .is('left_at', null)
    .limit(1)
    .maybeSingle()
  if (organizerErr) throw new Error(organizerErr.message ?? 'Failed to resolve organizer collector fallback')
  return organizer?.id ?? null
}

const computeParticipantRefundSummary = async (
  projectId: string,
  participantId: string
): Promise<ParticipantRefundSummary> => {
  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('id, status, total_cents, total_is_per_person, bundle_size, bundle_pay_for, collector_participant_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectErr || !project) throw projectErr || new Error('Project not found')

  const projectStatus = normalizeProjectStatus(project.status)

  const [{ count: activeParticipantsCount, error: activeCountErr }, { count: basePaidCount, error: basePaidErr }] =
    await Promise.all([
      supabaseAdmin
        .from('participants')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .is('left_at', null)
        .eq('attendance_status', 'confirmed'),
      supabaseAdmin
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('participant_id', participantId)
        .eq('is_counted', true),
    ])
  if (activeCountErr) throw new Error(activeCountErr.message ?? 'Failed to count active participants')
  if (basePaidErr) throw new Error(basePaidErr.message ?? 'Failed to load base payment state')

  const pricing = calculateProjectPricing({
    totalCents: Number(project.total_cents ?? 0),
    totalIsPerPerson: project.total_is_per_person === true,
    participantCount: Number(activeParticipantsCount ?? 0),
    bundleSize: project.bundle_size ?? null,
    bundlePayFor: project.bundle_pay_for ?? null,
  })
  const hasBasePayment = Number(basePaidCount ?? 0) > 0
  const baseAmountCents = hasBasePayment ? pricing.perPersonCents : 0

  let extrasAmountCents = 0
  const { data: confirmedExtraPayments, error: extraPaidErr } = await supabaseAdmin
    .from('extra_payments')
    .select('amount_cents, collector_participant_id')
    .eq('payer_participant_id', participantId)
    .not('confirmed_at', 'is', null)
  if (extraPaidErr) {
    if (!missingTable(extraPaidErr, 'extra_payments')) {
      throw new Error(extraPaidErr.message ?? 'Failed to load extra payment state')
    }
  } else {
    for (const row of confirmedExtraPayments ?? []) {
      if (!row) continue
      if (!row.collector_participant_id || row.collector_participant_id === participantId) continue
      extrasAmountCents += Math.max(0, Number(row.amount_cents ?? 0))
    }
  }

  const collectorParticipantId = await resolveActiveCollectorParticipantId(
    projectId,
    (project.collector_participant_id as string | null) ?? null
  )

  return {
    projectId,
    participantId,
    collectorParticipantId,
    projectStatus,
    baseAmountCents,
    extrasAmountCents,
    totalAmountCents: baseAmountCents + extrasAmountCents,
  }
}

const getLatestParticipantRefundRequest = async (
  projectId: string,
  participantId: string
): Promise<ParticipantRefundRequestRow | null> => {
  const { data, error } = await supabaseAdmin
    .from('participant_refund_requests')
    .select(
      'id, project_id, participant_id, collector_participant_id, requested_by_participant_id, base_amount_cents, extras_amount_cents, total_amount_cents, status, requested_at, decided_at, decided_by_participant_id, collector_marked_sent_at, participant_confirmed_at, completed_at, rejection_reason, created_at, updated_at'
    )
    .eq('project_id', projectId)
    .eq('participant_id', participantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (missingTable(error, 'participant_refund_requests')) throw friendlyRefundsUnavailableError()
    throw new Error(error.message ?? 'Failed to load refund request')
  }
  return (data as ParticipantRefundRequestRow | null) ?? null
}

async function requireSafeParticipantLeave(projectId: string, participant: { id: string; role: string }) {
  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('collector_participant_id')
    .eq('id', projectId)
    .single()
  if (projectErr) throw projectErr
  if (!project) throw new Error('Project not found')
  if (project.collector_participant_id === participant.id) {
    throw new Error('Assign another collector before leaving the project.')
  }
  if (participant.role === 'organizer') {
    const { data: otherOrganizers, error: organizerErr } = await supabaseAdmin
      .from('participants')
      .select('id')
      .eq('project_id', projectId)
      .eq('role', 'organizer')
      .is('left_at', null)
      .neq('id', participant.id)
      .limit(1)
    if (organizerErr) throw organizerErr
    if (!otherOrganizers?.length) {
      throw new Error('Assign another organizer before leaving the project.')
    }
  }
}

const markParticipantLeftWithActivity = async ({
  projectId,
  participantId,
  targetUserId,
  actorUserId,
  actorParticipantId,
}: {
  projectId: string
  participantId: string
  targetUserId: string | null
  actorUserId: string | null
  actorParticipantId: string | null
}) => {
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('participants')
    .update({ left_at: new Date().toISOString() })
    .eq('id', participantId)
    .is('left_at', null)
    .select('id')
    .maybeSingle()
  if (updErr) throw updErr
  if (!updated?.id) return false

  await recordProjectActivity({
    projectId,
    entryType: 'participant_left',
    actorUserId,
    actorParticipantId,
    targetUserId,
    targetParticipantId: participantId,
  })
  return true
}

type LateJoinTransferRunResult = {
  processed: boolean
  recipientsCount: number
  perPersonCents: number
  upsertedCount: number
  reason?: string
}

async function runLateJoinTransferUpsert(projectId: string, newcomerParticipantId: string): Promise<LateJoinTransferRunResult> {
  const newcomerAttempt = await supabaseAdmin
    .from('participants')
    .select('id, project_id, joined_at')
    .eq('id', newcomerParticipantId)
    .single()

  let newcomer = newcomerAttempt.data
  let newcomerErr = newcomerAttempt.error
  if (missingColumn(newcomerAttempt.error, 'joined_at')) {
    console.warn('[runLateJoinTransferUpsert] participants.joined_at missing, falling back without it')
    const fallback = await supabaseAdmin
      .from('participants')
      .select('id, project_id')
      .eq('id', newcomerParticipantId)
      .single()
    newcomer = fallback.data ? { ...fallback.data, joined_at: null } : null
    newcomerErr = fallback.error
  }
  if (newcomerErr || !newcomer) throw newcomerErr || new Error('Participant not found')
  if (newcomer.project_id !== projectId) throw new Error('Participant does not belong to this project')

  const baseProjectFields = 'id, total_cents, status, collector_participant_id'
  const selectProject = async (selectList: string) =>
    supabaseAdmin
      .from('projects')
      .select(selectList)
      .eq('id', projectId)
      .single()

  type LateJoinProjectRow = {
    id: string
    total_cents: number | null
    status: string | null
    collector_participant_id: string | null
    total_is_per_person: boolean | null
    bundle_size: number | null
    bundle_pay_for: number | null
    finalized_at: string | null
  }

  const projectAttempt = await selectProject(
    `${baseProjectFields}, total_is_per_person, bundle_size, bundle_pay_for, finalized_at`
  )

  let project = projectAttempt.data as LateJoinProjectRow | null
  let projectErr = projectAttempt.error

  if (missingColumn(projectAttempt.error, 'finalized_at')) {
    console.warn('[runLateJoinTransferUpsert] finalized_at column missing, falling back without it')
    const fallback = await selectProject(`${baseProjectFields}, total_is_per_person, bundle_size, bundle_pay_for`)
    project = fallback.data
      ? { ...((fallback.data as unknown) as Omit<LateJoinProjectRow, 'finalized_at'>), finalized_at: null }
      : null
    projectErr = fallback.error
  }

  if (missingColumn(projectErr, 'bundle_size') || missingColumn(projectErr, 'bundle_pay_for')) {
    console.warn('[runLateJoinTransferUpsert] bundle pricing columns missing, falling back without them')
    const needsFinalizeFallback = missingColumn(projectErr, 'finalized_at')
    const fallback = await selectProject(
      needsFinalizeFallback
        ? `${baseProjectFields}, total_is_per_person`
        : `${baseProjectFields}, total_is_per_person, finalized_at`
    )
    project = fallback.data
      ? {
          ...((fallback.data as unknown) as Omit<LateJoinProjectRow, 'bundle_size' | 'bundle_pay_for'>),
          finalized_at:
            'finalized_at' in (fallback.data as object) ? (fallback.data as { finalized_at?: string | null }).finalized_at ?? null : null,
          bundle_size: null,
          bundle_pay_for: null,
        }
      : null
    projectErr = fallback.error
  }

  if (projectErr || !project) throw projectErr || new Error('Project not found for late join logic')

  const projectStatus = normalizeProjectStatus(project.status)
  const finalizedAt = (project.finalized_at as string | null) ?? null
  const isFinalized = !!finalizedAt || projectStatus === 'closed'
  const isCollecting = projectStatus === 'collecting'
  if (!isFinalized && !isCollecting) {
    return {
      processed: false,
      recipientsCount: 0,
      perPersonCents: 0,
      upsertedCount: 0,
      reason: 'project_not_collecting_or_finalized',
    }
  }

  const participantsAttempt = await supabaseAdmin
    .from('participants')
    .select('id, joined_at')
    .eq('project_id', projectId)
    .is('left_at', null)
    .eq('attendance_status', 'confirmed')
    .neq('id', newcomerParticipantId)
  let participants = participantsAttempt.data
  let participantsErr = participantsAttempt.error
  if (missingColumn(participantsAttempt.error, 'joined_at')) {
    console.warn('[runLateJoinTransferUpsert] participants.joined_at missing, falling back without it')
    const fallback = await supabaseAdmin
      .from('participants')
      .select('id')
      .eq('project_id', projectId)
      .is('left_at', null)
      .eq('attendance_status', 'confirmed')
      .neq('id', newcomerParticipantId)
    participants = (fallback.data ?? []).map(row => ({ ...row, joined_at: null }))
    participantsErr = fallback.error
  }
  if (participantsErr) throw participantsErr

  const boundaryIso = isFinalized ? finalizedAt : (newcomer.joined_at as string | null)
  const boundaryTime = boundaryIso ? new Date(boundaryIso).getTime() : Number.NaN
  const hasBoundary = Number.isFinite(boundaryTime)
  const participantList =
    (participants ?? []).filter(participant => {
      if (!hasBoundary) return true
      if (!participant.joined_at) return true
      const participantJoinedTime = new Date(participant.joined_at).getTime()
      if (!Number.isFinite(participantJoinedTime)) return true
      return participantJoinedTime <= boundaryTime
    })

  const participantsBeforeJoinCount = participantList.length
  if (participantsBeforeJoinCount === 0) {
    return {
      processed: false,
      recipientsCount: 0,
      perPersonCents: 0,
      upsertedCount: 0,
      reason: isFinalized ? 'no_recipients_at_finalize' : 'no_participants_before_join',
    }
  }

  let recipientList: Array<{ id: string }> = []
  let denominatorParticipantsCount = participantsBeforeJoinCount

  if (isFinalized) {
    recipientList = participantList.map(participant => ({ id: participant.id }))
    denominatorParticipantsCount = recipientList.length
  } else {
    const beforeJoinIds = participantList.map(participant => participant.id)
    const { data: countedPayments, error: countedErr } = await supabaseAdmin
      .from('payments')
      .select('participant_id')
      .eq('is_counted', true)
      .in('participant_id', beforeJoinIds)
    if (countedErr) throw countedErr

    const paidParticipantIds = new Set((countedPayments ?? []).map(payment => payment.participant_id))
    recipientList = participantList
      .filter(participant => paidParticipantIds.has(participant.id))
      .map(participant => ({ id: participant.id }))
  }

  const recipientsCount = recipientList.length
  if (recipientsCount === 0) {
    return {
      processed: false,
      recipientsCount,
      perPersonCents: 0,
      upsertedCount: 0,
      reason: isFinalized ? 'no_recipients_at_finalize' : 'no_paid_recipients_before_join',
    }
  }

  const previousPricing = calculateProjectPricing({
    totalCents: Number(project.total_cents ?? 0),
    totalIsPerPerson: project.total_is_per_person === true,
    participantCount: denominatorParticipantsCount,
    bundleSize: project.bundle_size ?? null,
    bundlePayFor: project.bundle_pay_for ?? null,
  })
  const nextPricing = calculateProjectPricing({
    totalCents: Number(project.total_cents ?? 0),
    totalIsPerPerson: project.total_is_per_person === true,
    participantCount: denominatorParticipantsCount + 1,
    bundleSize: project.bundle_size ?? null,
    bundlePayFor: project.bundle_pay_for ?? null,
  })
  const perPersonCents = Math.abs(previousPricing.perPersonCents - nextPricing.perPersonCents)
  const transferFromParticipantId =
    previousPricing.perPersonCents >= nextPricing.perPersonCents ? newcomerParticipantId : null
  const transferToParticipantId =
    previousPricing.perPersonCents >= nextPricing.perPersonCents
      ? null
      : await resolveActiveCollectorParticipantId(projectId, (project.collector_participant_id as string | null) ?? null)

  if (perPersonCents <= 0) {
    return {
      processed: false,
      recipientsCount,
      perPersonCents: 0,
      upsertedCount: 0,
      reason: 'no_share_change',
    }
  }

  if (!transferFromParticipantId && !transferToParticipantId) {
    return {
      processed: false,
      recipientsCount,
      perPersonCents,
      upsertedCount: 0,
      reason: 'collector_not_found_for_top_up',
    }
  }

  const rows = transferFromParticipantId
    ? recipientList.map(recipient => ({
        project_id: project.id,
        from_participant_id: newcomerParticipantId,
        to_participant_id: recipient.id,
        expected_cents: perPersonCents,
      }))
    : recipientList
        .filter(recipient => recipient.id !== transferToParticipantId)
        .map(recipient => ({
          project_id: project.id,
          from_participant_id: recipient.id,
          to_participant_id: transferToParticipantId as string,
          expected_cents: perPersonCents,
        }))

  if (rows.length === 0) {
    return {
      processed: false,
      recipientsCount: 0,
      perPersonCents: 0,
      upsertedCount: 0,
      reason: 'no_transfer_rows_needed',
    }
  }

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

  const baseProjectFields = 'id, status, canceled_at'
  const optionalProjectFields = ['finance_mode', 'max_participants', 'date_mode', 'selected_date_option_id'] as const
  let optionalFields = [...optionalProjectFields]
  type JoinProjectRow = {
    id: string
    status: string | null
    canceled_at: string | null
    finance_mode?: ProjectFinanceMode | null
    max_participants?: number | null
    date_mode?: 'fixed' | 'selecting' | null
    selected_date_option_id?: string | null
  }
  let project: JoinProjectRow | null = null
  let pErr: { message?: string; details?: string | null; hint?: string | null; code?: string } | null = null

  while (true) {
    const selectList = [baseProjectFields, ...optionalFields].join(', ')
    const result = await supabaseAdmin
      .from('projects')
      .select(selectList)
      .eq('id', projectId)
      .single()

    const missingField = optionalFields.find(field => missingColumn(result.error, field))
    if (missingField) {
      optionalFields = optionalFields.filter(field => field !== missingField)
      continue
    }

    const row = result.data as JoinProjectRow | null
    project = row
      ? {
          ...row,
          finance_mode: 'finance_mode' in row ? normalizeProjectFinanceMode(row.finance_mode) : 'managed',
          max_participants: 'max_participants' in row ? row.max_participants ?? null : null,
          date_mode: 'date_mode' in row ? row.date_mode ?? 'fixed' : 'fixed',
          selected_date_option_id: 'selected_date_option_id' in row ? row.selected_date_option_id ?? null : null,
        }
      : null
    pErr = result.error
    break
  }

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


  if (getProjectJoinStrategy(project.finance_mode) === 'direct_membership') {
    if (project.max_participants) {
      let capacityQuery = supabaseAdmin
        .from('participants')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .is('left_at', null)
      if (project.date_mode === 'fixed' && project.selected_date_option_id) {
        capacityQuery = capacityQuery.eq('attendance_status', 'confirmed')
      }
      const { count, error: capacityError } = await capacityQuery
      if (capacityError && !missingColumn(capacityError, 'attendance_status')) throw capacityError
      if ((count ?? 0) >= project.max_participants) {
        return { ok: false as const, blocked: true as const, error: 'Project capacity has been reached' }
      }
    }

    let participantId = existing?.id ?? null
    if (participantId) {
      const { error: reactivateError } = await supabaseAdmin
        .from('participants')
        .update({ left_at: null })
        .eq('id', participantId)
      if (reactivateError) throw reactivateError
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('participants')
        .insert({ project_id: projectId, user_id: uid, role: 'member' })
        .select('id')
        .single()
      if (insertError || !inserted?.id) throw insertError || new Error('Failed to join project')
      participantId = inserted.id
    }

    await supabaseAdmin
      .from('join_requests')
      .update({ status: 'approved' })
      .eq('project_id', projectId)
      .eq('requester_user_id', uid)

    await recordProjectActivity({
      projectId,
      entryType: 'participant_joined',
      actorUserId: uid,
      actorParticipantId: participantId,
      targetUserId: uid,
      targetParticipantId: participantId,
      metadata: { direct_join: true, finance_mode: 'none' },
    })

    revalidatePath(`/project/${projectId}`)
    return { ok: true as const, joined: true as const }
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
  await requireManagedFinanceProject(projectId)
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

  await requireActiveJoinRequestManager(req.project_id, managerId)
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

  if (!participantExisting || participantExisting.left_at) {
    const { data: capacityProject, error: capacityProjectError } = await supabaseAdmin
      .from('projects')
      .select('max_participants, date_mode, selected_date_option_id')
      .eq('id', req.project_id)
      .maybeSingle()
    if (capacityProjectError || !capacityProject) throw capacityProjectError || new Error('Project not found')
    if (capacityProject.max_participants) {
      let capacityQuery = supabaseAdmin
        .from('participants')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', req.project_id)
        .is('left_at', null)
      if (capacityProject.date_mode === 'fixed' && capacityProject.selected_date_option_id) {
        capacityQuery = capacityQuery.eq('attendance_status', 'confirmed')
      }
      const { count, error: capacityError } = await capacityQuery
      if (capacityError) throw capacityError
      if ((count ?? 0) >= capacityProject.max_participants) {
        throw new Error('Project capacity has been reached')
      }
    }
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

  const financeMode = await getProjectFinanceMode(req.project_id)
  if (financeMode === 'managed') {
    await clonePaymentOptionsForParticipant(participantId, req.requester_user_id)
  }

  const lateJoinResult = financeMode === 'managed'
    ? await createLateJoinTransfers(req.project_id, participantId, {
        skipAuth: true,
        skipRevalidate: true,
      })
    : {
        processed: false,
        recipientsCount: 0,
        perPersonCents: 0,
        upsertedCount: 0,
        reason: 'finance_disabled',
      }
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

  await requireActiveJoinRequestManager(req.project_id, managerId)
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
  } catch (err: unknown) {
    // Redirect is expected; surface it without logging as a failure.
    if (isNextRedirectError(err)) throw err
    const info = errorInfo(err)
    console.error('[joinProjectFromForm] error', info.message || err)
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
  } catch (err: unknown) {
    // Redirect is expected; surface it without logging as a failure.
    if (isNextRedirectError(err)) throw err
    const info = errorInfo(err)
    console.error('[approveJoinRequestFromForm] error', info.message || err)
    if (err instanceof Error) throw err
    const message = info.message ?? info.nestedMessage ?? 'Failed to approve join request'
    throw new Error(message)
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
  } catch (err: unknown) {
    // Redirect is expected; surface it without logging as a failure.
    if (isNextRedirectError(err)) throw err
    const info = errorInfo(err)
    console.error('[rejectJoinRequestFromForm] error', info.message || err)
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
  } catch (err: unknown) {
    const info = errorInfo(err)
    console.error('[requestJoinFromForm] error', { projectId, error: info.message || err, stack: info.stack })
    revalidatePath(`/project/${projectId}`)
    return { ok: false, error: info.message || 'Unknown error' }
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
  await requireManagedFinanceProject(participant.project_id)

  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('status')
    .eq('id', participant.project_id)
    .maybeSingle()
  if (projectErr || !project) throw projectErr || new Error('Project not found')
  const projectStatus = normalizeProjectStatus(project.status)
  if (projectStatus === 'pending') {
    throw new Error('Start collecting before recording payments')
  }
  if (projectStatus !== 'collecting') {
    throw new Error('Payments are not editable for this project status')
  }
  await requireDateReadyForPayment(participant.project_id, participant.id)

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

  await requireManagedFinanceProject(transfer.project_id)

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
  await requireManagedFinanceProject(transfer.project_id)
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
  await requireManagedFinanceProject(participant.project_id)
  const actor = uid
    ? await getActiveParticipantContext(participant.project_id, uid)
    : { actorUserId: null, actorParticipantId: null as string | null }

  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('status')
    .eq('id', participant.project_id)
    .maybeSingle()
  if (projectErr || !project) throw projectErr || new Error('Project not found')
  const projectStatus = normalizeProjectStatus(project.status)
  if (projectStatus === 'pending') {
    throw new Error('Start collecting before recording payments')
  }
  if (projectStatus !== 'collecting') {
    throw new Error('Payments are not editable for this project status')
  }
  await requireDateReadyForPayment(participant.project_id, participant.id)

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
    const code = clrErr.code
    const isMissingTable = code === '42P01' || clrErr.message?.toLowerCase()?.includes('payment_signals')
    if (!isMissingTable) {
      console.error('[markReceived] Error clearing payment signals:', clrErr)
      // Continue anyway - the payment was recorded successfully
    }
  }

  revalidatePath(`/project/${participant.project_id}`)
}

/**
 * Collector can explicitly mark their own payment as counted.
 * Used to keep funding progress at 0% on new projects until collector confirms.
 */
export async function markCollectorSelfPaid(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')
  await requireManagedFinanceProject(projectId)

  const manager = await requireActiveManager(projectId, uid)
  const actor = await getActiveParticipantContext(projectId, uid)

  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('id, collector_participant_id, min_participants, status, canceled_at, aborted_at')
    .eq('id', projectId)
    .single()
  if (projectErr || !project) throw projectErr || new Error('Project not found')

  if (!project.collector_participant_id || manager.id !== project.collector_participant_id) {
    throw new Error('Only the collector can mark this payment')
  }

  const status = String(project.status ?? '').toLowerCase()
  if (status !== 'collecting' || project.canceled_at || project.aborted_at) {
    throw new Error('Payments are not editable for this project status')
  }
  await requireDateReadyForPayment(projectId, project.collector_participant_id)

  const { count: activeParticipantsCount, error: countErr } = await supabaseAdmin
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .is('left_at', null)
    .eq('attendance_status', 'confirmed')
  if (countErr) throw countErr

  const minParticipants = Number(project.min_participants ?? 0)
  if (minParticipants > 0 && (activeParticipantsCount ?? 0) < minParticipants) {
    throw new Error('Waiting for minimum participants')
  }

  const { data: existingCounted, error: existingErr } = await supabaseAdmin
    .from('payments')
    .select('id')
    .eq('participant_id', project.collector_participant_id)
    .eq('is_counted', true)
    .limit(1)
  if (existingErr) throw existingErr
  if ((existingCounted?.length ?? 0) > 0) {
    revalidatePath(`/project/${projectId}`)
    return
  }

  const { data: paymentRow, error: paymentErr } = await supabaseAdmin
    .from('payments')
    .insert({ participant_id: project.collector_participant_id, is_counted: true })
    .select('id')
    .single()
  if (paymentErr) throw paymentErr

  await recordProjectActivity({
    projectId,
    entryType: 'payment_confirmed',
    actorUserId: actor.actorUserId,
    actorParticipantId: actor.actorParticipantId,
    targetUserId: uid,
    targetParticipantId: project.collector_participant_id,
    paymentId: paymentRow?.id ?? null,
    metadata: {
      is_counted: true,
      source: 'collector_self_marked',
    },
  })

  const { error: clrErr } = await supabaseAdmin
    .from('payment_signals')
    .update({ cleared_at: new Date().toISOString() })
    .eq('participant_id', project.collector_participant_id)
    .is('cleared_at', null)
  if (clrErr) {
    const code = typeof clrErr === 'object' && clrErr !== null && 'code' in clrErr
      ? (clrErr as { code?: string }).code
      : undefined
    const isMissingTable = code === '42P01' || clrErr.message?.toLowerCase()?.includes('payment_signals')
    if (!isMissingTable) {
      console.error('[markCollectorSelfPaid] Error clearing payment signals:', clrErr)
    }
  }

  revalidatePath(`/project/${projectId}`)
}

export async function selfReportExtraPaid(extraId: string, payerParticipantId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!extraId || !payerParticipantId) throw new Error('Missing ids')

  const due = await resolveExtraDueForParticipant(extraId, payerParticipantId)
  await requireManagedFinanceProject(due.projectId)
  const projectStatus = normalizeProjectStatus(due.projectStatus)
  if (projectStatus === 'pending') {
    throw new Error('Start collecting before recording payments')
  }
  if (projectStatus === 'cancelled' || projectStatus === 'canceled') {
    throw new Error('Payments are disabled for canceled projects')
  }
  if (projectStatus !== 'collecting' && projectStatus !== 'closed') {
    throw new Error('Payments are not editable for this project status')
  }
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

export async function markExtraCollectorSelfPaid(extraId: string, payerParticipantId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!extraId || !payerParticipantId) throw new Error('Missing ids')

  const due = await resolveExtraDueForParticipant(extraId, payerParticipantId)
  await requireManagedFinanceProject(due.projectId)
  const projectStatus = normalizeProjectStatus(due.projectStatus)
  if (projectStatus === 'pending') {
    throw new Error('Start collecting before recording payments')
  }
  if (projectStatus === 'cancelled' || projectStatus === 'canceled') {
    throw new Error('Payments are disabled for canceled projects')
  }
  if (projectStatus !== 'collecting' && projectStatus !== 'closed') {
    throw new Error('Payments are not editable for this project status')
  }
  if (due.payerUserId !== uid) throw new Error('Not your participant entry')
  if (due.collectorParticipantId !== due.payerParticipantId) {
    throw new Error('This extra requires a transfer to another collector')
  }
  if (!due.minParticipantsReached) {
    throw new Error('Waiting for minimum participants')
  }

  const me = await requireActiveProjectParticipant(due.projectId, uid)
  if (me.id !== due.collectorParticipantId || me.id !== due.payerParticipantId) {
    throw new Error('Only this extra collector can mark payment')
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
        reported_at: existing.reported_at ?? null,
        confirmed_at: nowIso,
        confirmed_by_participant_id: me.id,
      })
      .eq('id', existing.id)
    if (updateErr) {
      if (missingTable(updateErr, 'extra_payments')) throw friendlyExtraPaymentsUnavailableError()
      throw new Error(updateErr.message ?? 'Failed to mark extra as paid')
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
      throw new Error(insertErr.message ?? 'Failed to mark extra as paid')
    }
  }

  await recordProjectActivity({
    projectId: due.projectId,
    entryType: 'payment_confirmed',
    actorUserId: uid,
    actorParticipantId: me.id,
    targetUserId: due.payerUserId ?? uid,
    targetParticipantId: due.payerParticipantId,
    extraId,
    metadata: {
      scope: 'extra',
      amount_cents: due.amountCents,
      collector_participant_id: due.collectorParticipantId,
      title: due.extraTitle,
      source: 'collector_self_marked',
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
  await requireManagedFinanceProject(due.projectId)
  const projectStatus = normalizeProjectStatus(due.projectStatus)
  if (projectStatus === 'pending') {
    throw new Error('Start collecting before recording payments')
  }
  if (projectStatus === 'cancelled' || projectStatus === 'canceled') {
    throw new Error('Payments are disabled for canceled projects')
  }
  if (projectStatus !== 'collecting' && projectStatus !== 'closed') {
    throw new Error('Payments are not editable for this project status')
  }
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

  // Older schemas may not have aborted_at; cancellation status/canceled_at still apply.
  const projectResult = await supabaseAdmin
    .from('projects')
    .select('status, canceled_at, aborted_at')
    .eq('id', projectId)
    .single()
  let project = projectResult.data
  let projectError = projectResult.error
  if (missingColumn(projectError, 'aborted_at')) {
    const fallback = await supabaseAdmin
      .from('projects')
      .select('status, canceled_at')
      .eq('id', projectId)
      .single()
    project = fallback.data ? { ...fallback.data, aborted_at: null } : null
    projectError = fallback.error
  }
  if (projectError) throw projectError
  if (!project) throw new Error('Project not found')
  if (getProjectStatusUiKey({
    status: project.status,
    canceledAt: project.canceled_at,
    isCanceled: project.aborted_at != null || project.canceled_at != null,
  }) === 'canceled') {
    throw new Error('Posting is disabled because this project was canceled.')
  }

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

const loadManagedDateProject = async (projectId: string, userId: string) => {
  const manager = await requireActiveManager(projectId, userId)
  const { data: project, error } = await supabaseAdmin
    .from('projects')
    .select(
      'id, date_mode, date_selection_status, date_voting_deadline_at, date_suggestions_close_at, selected_date_option_id, confirmation_deadline_at, max_participants'
    )
    .eq('id', projectId)
    .maybeSingle()
  if (error || !project) throw error || new Error('Project not found')
  return { manager, project }
}

export async function suggestProjectDateOption(projectId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const participant = await requireActiveProjectParticipant(projectId, uid)
  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('date_mode, date_selection_status, date_voting_deadline_at, date_suggestions_close_at, collector_participant_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError || !project) throw projectError || new Error('Project not found')
  if (project.date_mode !== 'selecting' || project.date_selection_status !== 'open') {
    throw new Error('Date suggestions are closed')
  }
  const closeAt = project.date_suggestions_close_at || project.date_voting_deadline_at
  if (!closeAt || !canSuggestDate(project.date_voting_deadline_at, new Date())) {
    throw new Error('New date suggestions close 24 hours before voting ends')
  }
  if (new Date(closeAt) <= new Date()) throw new Error('New date suggestions are closed')

  const startsAtRaw = String(formData.get('starts_at') ?? '').trim()
  const endsAtRaw = String(formData.get('ends_at') ?? '').trim()
  if (!startsAtRaw) throw new Error('Choose a start date')
  const normalized = normalizeDateOption(startsAtRaw, endsAtRaw || null)

  const duplicateQuery = supabaseAdmin
    .from('project_date_options')
    .select('id')
    .eq('project_id', projectId)
    .eq('starts_at', normalized.startsAt)
  const { data: duplicate, error: duplicateError } = normalized.endsAt
    ? await duplicateQuery.eq('ends_at', normalized.endsAt).maybeSingle()
    : await duplicateQuery.is('ends_at', null).maybeSingle()
  if (duplicateError) throw duplicateError
  if (duplicate) throw new Error('This date has already been suggested.')

  const { data: option, error } = await supabaseAdmin
    .from('project_date_options')
    .insert({
      project_id: projectId,
      starts_at: normalized.startsAt,
      ends_at: normalized.endsAt,
      created_by_user_id: uid,
      source: project.collector_participant_id === participant.id ? 'organizer' : 'participant',
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('This date has already been suggested.')
    throw new Error(error.message ?? 'Failed to suggest date')
  }
  await recordProjectActivity({
    projectId,
    entryType: 'date_option_suggested',
    actorUserId: uid,
    actorParticipantId: participant.id,
    metadata: { date_option_id: option.id, starts_at: normalized.startsAt, ends_at: normalized.endsAt },
  })
  revalidatePath(`/project/${projectId}`)
}

export async function setProjectDateResponse(
  projectId: string,
  optionId: string,
  availability: DateAvailability,
  isPreferred: boolean
) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const participant = await requireActiveProjectParticipant(projectId, uid)
  const { error } = await supabaseAdmin.rpc('set_project_date_response', {
    p_project_id: projectId,
    p_option_id: optionId,
    p_user_id: uid,
    p_availability: availability,
    p_is_preferred: isPreferred,
  })
  if (error) throw new Error(error.message ?? 'Failed to save date availability')
  await recordProjectActivity({
    projectId,
    entryType: 'date_response_updated',
    actorUserId: uid,
    actorParticipantId: participant.id,
    metadata: { date_option_id: optionId, availability, is_preferred: isPreferred },
  })
  revalidatePath(`/project/${projectId}`)
}

export async function removeProjectDateOption(projectId: string, optionId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const participant = await requireActiveProjectParticipant(projectId, uid)
  const [{ data: project, error: projectError }, { data: option, error: optionError }, { data: responses, error: responseError }] =
    await Promise.all([
      supabaseAdmin.from('projects').select('date_mode, date_selection_status, collector_participant_id').eq('id', projectId).maybeSingle(),
      supabaseAdmin.from('project_date_options').select('id, project_id, starts_at, ends_at, status, created_by_user_id').eq('id', optionId).maybeSingle(),
      supabaseAdmin.from('project_date_responses').select('date_option_id, user_id, availability, is_preferred').eq('date_option_id', optionId),
    ])
  if (projectError || optionError || responseError) throw projectError || optionError || responseError
  if (!project || !option || option.project_id !== projectId || option.status !== 'active') throw new Error('Date option not found')
  if (project.date_mode !== 'selecting' || project.date_selection_status !== 'open') throw new Error('Date voting is closed')
  const isOrganizer = project.collector_participant_id === participant.id
  if (!canRemoveDateOption({
    option: option as DateOptionLike,
    actorUserId: uid,
    isOrganizer,
    responses: (responses ?? []) as DateResponseLike[],
  })) {
    throw new Error('This date cannot be removed after another participant has responded')
  }
  const { error } = await supabaseAdmin
    .from('project_date_options')
    .update({ status: 'removed', removed_at: new Date().toISOString(), removed_by_user_id: uid })
    .eq('id', optionId)
    .eq('status', 'active')
  if (error) throw new Error(error.message ?? 'Failed to remove date')
  await recordProjectActivity({
    projectId,
    entryType: 'date_option_removed',
    actorUserId: uid,
    actorParticipantId: participant.id,
    metadata: { date_option_id: optionId, organizer_override: isOrganizer },
  })
  revalidatePath(`/project/${projectId}`)
}

export async function resolveProjectDateVoting(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const { project } = await loadManagedDateProject(projectId, uid)
  if (project.date_mode !== 'selecting') return
  if (!project.date_voting_deadline_at || new Date(project.date_voting_deadline_at) > new Date()) {
    throw new Error('The voting deadline has not passed yet')
  }
  await syncProjectDateSelection(projectId)
  revalidatePath(`/project/${projectId}`)
}

export async function chooseTiedProjectDate(projectId: string, optionId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const { manager, project } = await loadManagedDateProject(projectId, uid)
  if (project.date_mode !== 'selecting' || project.date_selection_status !== 'awaiting_organizer_decision') {
    throw new Error('Organizer date decision is not required')
  }
  const [{ data: options, error: optionError }, { data: responses, error: responseError }, { data: participants, error: participantError }] =
    await Promise.all([
      supabaseAdmin.from('project_date_options').select('id, starts_at, ends_at, status').eq('project_id', projectId),
      supabaseAdmin.from('project_date_responses').select('date_option_id, user_id, availability, is_preferred').eq('project_id', projectId),
      supabaseAdmin.from('participants').select('user_id').eq('project_id', projectId).is('left_at', null),
    ])
  if (optionError || responseError || participantError) throw optionError || responseError || participantError
  const ranking = rankDateOptions(
    (options ?? []) as DateOptionLike[],
    (responses ?? []) as DateResponseLike[],
    (participants ?? []).map(row => row.user_id)
  )
  if (ranking.kind !== 'tie' || !ranking.tiedOptionIds.includes(optionId)) {
    throw new Error('Choose one of the tied date options')
  }
  await applySelectedProjectDate(projectId, optionId, {
    actorUserId: uid,
    actorParticipantId: manager.id,
  })
  revalidatePath(`/project/${projectId}`)
}

export async function setDateConfirmationDeadline(projectId: string, deadlineAt: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  await loadManagedDateProject(projectId, uid)
  const deadline = new Date(deadlineAt)
  if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) throw new Error('Confirmation deadline must be in the future')
  const { error } = await supabaseAdmin
    .from('projects')
    .update({ confirmation_deadline_at: deadline.toISOString(), date_selection_status: 'confirmation_open' })
    .eq('id', projectId)
    .eq('date_mode', 'fixed')
    .not('selected_date_option_id', 'is', null)
  if (error) throw new Error(error.message ?? 'Failed to update confirmation deadline')
  revalidatePath(`/project/${projectId}`)
}

export async function setSelectedProjectTimes(projectId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const { manager, project } = await loadManagedDateProject(projectId, uid)
  if (project.date_mode !== 'fixed' || !project.selected_date_option_id) {
    throw new Error('A final project date must be selected before adding a time')
  }

  const startTime = String(formData.get('start_time') ?? '').trim()
  const endTime = String(formData.get('end_time') ?? '').trim()
  const timezoneOffsetMinutes = Number(formData.get('timezone_offset_minutes') ?? 0)

  const { data: option, error: optionError } = await supabaseAdmin
    .from('project_date_options')
    .select('starts_at, ends_at')
    .eq('project_id', projectId)
    .eq('id', project.selected_date_option_id)
    .maybeSingle()
  if (optionError || !option) throw optionError || new Error('Selected date option not found')

  const { eventStartAt, eventEndAt } = applyTimeToDateOption({
    startsAt: option.starts_at,
    endsAt: option.ends_at,
    startTime,
    endTime,
    timezoneOffsetMinutes,
  })

  const { error } = await supabaseAdmin
    .from('projects')
    .update({ event_start_at: eventStartAt, event_end_at: eventEndAt })
    .eq('id', projectId)
    .eq('selected_date_option_id', project.selected_date_option_id)
  if (error) throw new Error(error.message ?? 'Failed to update project time')

  await recordProjectActivity({
    projectId,
    entryType: 'project_updated',
    actorUserId: uid,
    actorParticipantId: manager.id,
    metadata: {
      fields: ['event_start_at', 'event_end_at'],
      event_start_at: eventStartAt,
      event_end_at: eventEndAt,
      selected_date_option_id: project.selected_date_option_id,
    },
  })
  revalidatePath(`/project/${projectId}`)
}

export async function respondToDateConfirmation(
  projectId: string,
  response: 'yes' | 'no' | 'still_dont_know'
) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const participant = await requireActiveProjectParticipant(projectId, uid)
  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('date_mode, selected_date_option_id, confirmation_deadline_at, max_participants')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError || !project) throw projectError || new Error('Project not found')
  if (project.date_mode !== 'fixed' || !project.selected_date_option_id) throw new Error('A final date has not been selected')
  if (project.confirmation_deadline_at && new Date(project.confirmation_deadline_at) <= new Date()) {
    throw new Error('The confirmation deadline has passed. Use Join this project for a late confirmation.')
  }
  if (response === 'yes' && project.max_participants) {
    const { count, error: countError } = await supabaseAdmin
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('left_at', null)
      .eq('attendance_status', 'confirmed')
      .neq('id', participant.id)
    if (countError) throw countError
    if ((count ?? 0) >= project.max_participants) throw new Error('Project capacity has been reached')
  }
  const attendanceStatus: ParticipantAttendanceStatus = response === 'yes'
    ? 'confirmed'
    : response === 'no'
      ? 'cannot_attend'
      : 'awaiting_confirmation'
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('participants')
    .update({ attendance_status: attendanceStatus, attendance_updated_at: now })
    .eq('id', participant.id)
  if (error) throw new Error(error.message ?? 'Failed to save attendance confirmation')
  if (response !== 'still_dont_know') {
    await supabaseAdmin
      .from('project_priority_tasks')
      .update({ status: 'completed', completed_at: now, updated_at: now })
      .eq('project_id', projectId)
      .eq('user_id', uid)
      .eq('task_type', 'date_confirmation')
  }
  const { count: unresolvedCount, error: unresolvedError } = await supabaseAdmin
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .is('left_at', null)
    .in('attendance_status', ['awaiting_confirmation', 'unconfirmed'])
  if (unresolvedError) throw unresolvedError
  if ((unresolvedCount ?? 0) === 0) {
    await supabaseAdmin.from('projects').update({ date_selection_status: 'confirmed' }).eq('id', projectId)
  }
  await recordProjectActivity({
    projectId,
    entryType: 'date_confirmation_updated',
    actorUserId: uid,
    actorParticipantId: participant.id,
    metadata: { response, attendance_status: attendanceStatus },
  })
  revalidatePath(`/project/${projectId}`)
}

export async function stayProjectObserver(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const participant = await requireActiveProjectParticipant(projectId, uid)
  const { error } = await supabaseAdmin
    .from('participants')
    .update({ attendance_status: 'observer', attendance_updated_at: new Date().toISOString() })
    .eq('id', participant.id)
  if (error) throw error
  revalidatePath(`/project/${projectId}`)
}

export async function lateConfirmProjectAttendance(projectId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const participant = await requireActiveProjectParticipant(projectId, uid)
  const [{ data: project, error: projectError }, { data: current, error: currentError }, { count, error: countError }] = await Promise.all([
    supabaseAdmin.from('projects').select('date_mode, selected_date_option_id, max_participants').eq('id', projectId).maybeSingle(),
    supabaseAdmin.from('participants').select('attendance_status').eq('id', participant.id).maybeSingle(),
    supabaseAdmin.from('participants').select('id', { count: 'exact', head: true }).eq('project_id', projectId).is('left_at', null).eq('attendance_status', 'confirmed'),
  ])
  if (projectError || currentError || countError) throw projectError || currentError || countError
  if (!project || project.date_mode !== 'fixed' || !project.selected_date_option_id || !current) {
    throw new Error('A final project date is required')
  }
  const financeMode = await getProjectFinanceMode(projectId)
  await reenterViaLateJoinFlow(
    {
      attendanceStatus: current.attendance_status as ParticipantAttendanceStatus,
      confirmedCount: count ?? 0,
      maxParticipants: project.max_participants,
    },
    async () => {
      const { error } = await supabaseAdmin
        .from('participants')
        .update({ attendance_status: 'confirmed', attendance_updated_at: new Date().toISOString() })
        .eq('id', participant.id)
      if (error) throw error
      try {
        if (financeMode === 'managed') {
          return await runLateJoinTransferUpsert(projectId, participant.id)
        }
        return { processed: false, reason: 'finance_disabled' }
      } catch (error) {
        await supabaseAdmin
          .from('participants')
          .update({ attendance_status: current.attendance_status, attendance_updated_at: new Date().toISOString() })
          .eq('id', participant.id)
        throw error
      }
    }
  )
  revalidatePath(`/project/${projectId}`)
}

export async function sendProjectDateReminders(projectId: string, kind: 'voting' | 'confirmation') {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const { manager } = await loadManagedDateProject(projectId, uid)
  const { data: participants, error: participantError } = await supabaseAdmin
    .from('participants')
    .select('user_id, attendance_status')
    .eq('project_id', projectId)
    .is('left_at', null)
  if (participantError) throw participantError

  let recipients = participants ?? []
  if (kind === 'voting') {
    const [{ data: options }, { data: responses }] = await Promise.all([
      supabaseAdmin.from('project_date_options').select('id').eq('project_id', projectId).eq('status', 'active'),
      supabaseAdmin.from('project_date_responses').select('date_option_id, user_id').eq('project_id', projectId),
    ])
    recipients = recipients.filter(participant =>
      (options ?? []).some(option => !(responses ?? []).some(
        response => response.user_id === participant.user_id && response.date_option_id === option.id
      ))
    )
  } else {
    recipients = recipients.filter(participant =>
      participant.attendance_status === 'awaiting_confirmation' || participant.attendance_status === 'unconfirmed'
    )
  }
  const stamp = new Date().toISOString().slice(0, 13)
  const rows = recipients.map(recipient => ({
    project_id: projectId,
    recipient_user_id: recipient.user_id,
    notification_type: kind === 'voting' ? 'date_voting_reminder' : 'date_confirmation_manual',
    title: kind === 'voting' ? 'Choose when you can attend' : 'Can you attend?',
    body: kind === 'voting'
      ? 'Please respond to every current project date option.'
      : 'Please confirm whether you can attend the selected project date.',
    metadata: { message_key: kind === 'voting' ? 'date_voting_reminder' : 'date_confirmation_manual' },
    dedupe_key: `manual-${kind}:${projectId}:${recipient.user_id}:${stamp}`,
  }))
  if (rows.length) {
    const { error } = await supabaseAdmin.from('project_notifications').upsert(rows, {
      onConflict: 'dedupe_key',
      ignoreDuplicates: true,
    })
    if (error) throw error
  }
  await recordProjectActivity({
    projectId,
    entryType: 'date_reminder_sent',
    actorUserId: uid,
    actorParticipantId: manager.id,
    metadata: { kind, recipients_count: rows.length },
  })
  revalidatePath(`/project/${projectId}`)
}


/** Create a poll with options (single choice). */
export async function createPoll(projectId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')
  const financeMode = await getProjectFinanceMode(projectId)

  const title = ((formData.get('project_title') as string) || (formData.get('title') as string) || '').trim()
  const description =
    ((formData.get('project_description') as string) || (formData.get('description') as string) || '').trim() || null
  const extraCostRaw = (formData.get('extra_cost') as string)?.trim() || ''
  const extraIsPerPerson = financeMode === 'managed' && (formData.get('extra_is_per_person') as string) === 'true'
  const requiredVotesRaw = (formData.get('required_votes') as string)?.trim() || ''
  const optionsRaw = (formData.get('options') as string)?.trim() || ''
  if (!title) throw new Error('Title is required')

  const extraCost = financeMode === 'managed' && extraCostRaw ? Number(extraCostRaw.replace(',', '.')) : 0
  if (!Number.isFinite(extraCost) || extraCost < 0) throw new Error('Invalid extra cost')
  const extraCents = financeMode === 'managed' ? Math.round(extraCost * 100) : 0

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
  const financeMode = await getProjectFinanceMode(projectId)

  const managedPoll = await requirePollManager(projectId, pollId, uid)
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

  const title = ((formData.get('project_title') as string) || (formData.get('title') as string) || '').trim()
  const description =
    ((formData.get('project_description') as string) || (formData.get('description') as string) || '').trim() || null
  const extraCostRaw = (formData.get('extra_cost') as string)?.trim() || ''
  const extraIsPerPerson = financeMode === 'managed' && (formData.get('extra_is_per_person') as string) === 'true'
  const requiredVotesRaw = (formData.get('required_votes') as string)?.trim() || ''
  const optionsRaw = (formData.get('options') as string)?.trim() || ''
  if (!title) throw new Error('Title is required')

  const extraCost = financeMode === 'managed' && extraCostRaw ? Number(extraCostRaw.replace(',', '.')) : 0
  if (!Number.isFinite(extraCost) || extraCost < 0) throw new Error('Invalid extra cost')
  const extraCents = financeMode === 'managed' ? Math.round(extraCost * 100) : 0

  const requiredVotes = requiredVotesRaw ? Number.parseInt(requiredVotesRaw, 10) : 1
  if (!Number.isFinite(requiredVotes) || requiredVotes < 1) throw new Error('Invalid required votes')

  const options = optionsRaw
    .split(/\r?\n/)
    .map(opt => opt.trim())
    .filter(Boolean)
  if (options.length === 0) throw new Error('At least one option is required')

  const { data: currentOptions, error: currentOptionsErr } = await supabaseAdmin
    .from('poll_options')
    .select('id, label')
    .eq('poll_id', pollId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (currentOptionsErr) throw currentOptionsErr
  const { data: votes, error: votesErr } = await supabaseAdmin
    .from('poll_votes')
    .select('id')
    .eq('poll_id', pollId)
    .limit(1)
  if (votesErr) throw votesErr
  const optionsChanged = options.length !== currentOptions?.length ||
    options.some((label, index) => label !== currentOptions?.[index].label)
  if (optionsChanged && votes?.length) {
    return { error: 'Poll options cannot be changed after voting has started.' }
  }

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

  // Metadata-only edits never touch option rows or their vote references.
  if (optionsChanged) {
    const { error: deleteErr } = await supabaseAdmin
      .from('poll_options')
      .delete()
      .eq('poll_id', pollId)
    if (deleteErr) throw deleteErr

    const { error: optionsErr } = await supabaseAdmin
      .from('poll_options')
      .insert(options.map(label => ({ poll_id: pollId, label })))
    if (optionsErr) throw optionsErr
  }

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

const friendlyRefundsUnavailableError = () =>
  new Error('Refund requests are unavailable until the latest database migration is applied')

type ResolvedExtraDue = {
  projectId: string
  projectStatus: string
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
      .select('id, collector_participant_id, min_participants, status')
      .eq('id', extra.project_id)
      .maybeSingle(),
    supabaseAdmin
      .from('participants')
      .select('id')
      .eq('project_id', extra.project_id)
      .is('left_at', null)
      .eq('attendance_status', 'confirmed'),
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
    projectStatus: String(project.status ?? ''),
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
  const dedicatedCollectorRaw = String(formData.get('dedicated_collector_participant_id') ?? '').trim()
  if (!title) throw new Error('Title is required')

  const { data: project, error: projectErr } = await supabaseAdmin
    .from('projects')
    .select('id, collector_participant_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectErr) throw new Error(projectErr.message ?? 'Failed to read project')
  if (!project) throw new Error('Project not found')

  const financeMode = await getProjectFinanceMode(projectId)
  if (financeMode === 'managed' && !amountRaw) throw new Error('Amount is required')
  const requestedAmountCents = financeMode === 'managed' ? normalizeEuroAmountToCents(amountRaw) : 0
  const requestedAmountIsPerPerson = financeMode === 'managed' && String(formData.get('amount_is_per_person') ?? '') === 'true'
  const requestedCollectionMode = financeMode === 'managed'
    ? parseExtraCollectionMode(String(formData.get('collection_mode') ?? ''))
    : 'project_collector'
  const extraFinance = normalizeExtraFinanceInput({
    financeMode,
    amountCents: requestedAmountCents,
    amountIsPerPerson: requestedAmountIsPerPerson,
    collectionMode: requestedCollectionMode,
    dedicatedCollectorParticipantId: dedicatedCollectorRaw || null,
  })
  const { amountCents, amountIsPerPerson, collectionMode } = extraFinance

  let dedicatedCollectorId: string | null = null
  if (financeMode === 'managed' && collectionMode === 'dedicated_collector') {
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

  const leftAt = new Date().toISOString()
  const { data: leftRows, error: leaveErr } = await supabaseAdmin
    .from('extra_memberships')
    .update({ left_at: leftAt })
    .eq('extra_id', extraId)
    .eq('participant_id', me.id)
    .is('left_at', null)
    .select('id')
  if (leaveErr) {
    if (missingTable(leaveErr, 'extra_memberships')) throw friendlyExtrasUnavailableError()
    throw new Error(leaveErr.message ?? 'Failed to leave extra')
  }

  const financeMode = await getProjectFinanceMode(projectId)
  if (financeMode === 'none' && (leftRows?.length ?? 0) === 0) {
    const { error: declineError } = await supabaseAdmin
      .from('extra_memberships')
      .upsert(
        { extra_id: extraId, participant_id: me.id, joined_at: leftAt, left_at: leftAt },
        { onConflict: 'extra_id,participant_id' }
      )
    if (declineError) throw new Error(declineError.message ?? 'Failed to save Extra preference')
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
  await requireManagedFinanceProject(projectId)
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

const friendlyBaseItineraryUnavailableError = () =>
  new Error('Base itinerary is unavailable until the latest database migration is applied')

const friendlyBaseItineraryPricingUnavailableError = () =>
  new Error('Base itinerary pricing is unavailable until the latest database migration is applied')

const parseBaseItineraryDraft = (formData: FormData) => {
  const title = String(formData.get('title') ?? '').trim()
  const descriptionRaw = String(formData.get('description') ?? '').trim()
  const amountRaw = String(formData.get('amount_eur') ?? '').trim()

  const amountFloat = amountRaw ? Number(amountRaw.replace(',', '.')) : 0
  if (!Number.isFinite(amountFloat) || amountFloat < 0) {
    throw new Error('Included price is invalid')
  }
  const amountCents = Math.round(amountFloat * 100)

  if (!title) throw new Error('Title is required')
  if (title.length > 180) throw new Error('Title is too long')
  if (descriptionRaw.length > 3000) throw new Error('Description is too long')

  return {
    title,
    description: descriptionRaw || null,
    amountCents,
  }
}

export async function createBaseItineraryItem(projectId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')

  await requireManagedFinanceProject(projectId)

  await requireActiveManager(projectId, uid)
  const { title, description, amountCents } = parseBaseItineraryDraft(formData)

  const { data: lastItem, error: lastErr } = await supabaseAdmin
    .from('project_base_itinerary_items')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastErr) {
    if (missingTable(lastErr, 'project_base_itinerary_items')) throw friendlyBaseItineraryUnavailableError()
    throw new Error(lastErr.message ?? 'Failed to load itinerary order')
  }
  const nextSortOrder = Math.max(0, Number(lastItem?.sort_order ?? 0)) + 1
  const nowIso = new Date().toISOString()

  const { error: createErr } = await supabaseAdmin
    .from('project_base_itinerary_items')
    .insert({
      project_id: projectId,
      title,
      description,
      amount_cents: amountCents,
      sort_order: nextSortOrder,
      created_by: uid,
      updated_at: nowIso,
    })
  if (createErr) {
    if (missingTable(createErr, 'project_base_itinerary_items')) throw friendlyBaseItineraryUnavailableError()
    if (missingColumn(createErr, 'amount_cents')) throw friendlyBaseItineraryPricingUnavailableError()
    throw new Error(createErr.message ?? 'Failed to create itinerary item')
  }

  revalidatePath(`/project/${projectId}`)
}

export async function updateBaseItineraryItem(projectId: string, itemId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')
  if (!itemId) throw new Error('Missing itinerary item id')

  await requireManagedFinanceProject(projectId)

  await requireActiveManager(projectId, uid)
  const { title, description, amountCents } = parseBaseItineraryDraft(formData)

  const { data: existingItem, error: existingErr } = await supabaseAdmin
    .from('project_base_itinerary_items')
    .select('id, project_id')
    .eq('id', itemId)
    .maybeSingle()
  if (existingErr) {
    if (missingTable(existingErr, 'project_base_itinerary_items')) throw friendlyBaseItineraryUnavailableError()
    throw new Error(existingErr.message ?? 'Failed to load itinerary item')
  }
  if (!existingItem || existingItem.project_id !== projectId) {
    throw new Error('Itinerary item not found')
  }

  const { error: updateErr } = await supabaseAdmin
    .from('project_base_itinerary_items')
    .update({
      title,
      description,
      amount_cents: amountCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('project_id', projectId)
  if (updateErr) {
    if (missingTable(updateErr, 'project_base_itinerary_items')) throw friendlyBaseItineraryUnavailableError()
    if (missingColumn(updateErr, 'amount_cents')) throw friendlyBaseItineraryPricingUnavailableError()
    throw new Error(updateErr.message ?? 'Failed to update itinerary item')
  }

  revalidatePath(`/project/${projectId}`)
}

export async function deleteBaseItineraryItem(projectId: string, itemId: string) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')
  if (!itemId) throw new Error('Missing itinerary item id')

  await requireManagedFinanceProject(projectId)

  await requireActiveManager(projectId, uid)

  const { error: deleteErr } = await supabaseAdmin
    .from('project_base_itinerary_items')
    .delete()
    .eq('id', itemId)
    .eq('project_id', projectId)
  if (deleteErr) {
    if (missingTable(deleteErr, 'project_base_itinerary_items')) throw friendlyBaseItineraryUnavailableError()
    throw new Error(deleteErr.message ?? 'Failed to delete itinerary item')
  }

  revalidatePath(`/project/${projectId}`)
}

export async function moveBaseItineraryItem(projectId: string, itemId: string, direction: 'up' | 'down') {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')
  await requireManagedFinanceProject(projectId)
  if (!itemId) throw new Error('Missing itinerary item id')
  if (direction !== 'up' && direction !== 'down') throw new Error('Invalid move direction')

  await requireActiveManager(projectId, uid)

  const { data: currentItem, error: currentErr } = await supabaseAdmin
    .from('project_base_itinerary_items')
    .select('id, project_id, sort_order')
    .eq('id', itemId)
    .maybeSingle()
  if (currentErr) {
    if (missingTable(currentErr, 'project_base_itinerary_items')) throw friendlyBaseItineraryUnavailableError()
    throw new Error(currentErr.message ?? 'Failed to load itinerary item')
  }
  if (!currentItem || currentItem.project_id !== projectId) {
    throw new Error('Itinerary item not found')
  }

  const neighborQuery = direction === 'up'
    ? supabaseAdmin
        .from('project_base_itinerary_items')
        .select('id, sort_order')
        .eq('project_id', projectId)
        .lt('sort_order', Number(currentItem.sort_order ?? 0))
        .order('sort_order', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
    : supabaseAdmin
        .from('project_base_itinerary_items')
        .select('id, sort_order')
        .eq('project_id', projectId)
        .gt('sort_order', Number(currentItem.sort_order ?? 0))
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)

  const { data: neighborItem, error: neighborErr } = await neighborQuery.maybeSingle()
  if (neighborErr) {
    if (missingTable(neighborErr, 'project_base_itinerary_items')) throw friendlyBaseItineraryUnavailableError()
    throw new Error(neighborErr.message ?? 'Failed to move itinerary item')
  }
  if (!neighborItem) {
    revalidatePath(`/project/${projectId}`)
    return
  }

  const nowIso = new Date().toISOString()
  const currentSortOrder = Number(currentItem.sort_order ?? 0)
  const neighborSortOrder = Number(neighborItem.sort_order ?? 0)

  const { error: currentUpdateErr } = await supabaseAdmin
    .from('project_base_itinerary_items')
    .update({ sort_order: neighborSortOrder, updated_at: nowIso })
    .eq('id', currentItem.id)
    .eq('project_id', projectId)
  if (currentUpdateErr) {
    if (missingTable(currentUpdateErr, 'project_base_itinerary_items')) throw friendlyBaseItineraryUnavailableError()
    throw new Error(currentUpdateErr.message ?? 'Failed to move itinerary item')
  }

  const { error: neighborUpdateErr } = await supabaseAdmin
    .from('project_base_itinerary_items')
    .update({ sort_order: currentSortOrder, updated_at: nowIso })
    .eq('id', neighborItem.id)
    .eq('project_id', projectId)
  if (neighborUpdateErr) {
    if (missingTable(neighborUpdateErr, 'project_base_itinerary_items')) throw friendlyBaseItineraryUnavailableError()
    throw new Error(neighborUpdateErr.message ?? 'Failed to move itinerary item')
  }

  revalidatePath(`/project/${projectId}`)
}

export async function updateProjectSettings(projectId: string, formData: FormData) {
  'use server'
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  if (!projectId) throw new Error('Missing project id')
  const { actorUserId, actorParticipantId } = await getActiveParticipantContext(projectId, uid)

  const baseProjectFields =
    'id, collector_participant_id, title, description, total_cents, total_is_per_person, min_participants, max_participants, event_start_at, event_end_at, event_location_label, event_location_address, event_location_lat, event_location_lng, event_location_place_id, date_mode'
  const optionalProjectFields = ['is_public', 'bundle_size', 'bundle_pay_for', 'finance_mode'] as const
  let optionalFields = [...optionalProjectFields]
  const missingFields = new Set<string>()
  let projectData: {
    id: string
    collector_participant_id: string | null
    title: string | null
    description: string | null
    total_cents: number | null
    total_is_per_person: boolean | null
    is_public: boolean | null
    bundle_size: number | null
    bundle_pay_for: number | null
    finance_mode: ProjectFinanceMode | null
    min_participants: number | null
    max_participants: number | null
    event_start_at: string | null
    event_end_at: string | null
    date_mode: 'fixed' | 'selecting' | null
    event_location_label: string | null
    event_location_address: string | null
    event_location_lat: number | null
    event_location_lng: number | null
    event_location_place_id: string | null
  } | null
  let projectErr: { message?: string; details?: string | null; hint?: string | null; code?: string } | null = null

  while (true) {
    const selectList = [baseProjectFields, ...optionalFields].join(', ')
    const result = await supabaseAdmin
      .from('projects')
      .select(selectList)
      .eq('id', projectId)
      .single()

    const missingField = optionalFields.find(field => missingColumn(result.error, field))
    if (missingField) {
      optionalFields = optionalFields.filter(field => field !== missingField)
      missingFields.add(missingField)
      if (optionalFields.length === 0) {
        const row = result.data as NonNullable<typeof projectData> | null
        projectData = row
          ? { ...row, is_public: true, bundle_size: null, bundle_pay_for: null, finance_mode: 'managed' }
          : null
        projectErr = result.error
        break
      }
      continue
    }

    const row = result.data as NonNullable<typeof projectData> | null
    projectData = row
      ? {
          ...row,
          bundle_size: 'bundle_size' in row ? row.bundle_size ?? null : null,
          bundle_pay_for: 'bundle_pay_for' in row ? row.bundle_pay_for ?? null : null,
          finance_mode: 'finance_mode' in row ? normalizeProjectFinanceMode(row.finance_mode) : 'managed',
        }
      : null
    projectErr = result.error
    break
  }
  const project = projectData
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
  const currentFinanceMode = normalizeProjectFinanceMode(project.finance_mode)
  const requestedFinanceModeRaw = String(formData.get('finance_mode') ?? currentFinanceMode)
  if (requestedFinanceModeRaw !== 'none' && requestedFinanceModeRaw !== 'managed') {
    throw new Error('Invalid shared cost management option')
  }
  const requestedFinanceMode: ProjectFinanceMode = requestedFinanceModeRaw
  if (requestedFinanceMode !== currentFinanceMode && formData.get('confirm_finance_mode_change') !== 'true') {
    throw new Error('Confirm the shared cost management change before saving')
  }
  if (requestedFinanceMode !== currentFinanceMode && missingFields.has('finance_mode')) {
    throw new Error('Shared cost management is unavailable until the latest database migration is applied.')
  }
  const visibility = String(formData.get('visibility') ?? (project.is_public === true ? 'public' : 'private')).trim().toLowerCase()
  const isPublic = visibility === 'public'
  const totalIsPerPerson = (formData.get('total_is_per_person') as string) === 'true'
  const bundleSizeRaw = String(formData.get('bundle_size') ?? '').trim()
  const bundlePayForRaw = String(formData.get('bundle_pay_for') ?? '').trim()
  const minRaw = String(formData.get('min_participants') ?? '').trim()
  const maxRaw = String(formData.get('max_participants') ?? '').trim()
  const eventStartDate = (formData.get('event_start_date') as string) ?? null
  const eventStartTime = (formData.get('event_start_time') as string) ?? null
  const eventEndDate = (formData.get('event_end_date') as string) ?? null
  const eventEndTime = (formData.get('event_end_time') as string) ?? null
  const eventLocationLabelRaw = String(formData.get('event_location_label') ?? '').trim()
  const eventLocationAddressRaw = String(formData.get('event_location_address') ?? '').trim()
  const eventLocationPlaceIdRaw = String(formData.get('event_location_place_id') ?? '').trim()
  const eventLocationLatRaw = String(formData.get('event_location_lat') ?? '').trim()
  const eventLocationLngRaw = String(formData.get('event_location_lng') ?? '').trim()
  if (!title) throw new Error('Title is required')

  const financeInput = validateProjectFinanceInput({
    financeMode: requestedFinanceMode,
    totalEur,
    totalIsPerPerson,
    bundleSize: bundleSizeRaw,
    bundlePayFor: bundlePayForRaw,
  })
  const total_cents = requestedFinanceMode === 'none'
    ? Number(project.total_cents ?? 0)
    : financeInput.totalCents
  const effectiveTotalIsPerPerson = requestedFinanceMode === 'none'
    ? !!project.total_is_per_person
    : financeInput.totalIsPerPerson
  const { bundleSize, bundlePayFor } = requestedFinanceMode === 'managed'
    ? validateBundlePricingConfig(effectiveTotalIsPerPerson, bundleSizeRaw, bundlePayForRaw)
    : { bundleSize: project.bundle_size ?? null, bundlePayFor: project.bundle_pay_for ?? null }

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

  const hasEventLocationLat = eventLocationLatRaw.length > 0
  const hasEventLocationLng = eventLocationLngRaw.length > 0
  if (hasEventLocationLat !== hasEventLocationLng) {
    throw new Error('Location coordinates must include both latitude and longitude')
  }
  const parseCoordinate = (value: string, axis: 'latitude' | 'longitude') => {
    if (!value) return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid location ${axis}`)
    }
    if (axis === 'latitude' && (parsed < -90 || parsed > 90)) {
      throw new Error('Location latitude must be between -90 and 90')
    }
    if (axis === 'longitude' && (parsed < -180 || parsed > 180)) {
      throw new Error('Location longitude must be between -180 and 180')
    }
    return parsed
  }
  const eventLocationLat = parseCoordinate(eventLocationLatRaw, 'latitude')
  const eventLocationLng = parseCoordinate(eventLocationLngRaw, 'longitude')
  const eventLocationLabel = eventLocationLabelRaw || null
  const eventLocationAddress = eventLocationAddressRaw || null
  const eventLocationPlaceId = eventLocationPlaceIdRaw || null

  const projectUpdate = {
    title,
    description,
    total_cents,
    total_is_per_person: effectiveTotalIsPerPerson,
    is_public: isPublic,
    bundle_size: bundleSize,
    bundle_pay_for: bundlePayFor,
    min_participants: minParticipants,
    max_participants: maxParticipants,
    event_start_at: project.date_mode === 'selecting' ? project.event_start_at : eventStartAt,
    event_end_at: project.date_mode === 'selecting' ? project.event_end_at : eventEndAt,
    event_location_label: eventLocationLabel,
    event_location_address: eventLocationAddress,
    event_location_lat: eventLocationLat,
    event_location_lng: eventLocationLng,
    event_location_place_id: eventLocationPlaceId,
  }

  if (currentFinanceMode === 'managed' && requestedFinanceMode === 'none') {
    const transition = await supabaseAdmin.rpc('set_project_finance_mode', {
      p_project_id: projectId,
      p_finance_mode: requestedFinanceMode,
    })
    if (transition.error) {
      if (transition.error.message?.includes('already has financial activity')) throw new Error(FINANCE_HISTORY_ERROR)
      throw new Error(transition.error.message ?? 'Failed to update shared cost management')
    }
  }

  let { error } = await supabaseAdmin
    .from('projects')
    .update(projectUpdate)
    .eq('id', projectId)
  if (missingColumn(error, 'is_public')) {
    throw new Error('Project visibility is unavailable until the latest database migration is applied')
  }
  if (missingColumn(error, 'bundle_size') || missingColumn(error, 'bundle_pay_for')) {
    if (bundleSize !== null || bundlePayFor !== null) {
      throw new Error('Bundle pricing is unavailable until the latest database migration is applied')
    }

    const { bundle_size: _bundleSize, bundle_pay_for: _bundlePayFor, ...fallbackUpdate } = projectUpdate
    void _bundleSize
    void _bundlePayFor
    const fallback = await supabaseAdmin
      .from('projects')
      .update(fallbackUpdate)
      .eq('id', projectId)
    error = fallback.error
  }
  if (error) throw error

  if (currentFinanceMode === 'none' && requestedFinanceMode === 'managed') {
    const paymentTypeRaw = String(formData.get('finance_payment_type') ?? '').trim()
    const paymentValue = String(formData.get('finance_payment_value') ?? '').trim()
    if (!['revolut', 'swedbank', 'iban'].includes(paymentTypeRaw) || !paymentValue) {
      throw new Error('A payment recipient is required to enable shared cost management')
    }
    const paymentType = paymentTypeRaw as 'revolut' | 'swedbank' | 'iban'
    const { data: existingUserPaymentOption, error: existingUserPaymentError } = await supabaseAdmin
      .from('user_payment_options')
      .select('id')
      .eq('user_id', uid)
      .eq('type', paymentType)
      .eq('value', paymentValue)
      .maybeSingle()
    if (existingUserPaymentError) throw new Error(existingUserPaymentError.message ?? 'Failed to verify payment recipient')
    if (!existingUserPaymentOption) {
      const { count: existingPaymentOptionsCount, error: countError } = await supabaseAdmin
        .from('user_payment_options')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
      if (countError) throw countError
      const { error: createPaymentOptionError } = await supabaseAdmin
        .from('user_payment_options')
        .insert({
          user_id: uid,
          type: paymentType,
          label: paymentType === 'iban' ? 'IBAN' : 'Payment Link',
          value: paymentValue,
          priority: existingPaymentOptionsCount ?? 0,
          is_active: true,
        })
      if (createPaymentOptionError) throw new Error(createPaymentOptionError.message ?? 'Failed to save payment recipient')
    }
    await clonePaymentOptionsForParticipant(project.collector_participant_id, uid)
    const { count: paymentOptionCount, error: paymentOptionError } = await supabaseAdmin
      .from('payment_options')
      .select('id', { count: 'exact', head: true })
      .eq('participant_id', project.collector_participant_id)
      .eq('is_active', true)
    if (paymentOptionError) throw new Error(paymentOptionError.message ?? 'Failed to verify payment recipient')
    if ((paymentOptionCount ?? 0) === 0) {
      throw new Error('Add an active payment method in your profile before enabling shared cost management')
    }
    const transition = await supabaseAdmin.rpc('set_project_finance_mode', {
      p_project_id: projectId,
      p_finance_mode: requestedFinanceMode,
    })
    if (transition.error) throw new Error(transition.error.message ?? 'Failed to enable shared cost management')
  }

  const toNullableNumber = (value: unknown) => {
    if (value === null || typeof value === 'undefined') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const equalNullableNumber = (a: number | null, b: number | null) => {
    if (a === null && b === null) return true
    if (a === null || b === null) return false
    return Math.abs(a - b) < 1e-9
  }
  const changedFields: string[] = []
  if ((project.title ?? null) !== title) changedFields.push('title')
  if ((project.description ?? null) !== description) changedFields.push('description')
  if (Number(project.total_cents ?? 0) !== total_cents) changedFields.push('total_cents')
  if (!!project.total_is_per_person !== effectiveTotalIsPerPerson) changedFields.push('total_is_per_person')
  if (currentFinanceMode !== requestedFinanceMode) changedFields.push('finance_mode')
  if (!!project.is_public !== isPublic) changedFields.push('is_public')
  if ((project.bundle_size ?? null) !== bundleSize) changedFields.push('bundle_size')
  if ((project.bundle_pay_for ?? null) !== bundlePayFor) changedFields.push('bundle_pay_for')
  if ((project.min_participants ?? null) !== minParticipants) changedFields.push('min_participants')
  if ((project.max_participants ?? null) !== maxParticipants) changedFields.push('max_participants')
  if ((project.event_start_at ?? null) !== eventStartAt) changedFields.push('event_start_at')
  if ((project.event_end_at ?? null) !== eventEndAt) changedFields.push('event_end_at')
  if ((project.event_location_label ?? null) !== eventLocationLabel) changedFields.push('event_location_label')
  if ((project.event_location_address ?? null) !== eventLocationAddress) changedFields.push('event_location_address')
  if (!equalNullableNumber(toNullableNumber(project.event_location_lat), eventLocationLat)) {
    changedFields.push('event_location_lat')
  }
  if (!equalNullableNumber(toNullableNumber(project.event_location_lng), eventLocationLng)) {
    changedFields.push('event_location_lng')
  }
  if ((project.event_location_place_id ?? null) !== eventLocationPlaceId) changedFields.push('event_location_place_id')

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

export async function updateProjectSettingsWithState(projectId: string, formData: FormData) {
  try {
    await updateProjectSettings(projectId, formData)
    return { error: null as string | null }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to update project settings',
    }
  }
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
  await requireManagedFinanceProject(projectId)
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
  await requireManagedFinanceProject(projectId)
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
  } catch (err: unknown) {
    const info = errorInfo(err)
    console.error('[cancelJoinRequestFromForm] error', { projectId, error: info.message || err, stack: info.stack })
    revalidatePath(`/project/${projectId}`)
    return { ok: false, error: info.message || 'Unknown error' }
  }
}
