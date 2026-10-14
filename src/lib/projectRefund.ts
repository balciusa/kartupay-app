export type ConfirmedExtraPayment = {
  collectorParticipantId: string | null
  amountCents: number
  confirmed: boolean
}

export type ConfirmedBasePayment = {
  collectorParticipantId: string | null
  amountCents: number | null
}

export type ConfirmedLateTransfer = {
  toParticipantId: string | null
  amountCents: number
  received: boolean
}

export type RefundObligation = {
  collectorParticipantId: string
  baseAmountCents: number
  extrasAmountCents: number
  lateTransferAmountCents: number
  totalAmountCents: number
}

export type RefundRequestSnapshot = RefundObligation & {
  status: string
}

const safeCents = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0
}

export function buildRefundObligations({
  participantId,
  basePayments,
  extraPayments,
  lateTransfers,
}: {
  participantId: string
  basePayments: ConfirmedBasePayment[]
  extraPayments: ConfirmedExtraPayment[]
  lateTransfers: ConfirmedLateTransfer[]
}): RefundObligation[] {
  const byCollector = new Map<string, Omit<RefundObligation, 'collectorParticipantId' | 'totalAmountCents'>>()
  const get = (collectorParticipantId: string) => {
    const existing = byCollector.get(collectorParticipantId)
    if (existing) return existing
    const created = { baseAmountCents: 0, extrasAmountCents: 0, lateTransferAmountCents: 0 }
    byCollector.set(collectorParticipantId, created)
    return created
  }

  for (const payment of basePayments) {
    const collectorId = payment.collectorParticipantId
    const amount = payment.amountCents === null ? 0 : safeCents(payment.amountCents)
    if (!collectorId || collectorId === participantId || amount <= 0) continue
    get(collectorId).baseAmountCents += amount
  }

  for (const payment of extraPayments) {
    const collectorId = payment.collectorParticipantId
    const amount = safeCents(payment.amountCents)
    if (!payment.confirmed || !collectorId || collectorId === participantId || amount <= 0) continue
    get(collectorId).extrasAmountCents += amount
  }

  for (const transfer of lateTransfers) {
    const collectorId = transfer.toParticipantId
    const amount = safeCents(transfer.amountCents)
    if (!transfer.received || !collectorId || collectorId === participantId || amount <= 0) continue
    get(collectorId).lateTransferAmountCents += amount
  }

  return [...byCollector.entries()]
    .map(([collectorParticipantId, amounts]) => ({
      collectorParticipantId,
      ...amounts,
      totalAmountCents:
        amounts.baseAmountCents + amounts.extrasAmountCents + amounts.lateTransferAmountCents,
    }))
    .filter(obligation => obligation.totalAmountCents > 0)
    .sort((left, right) => left.collectorParticipantId.localeCompare(right.collectorParticipantId))
}

const REFUND_COVERAGE_STATUSES = new Set(['pending', 'approved', 'sent', 'completed'])

export function buildLegacyBasePaymentSnapshots(
  participantId: string,
  requests: RefundRequestSnapshot[]
): ConfirmedBasePayment[] {
  const snapshots = requests
    .filter(request => REFUND_COVERAGE_STATUSES.has(request.status))
    .filter(request => request.baseAmountCents > 0)
    .map(request => ({
      collectorParticipantId:
        request.collectorParticipantId === participantId ? null : request.collectorParticipantId,
      amountCents: safeCents(request.baseAmountCents),
    }))
  if (snapshots.length > 1) {
    throw new Error('Legacy refund history contains duplicate base payment amounts and requires organizer review')
  }
  return snapshots
}

export function outstandingRefundObligations(
  obligations: RefundObligation[],
  requests: RefundRequestSnapshot[],
  coveredStatuses: ReadonlySet<string> = new Set(['completed'])
) {
  const coveredByCollector = new Map<string, Omit<RefundObligation, 'collectorParticipantId' | 'totalAmountCents'>>()
  for (const request of requests) {
    if (!coveredStatuses.has(request.status)) continue
    if (
      safeCents(request.totalAmountCents)
      !== safeCents(request.baseAmountCents)
        + safeCents(request.extrasAmountCents)
        + safeCents(request.lateTransferAmountCents)
    ) {
      throw new Error('Refund history total does not match its components')
    }
    const covered = coveredByCollector.get(request.collectorParticipantId) ?? {
      baseAmountCents: 0,
      extrasAmountCents: 0,
      lateTransferAmountCents: 0,
    }
    covered.baseAmountCents += safeCents(request.baseAmountCents)
    covered.extrasAmountCents += safeCents(request.extrasAmountCents)
    covered.lateTransferAmountCents += safeCents(request.lateTransferAmountCents)
    coveredByCollector.set(request.collectorParticipantId, covered)
  }

  const outstanding = obligations.map(obligation => {
    const covered = coveredByCollector.get(obligation.collectorParticipantId) ?? {
      baseAmountCents: 0,
      extrasAmountCents: 0,
      lateTransferAmountCents: 0,
    }
    if (
      covered.baseAmountCents > obligation.baseAmountCents
      || covered.extrasAmountCents > obligation.extrasAmountCents
      || covered.lateTransferAmountCents > obligation.lateTransferAmountCents
    ) {
      throw new Error('Refund history exceeds confirmed payment history')
    }
    const baseAmountCents = obligation.baseAmountCents - covered.baseAmountCents
    const extrasAmountCents = obligation.extrasAmountCents - covered.extrasAmountCents
    const lateTransferAmountCents = obligation.lateTransferAmountCents - covered.lateTransferAmountCents
    return {
      collectorParticipantId: obligation.collectorParticipantId,
      baseAmountCents,
      extrasAmountCents,
      lateTransferAmountCents,
      totalAmountCents: baseAmountCents + extrasAmountCents + lateTransferAmountCents,
    }
  }).filter(obligation => obligation.totalAmountCents > 0)

  for (const [collectorParticipantId, covered] of coveredByCollector) {
    if (
      !obligations.some(obligation => obligation.collectorParticipantId === collectorParticipantId)
      && (covered.baseAmountCents > 0 || covered.extrasAmountCents > 0 || covered.lateTransferAmountCents > 0)
    ) {
      throw new Error('Refund history has no matching confirmed payment recipient')
    }
  }

  return outstanding
}

export function refundObligationsCompleted(
  obligations: RefundObligation[],
  requests: RefundRequestSnapshot[]
) {
  return outstandingRefundObligations(obligations, requests).length === 0
}
