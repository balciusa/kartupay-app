import 'server-only'

import { canManageProjectJoinRequests } from '@/lib/projectJoinRequests'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const PROJECT_NOTIFICATION_LIMIT = 20

export type ProjectNotificationType =
  | 'join_request_pending'
  | 'date_availability_24h'
  | 'date_availability_2h'
  | 'date_confirmation_24h'
  | 'date_confirmation_2h'

export type ProjectNotificationRow = {
  id: string
  project_id: string
  recipient_user_id: string
  notification_type: string
  title: string
  body: string
  metadata: unknown
  read_at: string | null
  created_at: string
}

export type ProjectNotificationItem = {
  id: string
  type: string
  title: string
  body: string
  createdAt: string
  createdAtLabel: string
  readAt: string | null
  href: string | null
  actionLabel: string | null
  resolvedLabel: string | null
}

export type ProjectNotificationSnapshot = {
  items: ProjectNotificationItem[]
  unreadCount: number
}

export type ProjectNotificationPresentationContext = {
  pendingJoinRequestIds: readonly string[]
  dateAvailabilityRequired: boolean
  attendanceConfirmationRequired: boolean
}

type NotificationInsert = {
  project_id: string
  recipient_user_id: string
  notification_type: ProjectNotificationType
  title: string
  body: string
  metadata: Record<string, unknown>
  dedupe_key: string
}

type NotificationDb = Pick<typeof supabaseAdmin, 'from'>

const fallbackContext: ProjectNotificationPresentationContext = {
  pendingJoinRequestIds: [],
  dateAvailabilityRequired: true,
  attendanceConfirmationRequired: true,
}

const uiStrings = {
  en: {
    joinTitle: 'Someone wants to join',
    joinBody: 'A join request is waiting for your review.',
    joinResolvedBody: 'This join request has already been reviewed.',
    joinAction: 'Review request',
    availabilityTitle: 'Choose your available dates',
    availability24hBody: 'Date voting closes soon. Add your availability.',
    availability2hBody: 'Final reminder: choose your available dates before voting closes.',
    availabilityResolvedBody: 'Your date availability is complete.',
    availabilityAction: 'Choose dates',
    confirmationTitle: 'Confirm your attendance',
    confirmation24hBody: 'Please confirm whether you can attend the selected project date.',
    confirmation2hBody: 'Final reminder: confirm whether you can attend the selected project date.',
    confirmationResolvedBody: 'Your attendance response is recorded.',
    confirmationAction: 'Confirm attendance',
    resolved: 'Resolved',
  },
  lt: {
    joinTitle: 'Gautas prisijungimo prašymas',
    joinBody: 'Laukia naujas prisijungimo prašymas.',
    joinResolvedBody: 'Šis prisijungimo prašymas jau peržiūrėtas.',
    joinAction: 'Peržiūrėti prašymą',
    availabilityTitle: 'Pasirinkite tinkamas datas',
    availability24hBody: 'Datų pasirinkimas netrukus baigsis. Pažymėkite, kada galite.',
    availability2hBody: 'Paskutinis priminimas: pasirinkite tinkamas datas iki balsavimo pabaigos.',
    availabilityResolvedBody: 'Jūsų pasirinkimai dėl datų užpildyti.',
    availabilityAction: 'Pasirinkti datas',
    confirmationTitle: 'Patvirtinkite dalyvavimą',
    confirmation24hBody: 'Patvirtinkite, ar galėsite dalyvauti pasirinktą projekto datą.',
    confirmation2hBody: 'Paskutinis priminimas: patvirtinkite, ar galėsite dalyvauti pasirinktą projekto datą.',
    confirmationResolvedBody: 'Jūsų dalyvavimo atsakymas išsaugotas.',
    confirmationAction: 'Patvirtinti dalyvavimą',
    resolved: 'Išspręsta',
  },
} as const

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}
}

function formatCreatedAt(value: string, locale: ProjectDateLocale) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'lt' ? 'lt-LT' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function presentProjectNotification(
  row: ProjectNotificationRow,
  locale: ProjectDateLocale,
  context: ProjectNotificationPresentationContext = fallbackContext
): ProjectNotificationItem {
  const strings = uiStrings[locale]
  const metadata = metadataRecord(row.metadata)
  const requestId = typeof metadata.join_request_id === 'string' ? metadata.join_request_id : null
  const base = {
    id: row.id,
    type: row.notification_type,
    createdAt: row.created_at,
    createdAtLabel: formatCreatedAt(row.created_at, locale),
    readAt: row.read_at,
  }

  if (row.notification_type === 'join_request_pending') {
    const actionable = !!requestId && context.pendingJoinRequestIds.includes(requestId)
    return {
      ...base,
      title: strings.joinTitle,
      body: actionable ? strings.joinBody : strings.joinResolvedBody,
      href: actionable ? `/project/${row.project_id}?tab=admin&adminModal=requests` : null,
      actionLabel: actionable ? strings.joinAction : null,
      resolvedLabel: actionable ? null : strings.resolved,
    }
  }

  if (row.notification_type === 'date_availability_24h' || row.notification_type === 'date_availability_2h') {
    const actionable = context.dateAvailabilityRequired
    return {
      ...base,
      title: strings.availabilityTitle,
      body: actionable
        ? row.notification_type === 'date_availability_2h'
          ? strings.availability2hBody
          : strings.availability24hBody
        : strings.availabilityResolvedBody,
      href: actionable ? `/project/${row.project_id}#date-availability` : null,
      actionLabel: actionable ? strings.availabilityAction : null,
      resolvedLabel: actionable ? null : strings.resolved,
    }
  }

  if (row.notification_type === 'date_confirmation_24h' || row.notification_type === 'date_confirmation_2h') {
    const actionable = context.attendanceConfirmationRequired
    return {
      ...base,
      title: strings.confirmationTitle,
      body: actionable
        ? row.notification_type === 'date_confirmation_2h'
          ? strings.confirmation2hBody
          : strings.confirmation24hBody
        : strings.confirmationResolvedBody,
      href: actionable ? `/project/${row.project_id}#project-date-finder` : null,
      actionLabel: actionable ? strings.confirmationAction : null,
      resolvedLabel: actionable ? null : strings.resolved,
    }
  }

  return {
    ...base,
    title: row.title,
    body: row.body,
    href: null,
    actionLabel: null,
    resolvedLabel: null,
  }
}

