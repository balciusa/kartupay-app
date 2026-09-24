export const DATE_SUGGESTION_CLOSE_HOURS = 24
export const DEFAULT_CONFIRMATION_WINDOW_HOURS = 48

export type DateAvailability = 'available' | 'maybe' | 'unavailable'
export type ParticipantAttendanceStatus =
  | 'pending_date_selection'
  | 'confirmed'
  | 'awaiting_confirmation'
  | 'cannot_attend'
  | 'unconfirmed'
  | 'observer'

export type DateOptionLike = {
  id: string
  starts_at: string
  ends_at: string | null
  status?: 'active' | 'removed'
  created_by_user_id?: string | null
}

export type DateResponseLike = {
  date_option_id: string
  user_id: string
  availability: DateAvailability
  is_preferred: boolean
}

export type DateOptionTally = DateOptionLike & {
  availableCount: number
  maybeCount: number
  unavailableCount: number
  preferredCount: number
}

export type RankedDateResult =
  | { kind: 'no_options'; tallies: DateOptionTally[]; winnerId: null; tiedOptionIds: [] }
  | { kind: 'winner'; tallies: DateOptionTally[]; winnerId: string; tiedOptionIds: [] }
  | { kind: 'tie'; tallies: DateOptionTally[]; winnerId: null; tiedOptionIds: string[] }

export type ProjectDatePresentationState =
  | 'collecting_responses'
  | 'all_responded'
  | 'organizer_decision_required'
  | 'final_date_confirmed'

export function deriveProjectDatePresentationState(input: {
  dateMode: 'fixed' | 'selecting'
  selectionStatus: 'open' | 'awaiting_organizer_decision' | 'date_selected' | 'confirmation_open' | 'confirmed'
  selectedDateOptionId: string | null
  respondedCount: number
  memberCount: number
}): ProjectDatePresentationState {
  if (input.dateMode === 'fixed' && input.selectedDateOptionId) return 'final_date_confirmed'
  if (input.selectionStatus === 'awaiting_organizer_decision') return 'organizer_decision_required'
  if (input.dateMode === 'selecting' && input.selectionStatus === 'open'
    && input.memberCount > 0 && input.respondedCount >= input.memberCount) {
    return 'all_responded'
  }
  return 'collecting_responses'
}

const validDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date')
  return date
}

export function normalizeDateOption(startsAt: string, endsAt: string | null | undefined) {
  const start = validDate(startsAt)
  const end = endsAt ? validDate(endsAt) : null
  if (end && end <= start) throw new Error('Date option must end after it starts')
  return {
    startsAt: start.toISOString(),
    endsAt: end?.toISOString() ?? null,
  }
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const dateOnlyToIso = (value: string, label: string) => {
  const normalized = value.trim()
  if (!DATE_ONLY_PATTERN.test(normalized)) throw new Error(`Invalid ${label}`)
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`Invalid ${label}`)
  }
  return parsed.toISOString()
}

export function normalizeDateOnlyOption(startDate: string, endDate: string | null | undefined) {
  const startsAt = dateOnlyToIso(startDate, 'start date')
  const endsAt = endDate?.trim() ? dateOnlyToIso(endDate, 'end date') : null
  return normalizeDateOption(startsAt, endsAt)
}

export function isDateOnlyTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(value)
}

export function isDateOnlyOption(startsAt: string, endsAt: string | null | undefined) {
  return isDateOnlyTimestamp(startsAt) && (!endsAt || isDateOnlyTimestamp(endsAt))
}

