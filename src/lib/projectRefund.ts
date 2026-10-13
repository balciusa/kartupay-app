export type ConfirmedExtraPayment = {
  collectorParticipantId: string | null
  amountCents: number
  confirmed: boolean
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
  projectCollectorParticipantId,
  baseAmountCents,
  extraPayments,
  lateTransfers,
}: {
  participantId: string
  projectCollectorParticipantId: string | null
  baseAmountCents: number
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

  const base = safeCents(baseAmountCents)
  if (base > 0 && projectCollectorParticipantId && projectCollectorParticipantId !== participantId) {
    get(projectCollectorParticipantId).baseAmountCents += base
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

export function refundObligationsCompleted(
  obligations: RefundObligation[],
  requests: RefundRequestSnapshot[]
) {
  return obligations.every(obligation => requests.some(request =>
    request.collectorParticipantId === obligation.collectorParticipantId
    && request.status === 'completed'
    && request.baseAmountCents === obligation.baseAmountCents
    && request.extrasAmountCents === obligation.extrasAmountCents
    && request.lateTransferAmountCents === obligation.lateTransferAmountCents
    && request.totalAmountCents === obligation.totalAmountCents
  ))
}