export async function loadProjectNotifications(
  projectId: string,
  recipientUserId: string,
  locale: ProjectDateLocale,
  context: ProjectNotificationPresentationContext,
  db: NotificationDb = supabaseAdmin
): Promise<ProjectNotificationSnapshot> {
  const { data, error } = await db
    .from('project_notifications')
    .select('id, project_id, recipient_user_id, notification_type, title, body, metadata, read_at, created_at')
    .eq('project_id', projectId)
    .eq('recipient_user_id', recipientUserId)
    .order('created_at', { ascending: false })
    .limit(PROJECT_NOTIFICATION_LIMIT)

  if (error) throw error
  const rows = (data ?? []) as ProjectNotificationRow[]
  return {
    items: rows.map(row => presentProjectNotification(row, locale, context)),
    unreadCount: rows.filter(row => !row.read_at).length,
  }
}

export async function enqueueProjectNotifications(
  rows: NotificationInsert[],
  db: NotificationDb = supabaseAdmin
) {
  if (rows.length === 0) return
  const { error } = await db.from('project_notifications').upsert(rows, {
    onConflict: 'dedupe_key',
    ignoreDuplicates: true,
  })
  if (error) throw error
}

export async function enqueueJoinRequestNotifications(input: {
  projectId: string
  joinRequestId: string
  requestedAt: string
  isPublic: boolean
  collectorParticipantId: string | null
}, db: NotificationDb = supabaseAdmin) {
  const { data, error } = await db
    .from('participants')
    .select('id, user_id, role, left_at')
    .eq('project_id', input.projectId)
    .is('left_at', null)
  if (error) throw error

  const recipients = (data ?? []).filter(participant => canManageProjectJoinRequests({
    isPublic: input.isPublic,
    participantId: participant.id,
    participantRole: participant.role,
    collectorParticipantId: input.collectorParticipantId,
  }))

  await enqueueProjectNotifications(recipients.map(participant => ({
    project_id: input.projectId,
    recipient_user_id: participant.user_id,
    notification_type: 'join_request_pending',
    title: 'Someone wants to join',
    body: 'A join request is waiting for your review.',
    metadata: {
      join_request_id: input.joinRequestId,
      requested_at: input.requestedAt,
    },
    dedupe_key: `join_request_pending:${input.joinRequestId}:${input.requestedAt}:${participant.user_id}`,
  })), db)
}

export async function markProjectNotificationReadForUser(
  projectId: string,
  notificationId: string,
  recipientUserId: string,
  db: NotificationDb = supabaseAdmin
) {
  const { error } = await db
    .from('project_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('project_id', projectId)
    .eq('recipient_user_id', recipientUserId)
    .is('read_at', null)
  if (error) throw error
}

export async function markAllProjectNotificationsReadForUser(
  projectId: string,
  recipientUserId: string,
  db: NotificationDb = supabaseAdmin
) {
  const { error } = await db
    .from('project_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('recipient_user_id', recipientUserId)
    .is('read_at', null)
  if (error) throw error
}

export async function markProjectNotificationTypesRead(input: {
  projectId: string
  recipientUserId: string
  types: ProjectNotificationType[]
}, db: NotificationDb = supabaseAdmin) {
  const { error } = await db
    .from('project_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('project_id', input.projectId)
    .eq('recipient_user_id', input.recipientUserId)
    .in('notification_type', input.types)
    .is('read_at', null)
  if (error) throw error
}

export async function markJoinRequestNotificationsResolved(
  projectId: string,
  joinRequestId: string,
  db: NotificationDb = supabaseAdmin
) {
  const { error } = await db
    .from('project_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('notification_type', 'join_request_pending')
    .eq('metadata->>join_request_id', joinRequestId)
    .is('read_at', null)
  if (error) throw error
}

export async function resolveCompletedDateAvailabilityNotifications(
  projectId: string,
  recipientUserId: string,
  db: NotificationDb = supabaseAdmin
) {
  const [{ data: options, error: optionsError }, { data: responses, error: responsesError }] = await Promise.all([
    db.from('project_date_options').select('id').eq('project_id', projectId).eq('status', 'active'),
    db.from('project_date_responses').select('date_option_id').eq('project_id', projectId).eq('user_id', recipientUserId),
  ])
  if (optionsError || responsesError) throw optionsError || responsesError
  const activeOptionIds = (options ?? []).map(option => option.id)
  if (activeOptionIds.length === 0) return false
  const respondedOptionIds = new Set((responses ?? []).map(response => response.date_option_id))
  if (!activeOptionIds.every(optionId => respondedOptionIds.has(optionId))) return false

  await markProjectNotificationTypesRead({
    projectId,
    recipientUserId,
    types: ['date_availability_24h', 'date_availability_2h'],
  }, db)
  return true
}