export function applyTimeToDateOption(input: {
  startsAt: string
  endsAt?: string | null
  startTime?: string | null
  endTime?: string | null
  timezoneOffsetMinutes: number
}) {
  const startTime = input.startTime?.trim() ?? ''
  const endTime = input.endTime?.trim() ?? ''
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
  if (startTime && !timePattern.test(startTime)) throw new Error('Invalid start time')
  if (endTime && !timePattern.test(endTime)) throw new Error('Invalid end time')
  if (!startTime && endTime) throw new Error('Choose a start time before adding an end time')
  if (!Number.isFinite(input.timezoneOffsetMinutes) || input.timezoneOffsetMinutes < -840 || input.timezoneOffsetMinutes > 840) {
    throw new Error('Invalid timezone')
  }

  const combineDateAndTime = (dateIso: string, time: string) => {
    const datePart = dateIso.slice(0, 10)
    const [year, month, day] = datePart.split('-').map(Number)
    const [hours, minutes] = time.split(':').map(Number)
    const timestamp = Date.UTC(year, month - 1, day, hours, minutes) + input.timezoneOffsetMinutes * 60 * 1000
    return new Date(timestamp).toISOString()
  }

  const eventStartAt = startTime ? combineDateAndTime(input.startsAt, startTime) : input.startsAt
  const eventEndAt = endTime
    ? combineDateAndTime(input.endsAt || input.startsAt, endTime)
    : input.endsAt ?? null
  if (eventEndAt && new Date(eventEndAt) <= new Date(eventStartAt)) {
    throw new Error('End time must be after start time')
  }
  return { eventStartAt, eventEndAt }
}

export function isDuplicateDateOption(
  options: DateOptionLike[],
  startsAt: string,
  endsAt: string | null | undefined
) {
  const normalized = normalizeDateOption(startsAt, endsAt)
  return options.some(option => {
    const candidate = normalizeDateOption(option.starts_at, option.ends_at)
    return candidate.startsAt === normalized.startsAt && candidate.endsAt === normalized.endsAt
  })
}

export function suggestionsCloseAt(deadline: string | Date, closeHours = DATE_SUGGESTION_CLOSE_HOURS) {
  const value = deadline instanceof Date ? deadline : validDate(deadline)
  return new Date(value.getTime() - closeHours * 60 * 60 * 1000)
}

export function canSuggestDate(
  deadline: string | Date,
  now: string | Date = new Date(),
  closeHours = DATE_SUGGESTION_CLOSE_HOURS
) {
  const current = now instanceof Date ? now : validDate(now)
  return current < suggestionsCloseAt(deadline, closeHours)
}

export function isDateAvailabilityTaskComplete(
  activeOptionIds: string[],
  responses: DateResponseLike[],
  userId: string
) {
  if (activeOptionIds.length === 0) return false
  const responded = new Set(
    responses.filter(response => response.user_id === userId).map(response => response.date_option_id)
  )
  return activeOptionIds.every(optionId => responded.has(optionId))
}

export function dateAvailabilityTaskForParticipant(input: {
  dateMode: 'fixed' | 'selecting'
  activeOptionIds: string[]
  responses: DateResponseLike[]
  userId: string
}) {
  if (input.dateMode !== 'selecting') return null
  const completed = isDateAvailabilityTaskComplete(input.activeOptionIds, input.responses, input.userId)
  return {
    type: 'date_availability' as const,
    status: completed ? 'completed' as const : 'open' as const,
  }
}

export function applyDateResponse(
  responses: DateResponseLike[],
  response: DateResponseLike
): DateResponseLike[] {
  if (response.is_preferred && response.availability !== 'available') {
    throw new Error('Preferred date must also be available')
  }

  const withoutCurrent = responses.filter(
    item => !(item.date_option_id === response.date_option_id && item.user_id === response.user_id)
  )
  const normalized = response.is_preferred
    ? withoutCurrent.map(item =>
        item.user_id === response.user_id && item.is_preferred ? { ...item, is_preferred: false } : item
      )
    : withoutCurrent

  return [...normalized, response]
}

export function buildDateTallies(
  options: DateOptionLike[],
  responses: DateResponseLike[],
  eligibleUserIds?: Iterable<string>
): DateOptionTally[] {
  const eligible = eligibleUserIds ? new Set(eligibleUserIds) : null
  return options
    .filter(option => (option.status ?? 'active') === 'active')
    .map(option => {
      const optionResponses = responses.filter(
        response => response.date_option_id === option.id && (!eligible || eligible.has(response.user_id))
      )
      return {
        ...option,
        availableCount: optionResponses.filter(response => response.availability === 'available').length,
        maybeCount: optionResponses.filter(response => response.availability === 'maybe').length,
        unavailableCount: optionResponses.filter(response => response.availability === 'unavailable').length,
        preferredCount: optionResponses.filter(
          response => response.availability === 'available' && response.is_preferred
        ).length,
      }
    })
}

