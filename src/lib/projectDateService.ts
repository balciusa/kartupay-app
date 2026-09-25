import { recordProjectActivity } from '@/lib/activityLog'
import {
  DEFAULT_CONFIRMATION_WINDOW_HOURS,
  fullyRespondedDateParticipantIds,
  rankDateOptions,
  type DateAvailability,
  type DateOptionLike,
  type DateResponseLike,
  type ParticipantAttendanceStatus,
} from '@/lib/projectDateSelection'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

type DateProjectRow = {
  id: string
  date_mode: 'fixed' | 'selecting'
  date_selection_status: 'open' | 'awaiting_organizer_decision' | 'date_selected' | 'confirmation_open' | 'confirmed'
  date_voting_deadline_at: string | null
  date_suggestions_close_at: string | null
  selected_date_option_id: string | null
  confirmation_deadline_at: string | null
  event_start_at: string | null
  event_end_at: string | null
  min_participants: number | null
  max_participants: number | null
}

export type ProjectDateFinderOption = DateOptionLike & {
  created_by_user_id: string
  created_at: string
  source: 'organizer' | 'participant'
  suggestedBy: string
  availableCount: number
  maybeCount: number
  unavailableCount: number
  preferredCount: number
  viewerAvailability: DateAvailability | null
  viewerPreferred: boolean
  isCurrentlyBest: boolean
  isTied: boolean
  otherResponseCount: number
}

export type ProjectDateFinderData = {
  available: boolean
  dateMode: 'fixed' | 'selecting'
  selectionStatus: DateProjectRow['date_selection_status']
  votingDeadlineAt: string | null
  suggestionsCloseAt: string | null
  selectedDateOptionId: string | null
  confirmationDeadlineAt: string | null
  eventStartAt: string | null
  eventEndAt: string | null
  minParticipants: number | null
  maxParticipants: number | null
  options: ProjectDateFinderOption[]
  respondedCount: number
  memberCount: number
  confirmedCount: number
  awaitingCount: number
  cannotAttendCount: number
  missingResponseNames: string[]
  awaitingNames: string[]
  viewerAttendanceStatus: ParticipantAttendanceStatus | null
  viewerTaskComplete: boolean
  unreadNotificationCount: number
}

const dateFields =
  'id, date_mode, date_selection_status, date_voting_deadline_at, date_suggestions_close_at, selected_date_option_id, confirmation_deadline_at, event_start_at, event_end_at, min_participants, max_participants'

const isMissingDateSchema = (error: { code?: string; message?: string } | null | undefined) => {
  const message = String(error?.message ?? '').toLowerCase()
  return error?.code === '42P01' || error?.code === 'PGRST204' || message.includes('date_mode') || message.includes('project_date_')
}

