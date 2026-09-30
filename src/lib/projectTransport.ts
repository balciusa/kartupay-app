export const TRANSPORT_DIRECTIONS = ['to_event', 'from_event'] as const
export const TRANSPORT_INTENTS = ['needs_ride', 'own_arrangement'] as const

export type TransportDirection = (typeof TRANSPORT_DIRECTIONS)[number]
export type TransportIntent = (typeof TRANSPORT_INTENTS)[number]

export const canViewProjectTransport = (input: {
  transportEnabled: boolean
  isAuthenticated: boolean
  isActiveParticipant: boolean
}) => input.transportEnabled && input.isAuthenticated && input.isActiveParticipant

export const formatTransportDeparture = (departureAt: string, locale: 'en' | 'lt') =>
  new Intl.DateTimeFormat(locale === 'lt' ? 'lt-LT' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(departureAt))

export type TransportParticipantState =
  | 'driver'
  | 'passenger'
  | 'needs_ride'
  | 'own_arrangement'
  | 'not_decided'

export type TransportParticipant = {
  id: string
  name: string
  attendanceStatus: string | null
}

export type TransportAssignment = {
  id: string
  projectId: string
  direction: TransportDirection
  offerId: string
  participantId: string
  joinedAt: string
}

export type TransportOffer = {
  id: string
  projectId: string
  direction: TransportDirection
  driverParticipantId: string
  locationText: string
  departureAt: string
  seatCapacity: number
  note: string | null
  createdAt: string
  assignments: TransportAssignment[]
}

export type TransportIntentRow = {
  participantId: string
  direction: TransportDirection
  intent: TransportIntent
}

export type TransportParticipantStatus = {
  participantId: string
  name: string
  state: TransportParticipantState
  offerId: string | null
  assignmentId: string | null
}

export type TransportSummary = {
  drivers: number
  passengers: number
  availableSeats: number
  needsRide: number
  ownArrangement: number
  notDecided: number
}

export type ProjectTransportSnapshot = {
  projectId: string
  locale: 'en' | 'lt'
  enabled: boolean
  planningReady: boolean
  projectCanceled: boolean
  eventLocation: string | null
  eventStartAt: string | null
  eventEndAt: string | null
  viewerParticipantId: string
  participants: TransportParticipant[]
  offers: TransportOffer[]
  intents: TransportIntentRow[]
}

export const isTransportDirection = (value: unknown): value is TransportDirection =>
  typeof value === 'string' && (TRANSPORT_DIRECTIONS as readonly string[]).includes(value)

export const isTransportIntent = (value: unknown): value is TransportIntent =>
  typeof value === 'string' && (TRANSPORT_INTENTS as readonly string[]).includes(value)

export const isTransportEligibleAttendance = (status: string | null | undefined) =>
  status !== 'cannot_attend' && status !== 'observer'

export function remainingTransportSeats(offer: Pick<TransportOffer, 'seatCapacity' | 'assignments'>) {
  return Math.max(0, offer.seatCapacity - offer.assignments.length)
}

export function deriveTransportStatuses(input: {
  participants: TransportParticipant[]
  offers: TransportOffer[]
  intents: TransportIntentRow[]
  direction: TransportDirection
}): TransportParticipantStatus[] {
  const eligibleParticipants = input.participants.filter(participant =>
    isTransportEligibleAttendance(participant.attendanceStatus)
  )
  const offers = input.offers.filter(offer => offer.direction === input.direction)
  const offerByDriver = new Map(offers.map(offer => [offer.driverParticipantId, offer]))
  const assignmentByParticipant = new Map(
    offers.flatMap(offer => offer.assignments).map(assignment => [assignment.participantId, assignment])
  )
  const intentByParticipant = new Map(
    input.intents
      .filter(intent => intent.direction === input.direction)
      .map(intent => [intent.participantId, intent.intent])
  )

  return eligibleParticipants.map(participant => {
    const ownOffer = offerByDriver.get(participant.id)
    if (ownOffer) {
      return {
        participantId: participant.id,
        name: participant.name,
        state: 'driver' as const,
        offerId: ownOffer.id,
        assignmentId: null,
      }
    }
    const assignment = assignmentByParticipant.get(participant.id)
    if (assignment) {
      return {
        participantId: participant.id,
        name: participant.name,
        state: 'passenger' as const,
        offerId: assignment.offerId,
        assignmentId: assignment.id,
      }
    }
    const intent = intentByParticipant.get(participant.id)
    return {
      participantId: participant.id,
      name: participant.name,
      state: intent ?? 'not_decided',
      offerId: null,
      assignmentId: null,
    }
  })
}

