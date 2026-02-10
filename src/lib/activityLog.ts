import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const ACTIVITY_ENTRY_TYPES = [
  'project_created',
  'project_updated',
  'project_status_changed',
  'collector_changed',
  'participant_joined',
  'participant_left',
  'join_request_submitted',
  'join_request_approved',
  'join_request_rejected',
  'join_request_canceled',
  'payment_reported',
  'payment_confirmed',
  'payment_unconfirmed',
  'late_transfer_created',
  'late_transfer_sender_marked',
  'late_transfer_collector_confirmed',
  'poll_created',
  'poll_updated',
  'poll_deleted',
  'poll_vote_cast',
  'poll_vote_changed',
  'extra_created',
  'extra_updated',
  'extra_joined',
  'extra_left',
  'extra_collector_changed',
  'extra_deleted',
] as const

export type ActivityEntryType = (typeof ACTIVITY_ENTRY_TYPES)[number]

export type ActivityCategory = 'project' | 'participants' | 'requests' | 'payments' | 'voting' | 'extras' | 'other'

const ACTIVITY_CATEGORY_BY_TYPE: Record<ActivityEntryType, ActivityCategory> = {
  project_created: 'project',
  project_updated: 'project',
  project_status_changed: 'project',
  collector_changed: 'project',
  participant_joined: 'participants',
  participant_left: 'participants',
  join_request_submitted: 'requests',
  join_request_approved: 'requests',
  join_request_rejected: 'requests',
  join_request_canceled: 'requests',
  payment_reported: 'payments',
  payment_confirmed: 'payments',
  payment_unconfirmed: 'payments',
  late_transfer_created: 'payments',
  late_transfer_sender_marked: 'payments',
  late_transfer_collector_confirmed: 'payments',
  poll_created: 'voting',
  poll_updated: 'voting',
  poll_deleted: 'voting',
  poll_vote_cast: 'voting',
  poll_vote_changed: 'voting',
  extra_created: 'extras',
  extra_updated: 'extras',
  extra_joined: 'extras',
  extra_left: 'extras',
  extra_collector_changed: 'extras',
  extra_deleted: 'extras',
}

export const getActivityCategory = (entryType: string): ActivityCategory => {
  if ((ACTIVITY_ENTRY_TYPES as readonly string[]).includes(entryType)) {
    return ACTIVITY_CATEGORY_BY_TYPE[entryType as ActivityEntryType]
  }
  return 'other'
}

type ActivityMetadata = Record<string, unknown>

export type RecordProjectActivityInput = {
  projectId: string
  entryType: ActivityEntryType
  actorUserId?: string | null
  actorParticipantId?: string | null
  targetUserId?: string | null
  targetParticipantId?: string | null
  paymentId?: string | null
  pollId?: string | null
  extraId?: string | null
  joinRequestId?: string | null
  lateTransferId?: string | null
  metadata?: ActivityMetadata | null
}

const isMissingActivityLogsTable = (error?: {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
} | null) => {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase()
  if (error?.code === '42P01') return true
  return haystack.includes('activity_logs') && (
    haystack.includes('does not exist') ||
    haystack.includes('could not find') ||
    haystack.includes('schema cache') ||
    haystack.includes('unknown table')
  )
}

export async function recordProjectActivity(input: RecordProjectActivityInput) {
  const {
    projectId,
    entryType,
    actorUserId = null,
    actorParticipantId = null,
    targetUserId = null,
    targetParticipantId = null,
    paymentId = null,
    pollId = null,
    extraId = null,
    joinRequestId = null,
    lateTransferId = null,
    metadata,
  } = input

  if (!projectId || !entryType) return

  const { error } = await supabaseAdmin
    .from('activity_logs')
    .insert({
      project_id: projectId,
      entry_type: entryType,
      actor_user_id: actorUserId,
      actor_participant_id: actorParticipantId,
      target_user_id: targetUserId,
      target_participant_id: targetParticipantId,
      payment_id: paymentId,
      poll_id: pollId,
      extra_id: extraId,
      join_request_id: joinRequestId,
      late_transfer_id: lateTransferId,
      metadata: metadata ?? {},
    })

  if (!error) return

  if (isMissingActivityLogsTable(error)) {
    console.warn('[activity_logs] table missing, skipping activity write')
    return
  }

  console.error('[activity_logs] failed to record activity', {
    projectId,
    entryType,
    error,
  })
}