export function rankDateOptions(
  options: DateOptionLike[],
  responses: DateResponseLike[],
  eligibleUserIds?: Iterable<string>
): RankedDateResult {
  const tallies = buildDateTallies(options, responses, eligibleUserIds)
  if (tallies.length === 0) {
    return { kind: 'no_options', tallies, winnerId: null, tiedOptionIds: [] }
  }

  const maxAvailable = Math.max(...tallies.map(option => option.availableCount))
  const availableLeaders = tallies.filter(option => option.availableCount === maxAvailable)
  const maxPreferred = Math.max(...availableLeaders.map(option => option.preferredCount))
  const finalists = availableLeaders.filter(option => option.preferredCount === maxPreferred)

  if (finalists.length === 1) {
    return { kind: 'winner', tallies, winnerId: finalists[0].id, tiedOptionIds: [] }
  }
  return { kind: 'tie', tallies, winnerId: null, tiedOptionIds: finalists.map(option => option.id) }
}

export function canRemoveDateOption(input: {
  option: DateOptionLike
  actorUserId: string
  isOrganizer: boolean
  responses: DateResponseLike[]
}) {
  if (input.isOrganizer) return true
  if (input.option.created_by_user_id !== input.actorUserId) return false
  return !input.responses.some(
    response => response.date_option_id === input.option.id && response.user_id !== input.actorUserId
  )
}

export function attendanceAfterSelection(
  availability: DateAvailability | null | undefined
): ParticipantAttendanceStatus {
  if (availability === 'available') return 'confirmed'
  if (availability === 'maybe') return 'awaiting_confirmation'
  if (availability === 'unavailable') return 'cannot_attend'
  return 'unconfirmed'
}

export function confirmationStatusAfterDeadline(status: ParticipantAttendanceStatus) {
  return status === 'awaiting_confirmation' ? 'unconfirmed' : status
}

export function isFinanceEligible(status: ParticipantAttendanceStatus | string | null | undefined) {
  return status === 'confirmed'
}

export function countConfirmedParticipants(
  participants: Array<{ attendance_status: ParticipantAttendanceStatus | string | null }>
) {
  return participants.filter(participant => isFinanceEligible(participant.attendance_status)).length
}

export function financeReadiness(input: {
  participants: Array<{ attendance_status: ParticipantAttendanceStatus | string | null }>
  minimumParticipants: number | null
  hasFinalDate: boolean
  paymentsReady: boolean
}) {
  const confirmedCount = countConfirmedParticipants(input.participants)
  const minimumReached = !input.minimumParticipants || confirmedCount >= input.minimumParticipants
  return {
    confirmedCount,
    minimumReached,
    ready: input.hasFinalDate && minimumReached && input.paymentsReady,
  }
}

export function canLateConfirm(input: {
  attendanceStatus: ParticipantAttendanceStatus
  confirmedCount: number
  maxParticipants: number | null
}) {
  if (input.attendanceStatus === 'confirmed') return false
  return !input.maxParticipants || input.confirmedCount < input.maxParticipants
}

export async function reenterViaLateJoinFlow<T>(
  input: {
    attendanceStatus: ParticipantAttendanceStatus
    confirmedCount: number
    maxParticipants: number | null
  },
  existingLateJoinFlow: () => Promise<T>
) {
  if (!canLateConfirm(input)) throw new Error('Project capacity has been reached')
  return existingLateJoinFlow()
}

export function buildSelectionOutcome(input: {
  option: DateOptionLike
  participantUserIds: string[]
  responses: DateResponseLike[]
}) {
  const byUser = new Map(
    input.responses
      .filter(response => response.date_option_id === input.option.id)
      .map(response => [response.user_id, response.availability] as const)
  )
  return {
    dateMode: 'fixed' as const,
    selectedDateOptionId: input.option.id,
    eventStartAt: input.option.starts_at,
    eventEndAt: input.option.ends_at,
    attendanceByUserId: Object.fromEntries(
      input.participantUserIds.map(userId => [userId, attendanceAfterSelection(byUser.get(userId))])
    ),
    confirmationTaskUserIds: input.participantUserIds.filter(
      userId => attendanceAfterSelection(byUser.get(userId)) === 'awaiting_confirmation'
    ),
  }
}
