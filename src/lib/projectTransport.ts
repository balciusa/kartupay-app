export const TRANSPORT_DIRECTIONS = ['to_event', 'from_event'] as const
export const TRANSPORT_INTENTS = ['needs_ride', 'own_arrangement'] as const

export type TransportDirection = (typeof TRANSPORT_DIRECTIONS)[number]
export type TransportIntent = (typeof TRANSPORT_INTENTS)[number]
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

export function parseTransportDeparture(localValue: string, timezoneOffsetMinutes: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue.trim())
  if (!match) throw new Error('Choose a departure date and time')
  if (!Number.isFinite(timezoneOffsetMinutes) || timezoneOffsetMinutes < -840 || timezoneOffsetMinutes > 840) {
    throw new Error('Invalid timezone')
  }
  const [, year, month, day, hours, minutes] = match
  const wallTime = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes))
  const wallDate = new Date(wallTime)
  if (
    wallDate.getUTCFullYear() !== Number(year) || wallDate.getUTCMonth() !== Number(month) - 1 ||
    wallDate.getUTCDate() !== Number(day) || wallDate.getUTCHours() !== Number(hours) ||
    wallDate.getUTCMinutes() !== Number(minutes)
  ) throw new Error('Invalid departure date or time')
  const timestamp = wallTime + timezoneOffsetMinutes * 60 * 1000
  const date = new Date(timestamp)
  if (
    Number.isNaN(date.getTime()) || Number(month) < 1 || Number(month) > 12 ||
    Number(day) < 1 || Number(day) > 31 || Number(hours) > 23 || Number(minutes) > 59
  ) {
    throw new Error('Invalid departure date or time')
  }
  return date.toISOString()
}
