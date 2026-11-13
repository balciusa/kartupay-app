import { calculateProjectPricing, type ProjectPricingInput } from './projectPricing.ts'

export type Pr40LateJoinDifference = {
  priorShareCents: number
  nextShareCents: number
  perPersonCents: number
  direction: 'newcomer_to_recipients' | 'existing_to_collector' | 'none'
}

/**
 * Parity-oriented pure computation of the CURRENT late-join pricing delta.
 * No participant eligibility, collector resolution, SQL writes, or retries.
 * This is a test seam, NOT a replacement for runLateJoinTransferUpsert.
 */
export function calculatePr40LateJoinDifference(
  pricing: Omit<ProjectPricingInput, 'participantCount'>,
  participantsBeforeJoin: number
): Pr40LateJoinDifference {
  const priorShareCents = calculateProjectPricing({
    ...pricing,
    participantCount: participantsBeforeJoin,
  }).perPersonCents
  const nextShareCents = calculateProjectPricing({
    ...pricing,
    participantCount: participantsBeforeJoin + 1,
  }).perPersonCents
  const perPersonCents = Math.abs(priorShareCents - nextShareCents)
  return {
    priorShareCents,
    nextShareCents,
    perPersonCents,
    direction: perPersonCents === 0
      ? 'none'
      : priorShareCents >= nextShareCents
        ? 'newcomer_to_recipients'
        : 'existing_to_collector',
  }
}