const defaultConfirmationDeadline = (now: Date) =>
  new Date(now.getTime() + DEFAULT_CONFIRMATION_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

export async function applySelectedProjectDate(
  projectId: string,
  optionId: string,
  input?: { actorUserId?: string | null; actorParticipantId?: string | null; confirmationDeadlineAt?: string | null }
) {
  const now = new Date()
  const confirmationDeadlineAt = input?.confirmationDeadlineAt
    ? new Date(input.confirmationDeadlineAt).toISOString()
    : defaultConfirmationDeadline(now)
  if (new Date(confirmationDeadlineAt) <= now) throw new Error('Confirmation deadline must be in the future')

  const { data: option, error: optionError } = await supabaseAdmin
    .from('project_date_options')
    .select('id, project_id, starts_at, ends_at, status')
    .eq('id', optionId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (optionError || !option || option.status !== 'active') throw new Error('Date option not found')

  const { error } = await supabaseAdmin.rpc('apply_project_date_selection', {
    p_project_id: projectId,
    p_option_id: optionId,
    p_confirmation_deadline: confirmationDeadlineAt,
  })
  if (error) {
    if (String(error.message ?? '').toLowerCase().includes('already been selected')) return
    throw new Error(error.message ?? 'Failed to select project date')
  }

  await recordProjectActivity({
    projectId,
    entryType: 'project_date_selected',
    actorUserId: input?.actorUserId ?? null,
    actorParticipantId: input?.actorParticipantId ?? null,
    metadata: {
      date_option_id: optionId,
      starts_at: option.starts_at,
      ends_at: option.ends_at,
      confirmation_deadline_at: confirmationDeadlineAt,
    },
  })
}

async function enqueueConfirmationReminders(project: DateProjectRow, now: Date) {
  if (!project.confirmation_deadline_at || project.date_selection_status !== 'confirmation_open') return
  const deadline = new Date(project.confirmation_deadline_at)
  const hoursRemaining = (deadline.getTime() - now.getTime()) / (60 * 60 * 1000)
  const reminderType = hoursRemaining <= 2
    ? 'date_confirmation_2h'
    : hoursRemaining <= 24
      ? 'date_confirmation_24h'
      : null
  if (!reminderType || hoursRemaining <= 0) return

  const { data: recipients, error: recipientError } = await supabaseAdmin
    .from('participants')
    .select('user_id')
    .eq('project_id', project.id)
    .is('left_at', null)
    .in('attendance_status', ['awaiting_confirmation', 'unconfirmed'])
  if (recipientError) throw recipientError
  const rows = (recipients ?? []).map(row => ({
    project_id: project.id,
    recipient_user_id: row.user_id,
    notification_type: reminderType,
    title: 'Can you attend?',
    body: hoursRemaining <= 2
      ? 'Final reminder: confirm whether you can attend the selected project date.'
      : 'Please confirm whether you can attend the selected project date.',
    metadata: {
      message_key: reminderType,
      confirmation_deadline_at: project.confirmation_deadline_at,
    },
    dedupe_key: `${reminderType}:${project.id}:${row.user_id}`,
  }))
  if (rows.length) {
    const { error } = await supabaseAdmin.from('project_notifications').upsert(rows, {
      onConflict: 'dedupe_key',
      ignoreDuplicates: true,
    })
    if (error) throw error
  }
}

export async function syncProjectDateSelection(projectId: string, now = new Date()) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select(dateFields)
    .eq('id', projectId)
    .maybeSingle()
  if (error) {
    if (isMissingDateSchema(error)) return false
    throw error
  }
  if (!data) return false
  const project = data as DateProjectRow

  if (
    project.date_mode === 'selecting'
    && project.date_selection_status === 'open'
    && project.date_voting_deadline_at
    && new Date(project.date_voting_deadline_at) <= now
  ) {
    const [{ data: options, error: optionsError }, { data: responses, error: responsesError }, { data: participants, error: participantsError }] =
      await Promise.all([
        supabaseAdmin
          .from('project_date_options')
          .select('id, starts_at, ends_at, status')
          .eq('project_id', projectId),
        supabaseAdmin
          .from('project_date_responses')
          .select('date_option_id, user_id, availability, is_preferred')
          .eq('project_id', projectId),
        supabaseAdmin
          .from('participants')
          .select('user_id')
          .eq('project_id', projectId)
          .is('left_at', null),
      ])
    if (optionsError || responsesError || participantsError) throw optionsError || responsesError || participantsError
    const result = rankDateOptions(
      (options ?? []) as DateOptionLike[],
      (responses ?? []) as DateResponseLike[],
      (participants ?? []).map(participant => participant.user_id)
    )
    if (result.kind === 'winner') {
      await applySelectedProjectDate(projectId, result.winnerId)
    } else {
      const { error: updateError } = await supabaseAdmin
        .from('projects')
        .update({ date_selection_status: 'awaiting_organizer_decision' })
        .eq('id', projectId)
        .eq('date_selection_status', 'open')
      if (updateError) throw updateError
    }
    return true
  }

  if (
    project.date_mode === 'fixed'
    && project.date_selection_status === 'confirmation_open'
    && project.confirmation_deadline_at
  ) {
    await enqueueConfirmationReminders(project, now)
    if (new Date(project.confirmation_deadline_at) <= now) {
      const { error: participantsError } = await supabaseAdmin
        .from('participants')
        .update({ attendance_status: 'unconfirmed', attendance_updated_at: now.toISOString() })
        .eq('project_id', projectId)
        .is('left_at', null)
        .eq('attendance_status', 'awaiting_confirmation')
      if (participantsError) throw participantsError
      const { error: taskError } = await supabaseAdmin
        .from('project_priority_tasks')
        .update({ status: 'completed', completed_at: now.toISOString(), updated_at: now.toISOString() })
        .eq('project_id', projectId)
        .eq('task_type', 'date_confirmation')
        .eq('status', 'open')
      if (taskError) throw taskError
      const { error: projectError } = await supabaseAdmin
        .from('projects')
        .update({ date_selection_status: 'confirmed' })
        .eq('id', projectId)
        .eq('date_selection_status', 'confirmation_open')
      if (projectError) throw projectError
      return true
    }
  }
  return false
}

export async function processDueProjectDateWork(now = new Date()) {
  const confirmationWindowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const [{ data: votingProjects, error: votingError }, { data: confirmationProjects, error: confirmationError }] =
    await Promise.all([
      supabaseAdmin
        .from('projects')
        .select('id')
        .eq('date_mode', 'selecting')
        .eq('date_selection_status', 'open')
        .lte('date_voting_deadline_at', now.toISOString()),
      supabaseAdmin
        .from('projects')
        .select('id')
        .eq('date_mode', 'fixed')
        .eq('date_selection_status', 'confirmation_open')
        .lte('confirmation_deadline_at', confirmationWindowEnd),
    ])
  if (votingError || confirmationError) throw votingError || confirmationError
  const projectIds = Array.from(new Set([
    ...(votingProjects ?? []).map(project => project.id),
    ...(confirmationProjects ?? []).map(project => project.id),
  ]))
  const results = await Promise.all(projectIds.map(projectId => syncProjectDateSelection(projectId, now)))
  return { checked: projectIds.length, changed: results.filter(Boolean).length }
}

const memberLabel = (participant: {
  short_code?: string | null
  users?: { display_name?: string | null; email?: string | null } | Array<{ display_name?: string | null; email?: string | null }> | null
}) => {
  const profile = Array.isArray(participant.users) ? participant.users[0] : participant.users
  if (profile?.display_name?.trim()) return profile.display_name.trim()
  if (profile?.email) return profile.email.split('@')[0]
  return participant.short_code ? `#${participant.short_code}` : 'Member'
}

export async function loadProjectDateFinderData(
  projectId: string,
  viewerUserId: string | null
): Promise<ProjectDateFinderData | null> {
  await syncProjectDateSelection(projectId)
  const { data: projectData, error: projectError } = await supabaseAdmin
    .from('projects')
    .select(dateFields)
    .eq('id', projectId)
    .maybeSingle()
  if (projectError) {
    if (isMissingDateSchema(projectError)) return null
    throw projectError
  }
  if (!projectData) return null
  const project = projectData as DateProjectRow

  const [{ data: optionRows, error: optionError }, { data: responseRows, error: responseError }, { data: participantRows, error: participantError }] =
    await Promise.all([
      supabaseAdmin
        .from('project_date_options')
        .select('id, project_id, starts_at, ends_at, created_by_user_id, created_at, status, source')
        .eq('project_id', projectId)
        .order('starts_at', { ascending: true }),
      supabaseAdmin
        .from('project_date_responses')
        .select('date_option_id, user_id, availability, is_preferred')
        .eq('project_id', projectId),
      supabaseAdmin
        .from('participants')
        .select('id, user_id, short_code, attendance_status, users(display_name, email)')
        .eq('project_id', projectId)
        .is('left_at', null),
    ])
  if (optionError || responseError || participantError) {
    const schemaError = optionError || responseError || participantError
    if (isMissingDateSchema(schemaError)) return null
    throw schemaError
  }

  const options = (optionRows ?? []) as Array<DateOptionLike & {
    project_id: string
    created_by_user_id: string
    created_at: string
    source: 'organizer' | 'participant'
  }>
  const responses = (responseRows ?? []) as DateResponseLike[]
  const participants = (participantRows ?? []) as Array<{
    id: string
    user_id: string
    short_code: string | null
    attendance_status: ParticipantAttendanceStatus
    users: { display_name?: string | null; email?: string | null } | Array<{ display_name?: string | null; email?: string | null }> | null
  }>
  const userIds = participants.map(participant => participant.user_id)
  const ranking = rankDateOptions(options, responses, userIds)
  const bestIds = ranking.kind === 'winner' ? [ranking.winnerId] : ranking.kind === 'tie' ? ranking.tiedOptionIds : []
  const labelByUserId = new Map(participants.map(participant => [participant.user_id, memberLabel(participant)]))
  const activeOptions = options.filter(option => (option.status ?? 'active') === 'active')
  const fullyRespondedUserIds = new Set(fullyRespondedDateParticipantIds(
    activeOptions.map(option => option.id),
    responses,
    userIds
  ))
  const viewerTaskComplete = !!viewerUserId && fullyRespondedUserIds.has(viewerUserId)
  const viewerTaskResult = viewerUserId
    ? await supabaseAdmin
        .from('project_priority_tasks')
        .select('status')
        .eq('project_id', projectId)
        .eq('user_id', viewerUserId)
        .eq('task_type', project.date_mode === 'selecting' ? 'date_availability' : 'date_confirmation')
        .maybeSingle()
    : { data: null, error: null }
  const unreadResult = viewerUserId
    ? await supabaseAdmin
        .from('project_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('recipient_user_id', viewerUserId)
        .is('read_at', null)
    : { count: 0, error: null }

  const tallyById = new Map(ranking.tallies.map(tally => [tally.id, tally]))
  return {
    available: true,
    dateMode: project.date_mode,
    selectionStatus: project.date_selection_status,
    votingDeadlineAt: project.date_voting_deadline_at,
    suggestionsCloseAt: project.date_suggestions_close_at,
    selectedDateOptionId: project.selected_date_option_id,
    confirmationDeadlineAt: project.confirmation_deadline_at,
    eventStartAt: project.event_start_at,
    eventEndAt: project.event_end_at,
    minParticipants: project.min_participants,
    maxParticipants: project.max_participants,
    options: options.map(option => {
      const tally = tallyById.get(option.id)
      const viewerResponse = responses.find(
        response => response.user_id === viewerUserId && response.date_option_id === option.id
      )
      return {
        ...option,
        suggestedBy: labelByUserId.get(option.created_by_user_id) ?? 'Member',
        availableCount: tally?.availableCount ?? 0,
        maybeCount: tally?.maybeCount ?? 0,
        unavailableCount: tally?.unavailableCount ?? 0,
        preferredCount: tally?.preferredCount ?? 0,
        viewerAvailability: viewerResponse?.availability ?? null,
        viewerPreferred: viewerResponse?.is_preferred ?? false,
        isCurrentlyBest: bestIds.length === 1 && bestIds[0] === option.id,
        isTied: bestIds.length > 1 && bestIds.includes(option.id),
        otherResponseCount: responses.filter(
          response => response.date_option_id === option.id && response.user_id !== option.created_by_user_id
        ).length,
      }
    }),
    respondedCount: fullyRespondedUserIds.size,
    memberCount: participants.length,
    confirmedCount: participants.filter(participant => participant.attendance_status === 'confirmed').length,
    awaitingCount: participants.filter(participant =>
      participant.attendance_status === 'awaiting_confirmation' || participant.attendance_status === 'unconfirmed'
    ).length,
    cannotAttendCount: participants.filter(participant =>
      participant.attendance_status === 'cannot_attend' || participant.attendance_status === 'observer'
    ).length,
    missingResponseNames: participants
      .filter(participant => !fullyRespondedUserIds.has(participant.user_id))
      .map(memberLabel),
    awaitingNames: participants
      .filter(participant =>
        participant.attendance_status === 'awaiting_confirmation' || participant.attendance_status === 'unconfirmed'
      )
      .map(memberLabel),
    viewerAttendanceStatus:
      participants.find(participant => participant.user_id === viewerUserId)?.attendance_status ?? null,
    viewerTaskComplete: viewerTaskResult.data?.status === 'completed' || viewerTaskComplete,
    unreadNotificationCount: unreadResult.count ?? 0,
  }
}
