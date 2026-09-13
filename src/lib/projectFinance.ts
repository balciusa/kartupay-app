export const PROJECT_FINANCE_MODES = ['none', 'managed'] as const

export type ProjectFinanceMode = (typeof PROJECT_FINANCE_MODES)[number]

export const FINANCE_DISABLED_ERROR = 'Financial management is not enabled for this project'
export const FINANCE_HISTORY_ERROR =
  'Financial management cannot be disabled because this project already has financial activity.'

export type FinancialActivitySummary = {
  commitments?: number
  payments?: number
  paymentSignals?: number
  extraPayments?: number
  lateJoinTransfers?: number
  refunds?: number
  balances?: number
  payouts?: number
  ledgerEntries?: number
}

export function normalizeProjectFinanceMode(value: unknown): ProjectFinanceMode {
  return value === 'none' ? 'none' : 'managed'
}

export function isManagedFinance(value: unknown): boolean {
  return normalizeProjectFinanceMode(value) === 'managed'
}

export function assertManagedFinance(value: unknown): asserts value is 'managed' {
  if (!isManagedFinance(value)) throw new Error(FINANCE_DISABLED_ERROR)
}

export function getProjectJoinStrategy(value: unknown): 'direct_membership' | 'approval_request' {
  return isManagedFinance(value) ? 'approval_request' : 'direct_membership'
}

export function hasMeaningfulFinancialActivity(summary: FinancialActivitySummary): boolean {
  return Object.values(summary).some(value => Number(value ?? 0) > 0)
}

export function assertFinanceModeTransition(
  from: unknown,
  to: unknown,
  activity: FinancialActivitySummary = {}
): ProjectFinanceMode {
  const currentMode = normalizeProjectFinanceMode(from)
  if (!PROJECT_FINANCE_MODES.includes(to as ProjectFinanceMode)) {
    throw new Error('Invalid shared cost management option')
  }
  const nextMode = to as ProjectFinanceMode
  if (currentMode === 'managed' && nextMode === 'none' && hasMeaningfulFinancialActivity(activity)) {
    throw new Error(FINANCE_HISTORY_ERROR)
  }
  return nextMode
}

export function getProjectReadiness(input: {
  financeMode: unknown
  confirmedParticipants: number
  minParticipants: number | null | undefined
  managedFinanceReady: boolean
}) {
  const minimum = Math.max(0, Number(input.minParticipants ?? 0))
  const confirmedParticipants = Math.max(0, Number(input.confirmedParticipants ?? 0))
  const participationReady = minimum === 0 || confirmedParticipants >= minimum
  const financeReady = isManagedFinance(input.financeMode) ? input.managedFinanceReady : true
  return {
    participationReady,
    financeReady,
    projectReady: participationReady && financeReady,
    confirmedParticipants,
    remainingParticipants: Math.max(0, minimum - confirmedParticipants),
  }
}

export function validateProjectFinanceInput(input: {
  financeMode: unknown
  totalEur?: string | null
  totalIsPerPerson?: boolean
  bundleSize?: string | number | null
  bundlePayFor?: string | number | null
}) {
  const financeMode = normalizeProjectFinanceMode(input.financeMode)
  if (financeMode === 'none') {
    return {
      financeMode,
      totalCents: 0,
      totalIsPerPerson: false,
      bundleSize: null,
      bundlePayFor: null,
    } as const
  }

  const normalizedAmount = String(input.totalEur ?? '').replace(',', '.').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalizedAmount)) {
    throw new Error('Invalid total amount')
  }
  const amount = Number(normalizedAmount)
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid total amount')

  return {
    financeMode,
    totalCents: Math.round(amount * 100),
    totalIsPerPerson: !!input.totalIsPerPerson,
    bundleSize: input.bundleSize ?? null,
    bundlePayFor: input.bundlePayFor ?? null,
  }
}

export function getFinanceCapabilities(financeMode: unknown) {
  const managed = isManagedFinance(financeMode)
  return {
    showPaymentsTab: managed,
    showFinancialOverview: managed,
    showPaymentActions: managed,
    createFinanceNotifications: managed,
    extraUsesFinance: managed,
  }
}

export function getExtraPresentation(financeMode: unknown, viewerJoined: boolean) {
  const managed = isManagedFinance(financeMode)
  return {
    showAmount: managed,
    showCollector: managed,
    showPaymentActions: managed,
    primaryAction: viewerJoined ? (managed ? 'leave' : 'not_interested') : 'join',
  } as const
}

export function normalizeExtraFinanceInput(input: {
  financeMode: unknown
  amountCents?: number | null
  amountIsPerPerson?: boolean
  collectionMode?: 'project_collector' | 'dedicated_collector'
  dedicatedCollectorParticipantId?: string | null
}) {
  if (!isManagedFinance(input.financeMode)) {
    return {
      amountCents: 0,
      amountIsPerPerson: false,
      collectionMode: 'project_collector' as const,
      dedicatedCollectorParticipantId: null,
    }
  }
  const amountCents = Number(input.amountCents ?? 0)
  if (!Number.isFinite(amountCents) || amountCents < 0) throw new Error('Invalid extra amount')
  const collectionMode = input.collectionMode ?? 'project_collector'
  return {
    amountCents: Math.round(amountCents),
    amountIsPerPerson: !!input.amountIsPerPerson,
    collectionMode,
    dedicatedCollectorParticipantId:
      collectionMode === 'dedicated_collector' ? input.dedicatedCollectorParticipantId ?? null : null,
  }
}
