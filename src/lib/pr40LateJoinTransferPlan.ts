import {
  calculatePr40LateJoinDifference,
  type Pr40LateJoinDifference,
} from './pr40LateJoinPricing.ts'
import type { ProjectPricingInput } from './projectPricing.ts'

export type Pr40ExistingParticipant = {
  id: string
  active: boolean
  confirmed: boolean
  joinedAt: string | null
  countedPayment: boolean
}

export type Pr40TransferRow = {
  fromParticipantId: string
  toParticipantId: string
  expectedCents: number
}

export type Pr40LateJoinPlanInput = {
  newcomerId: string
  newcomerJoinedAt: string | null
  participants: Pr40ExistingParticipant[]
  finalizedAt: string | null
  status: string
  collectorId: string | null
  organizerFallbackId: string | null
  pricing: Omit<ProjectPricingInput, 'participantCount'>
}

export type Pr40LateJoinPlan = {
  reason: 'not_collecting_or_finalized' | 'no_prior_participants' |
    'no_recipients' | 'no_share_change' | 'collector_not_found' | 'ready'
  priorParticipantCount: number
  recipientCount: number
  pricing: Pr40LateJoinDifference | null
  rows: Pr40TransferRow[]
}

const parseBoundary = (value: string | null) => {
  if (!value) return null
  const valueMs = Date.parse(value)
  return Number.isFinite(valueMs) ? valueMs : null
}

/**
 * Pure, never-writes plan matching runLateJoinTransferUpsert's
 * recipient/window, denominator, direction, and pricing semantics.
 * No runtime consumers until golden parity and independent DB tests PASS.
 */
export function planPr40LateJoinTransfers(input: Pr40LateJoinPlanInput): Pr40LateJoinPlan {
  const status = input.status.trim().toLowerCase()
  const finalized = input.finalizedAt !== null || status === 'closed'
  const collecting = status === 'collecting'
  const empty = (
    reason: Pr40LateJoinPlan['reason'],
    count = 0,
    recipients = 0,
    pricing: Pr40LateJoinDifference | null = null
  ): Pr40LateJoinPlan => ({
    reason,
    priorParticipantCount: count,
    recipientCount: recipients,
    pricing,
    rows: [],
  })
  if (!finalized && !collecting) return empty('not_collecting_or_finalized')

  const boundaryMs = parseBoundary(finalized ? input.finalizedAt : input.newcomerJoinedAt)
  const prior = input.participants.filter(p => {
    if (p.id === input.newcomerId || !p.active || !p.confirmed) return false
    const joinedMs = parseBoundary(p.joinedAt)
    return boundaryMs === null || joinedMs === null || joinedMs <= boundaryMs
  })
  if (prior.length === 0) return empty('no_prior_participants')

  // Collecting must count every prior confirmed member in denominator,
  // but recipients are only those whose payment is counted.
  const recipients = finalized ? prior : prior.filter(p => p.countedPayment)
  if (recipients.length === 0) return empty('no_recipients', prior.length)

  const pricing = calculatePr40LateJoinDifference(input.pricing, prior.length)
  if (pricing.perPersonCents === 0) return empty('no_share_change', prior.length, recipients.length, pricing)

  let rows: Pr40TransferRow[]
  if (pricing.direction === 'newcomer_to_recipients') {
    rows = recipients.map(p => ({
      fromParticipantId: input.newcomerId,
      toParticipantId: p.id,
      expectedCents: pricing.perPersonCents,
    }))
  } else {
    // Caller must resolve an active collector, or active organizer fallback
    // before passing either identifier. This helper never grants permissions.
    const collector = input.collectorId ?? input.organizerFallbackId
    if (!collector) return empty('collector_not_found', prior.length, recipients.length, pricing)
    rows = recipients.filter(p => p.id !== collector).map(p => ({
      fromParticipantId: p.id,
      toParticipantId: collector,
      expectedCents: pricing.perPersonCents,
    }))
  }
  return {
    reason: 'ready',
    priorParticipantCount: prior.length,
    recipientCount: recipients.length,
    pricing,
    rows,
  }
}
