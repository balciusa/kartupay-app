export const MIN_EVENT_DURATION_NIGHTS = 0
export const MAX_EVENT_DURATION_NIGHTS = 365

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const VOTING_DEADLINE_TIME_UTC = '23:59:00.000Z'
const VOTING_DEADLINE_MIN_LEAD_MS = 24 * 60 * 60 * 1000

const parseCalendarDate = (value: string, errorMessage: string) => {
  const dateKey = value.trim()
  if (!DATE_ONLY_PATTERN.test(dateKey)) throw new Error(errorMessage)
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.toISOString().slice(0, 10) !== dateKey) throw new Error(errorMessage)
  return date
}

const parseDateOnly = (value: string) => parseCalendarDate(value, 'Invalid event start date')

export const DATE_OPTION_AFTER_DEADLINE_ERROR = 'Date option must start after voting deadline date'

/** Returns the UTC calendar date carried by a stored timestamp. */
export function calendarDateKeyFromTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid voting deadline')
  return date.toISOString().slice(0, 10)
}

/**
 * Voting deadline date inputs represent 23:59 UTC on the selected date.
 * Production stores these values as timestamptz and deadline calendar rules
 * read their UTC date, so this explicit convention is identical in browsers
 * and server runtimes regardless of their local timezone.
 */
export function votingDeadlineTimestampUtc(votingDeadlineDate: string) {
  const dateKey = parseCalendarDate(votingDeadlineDate, 'Invalid voting deadline')
    .toISOString()
    .slice(0, 10)
  return `${dateKey}T${VOTING_DEADLINE_TIME_UTC}`
}

export function isVotingDeadlineMoreThan24HoursAway(
  votingDeadlineDate: string,
  now: number | Date = Date.now()
) {
  const nowMs = now instanceof Date ? now.getTime() : now
  if (!Number.isFinite(nowMs)) throw new Error('Invalid validation time')
  return Date.parse(votingDeadlineTimestampUtc(votingDeadlineDate)) > nowMs + VOTING_DEADLINE_MIN_LEAD_MS
}

export function earliestCandidateStartDate(votingDeadlineDate: string) {
  return deriveEndDate(votingDeadlineDate, 1)
}

export function candidateStartsAfterVotingDeadline(startDate: string, votingDeadlineDate: string) {
  const startKey = parseDateOnly(startDate).toISOString().slice(0, 10)
  const deadlineKey = parseDateOnly(votingDeadlineDate).toISOString().slice(0, 10)
  return startKey > deadlineKey
}

export function assertCandidateStartsAfterVotingDeadline(startDate: string, votingDeadlineDate: string) {
  if (!candidateStartsAfterVotingDeadline(startDate, votingDeadlineDate)) {
    throw new Error(DATE_OPTION_AFTER_DEADLINE_ERROR)
  }
}

export function validateEventDurationNights(value: unknown) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  if (!Number.isInteger(parsed)
    || parsed < MIN_EVENT_DURATION_NIGHTS
    || parsed > MAX_EVENT_DURATION_NIGHTS) {
    throw new Error(`Event duration must be a whole number from ${MIN_EVENT_DURATION_NIGHTS} to ${MAX_EVENT_DURATION_NIGHTS}`)
  }
  return parsed
}

/** Adds calendar days in UTC so DST can never change the resulting date. */
export function deriveEndDate(startDate: string, durationNights: number) {
  const duration = validateEventDurationNights(durationNights)
  const end = parseDateOnly(startDate)
  end.setUTCDate(end.getUTCDate() + duration)
  return end.toISOString().slice(0, 10)
}

export function deriveDateOptionFromStart(startDate: string, durationNights: number) {
  const duration = validateEventDurationNights(durationNights)
  const start = parseDateOnly(startDate).toISOString()
  return {
    startsAt: start,
    endsAt: duration === 0 ? null : `${deriveEndDate(startDate, duration)}T00:00:00.000Z`,
  }
}

export function deriveCandidateDateKeys(startDate: string, durationNights: number) {
  const duration = validateEventDurationNights(durationNights)
  const start = parseDateOnly(startDate)
  return Array.from({ length: duration + 1 }, (_, index) => {
    const date = new Date(start.getTime())
    date.setUTCDate(date.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
}

export function lithuanianNightUnit(nights: number) {
  const lastTwo = nights % 100
  if (lastTwo >= 10 && lastTwo <= 20) return 'naktų'
  const last = nights % 10
  if (last === 1) return 'naktis'
  if (last >= 2 && last <= 9) return 'naktys'
  return 'naktų'
}

export function formatNightCount(nights: number, locale: 'en' | 'lt') {
  const duration = validateEventDurationNights(nights)
  if (locale === 'lt') return `${duration} ${lithuanianNightUnit(duration)}`
  return `${duration} ${duration === 1 ? 'night' : 'nights'}`
}

export function formatEventDuration(nights: number, locale: 'en' | 'lt') {
  const duration = validateEventDurationNights(nights)
  if (duration === 0) return locale === 'lt' ? 'Tą pačią dieną' : 'Same day'
  return formatNightCount(duration, locale)
}