export function summarizeTransport(input: {
  statuses: TransportParticipantStatus[]
  offers: TransportOffer[]
  direction: TransportDirection
}): TransportSummary {
  const offers = input.offers.filter(offer => offer.direction === input.direction)
  return {
    drivers: input.statuses.filter(status => status.state === 'driver').length,
    passengers: input.statuses.filter(status => status.state === 'passenger').length,
    availableSeats: offers.reduce((sum, offer) => sum + remainingTransportSeats(offer), 0),
    needsRide: input.statuses.filter(status => status.state === 'needs_ride').length,
    ownArrangement: input.statuses.filter(status => status.state === 'own_arrangement').length,
    notDecided: input.statuses.filter(status => status.state === 'not_decided').length,
  }
}

export function sortTransportOffers(offers: TransportOffer[]) {
  return [...offers].sort((left, right) => {
    const departureDifference = new Date(left.departureAt).getTime() - new Date(right.departureAt).getTime()
    if (departureDifference !== 0) return departureDifference
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  })
}

type TransportDepartureParts = {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
}

export class TransportDepartureTimeError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'nonexistent_local_time'
  ) {
    super(message)
    this.name = 'TransportDepartureTimeError'
  }
}

const parseTransportDepartureParts = (localValue: string): TransportDepartureParts => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue.trim())
  if (!match) throw new TransportDepartureTimeError('Choose a departure date and time', 'invalid')
  const [, year, month, day, hours, minutes] = match
  const parts = {
    year: Number(year), month: Number(month), day: Number(day),
    hours: Number(hours), minutes: Number(minutes),
  }
  const wallTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes)
  const wallDate = new Date(wallTime)
  if (
    wallDate.getUTCFullYear() !== parts.year || wallDate.getUTCMonth() !== parts.month - 1 ||
    wallDate.getUTCDate() !== parts.day || wallDate.getUTCHours() !== parts.hours ||
    wallDate.getUTCMinutes() !== parts.minutes
  ) throw new TransportDepartureTimeError('Invalid departure date or time', 'invalid')
  return parts
}

const transportDateTimePartsInZone = (date: Date, timeZone: string): TransportDepartureParts => {
  let formattedParts: Intl.DateTimeFormatPart[]
  try {
    formattedParts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date)
  } catch {
    throw new TransportDepartureTimeError('Invalid timezone', 'invalid')
  }
  const values = new Map(formattedParts.map(part => [part.type, part.value]))
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hours: Number(values.get('hour')),
    minutes: Number(values.get('minute')),
  }
}

const sameTransportDepartureParts = (left: TransportDepartureParts, right: TransportDepartureParts) =>
  left.year === right.year && left.month === right.month && left.day === right.day &&
  left.hours === right.hours && left.minutes === right.minutes

export function getTransportDepartureSubmission(localValue: string) {
  const parts = parseTransportDepartureParts(localValue)
  const selected = new Date(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes, 0, 0)
  const selectedParts = {
    year: selected.getFullYear(), month: selected.getMonth() + 1, day: selected.getDate(),
    hours: selected.getHours(), minutes: selected.getMinutes(),
  }
  if (!sameTransportDepartureParts(parts, selectedParts)) {
    throw new TransportDepartureTimeError(
      'This departure time does not exist because of a daylight-saving time change. Choose another time.',
      'nonexistent_local_time'
    )
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const timezoneOffsetMinutes = selected.getTimezoneOffset()
  if (!timeZone || !Number.isInteger(timezoneOffsetMinutes)) {
    throw new TransportDepartureTimeError('Invalid timezone', 'invalid')
  }
  return { timezoneOffsetMinutes, timeZone }
}

export function parseTransportDeparture(
  localValue: string,
  timezoneOffsetMinutes: number,
  timeZone: string
) {
  const parts = parseTransportDepartureParts(localValue)
  if (!Number.isInteger(timezoneOffsetMinutes) || timezoneOffsetMinutes < -840 || timezoneOffsetMinutes > 840) {
    throw new TransportDepartureTimeError('Invalid timezone', 'invalid')
  }
  if (!timeZone || timeZone.length > 100) {
    throw new TransportDepartureTimeError('Invalid timezone', 'invalid')
  }
  const wallTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes)
  const timestamp = wallTime + timezoneOffsetMinutes * 60 * 1000
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    throw new TransportDepartureTimeError('Invalid departure date or time', 'invalid')
  }
  const zonedParts = transportDateTimePartsInZone(date, timeZone)
  if (!sameTransportDepartureParts(parts, zonedParts)) {
    throw new TransportDepartureTimeError(
      'This departure time does not exist or does not match the submitted timezone. Choose another time.',
      'nonexistent_local_time'
    )
  }
  const zonedWallTime = Date.UTC(
    zonedParts.year, zonedParts.month - 1, zonedParts.day, zonedParts.hours, zonedParts.minutes
  )
  const zonedOffsetMinutes = (date.getTime() - zonedWallTime) / (60 * 1000)
  if (zonedOffsetMinutes !== timezoneOffsetMinutes) {
    throw new TransportDepartureTimeError('Invalid timezone offset for departure time', 'invalid')
  }
  return date.toISOString()
}
