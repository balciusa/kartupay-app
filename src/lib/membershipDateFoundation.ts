import type { DateAvailability } from './projectDateSelection.ts'

export type MembershipSeat = {
  left_at: string | null
}

export type SeatReservationDecision = 'already_active' | 'reserve' | 'full'

export type SelectedDateDecisionRequirement =
  | 'satisfied_by_available_vote'
  | 'decision_required'

/**
 * MASTER v5.3 foundation: an active membership occupies one project seat.
 * Date availability and legacy attendance labels are intentionally not inputs.
 */
export function isActiveMembership(membership: MembershipSeat) {
  return membership.left_at === null
}

export function countOccupiedSeats(memberships: MembershipSeat[]) {
  return memberships.filter(isActiveMembership).length
}

/**
 * Pure decision used by the future project-locked reservation transaction.
 * It does not provide concurrency safety by itself; the caller must hold the
 * project row lock before counting active memberships and applying the result.
 */
export function decideSeatReservation(input: {
  alreadyActive: boolean
  occupiedSeats: number
  maxParticipants: number | null
}): SeatReservationDecision {
  if (input.alreadyActive) return 'already_active'
  if (input.maxParticipants !== null && input.occupiedSeats >= input.maxParticipants) return 'full'
  return 'reserve'
}

/**
 * A selected date needs no follow-up only when the member voted available for
 * that exact option. Maybe, unavailable and a missing response are all explicit
 * exception states; none of them changes membership or financial history here.
 */
export function selectedDateDecisionRequirement(
  availability: DateAvailability | null | undefined
): SelectedDateDecisionRequirement {
  return availability === 'available' ? 'satisfied_by_available_vote' : 'decision_required'
}
