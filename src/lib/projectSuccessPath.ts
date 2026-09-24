import { getProjectReadiness, isManagedFinance } from './projectFinance.ts'

export type SuccessStage = 'date' | 'participants' | 'finance' | 'ready'
export type SuccessAction = 'choose_dates' | 'confirm_attendance' | 'resolve_date' | 'invite_people' | 'review_finance' | 'review_payment'
export type SuccessContext = {
  isCanceled: boolean
  isFinalized: boolean
  financeMode: unknown
  confirmedParticipants: number
  minParticipants?: number | null
  capacityAvailable: boolean
  joinsAllowed: boolean
  managedFinanceReady: boolean
  date: {
    selecting: boolean
    votingOpen: boolean
    hasOptions: boolean
    awaitingOrganizer: boolean
    viewerResponded: boolean
    viewerNeedsConfirmation: boolean
    missingResponses: number
    awaitingAttendance: number
  }
}
export type SuccessViewer = {
  isParticipant: boolean
  canManage: boolean
  canPay: boolean
}
export type ProjectSuccessPath = {
  stage: SuccessStage | 'canceled' | 'finalized'
  health: 'on_track' | 'needs_attention' | 'blocked' | 'ready' | 'canceled' | 'finalized'
  visibleStages: Array<{ id: SuccessStage; state: 'complete' | 'current' | 'upcoming' }>
  blockers: Array<{ type: 'date' | 'date_tie' | 'participants' | 'finance'; count?: number }>
  nextAction: SuccessAction | null
  waitingOn: { dates: number; attendance: number; participants: number }
  ready: boolean
  confirmedParticipants: number
  minimum: number
}

/** Facts come from the existing page/Date Finder. No I/O, clocks, or persisted workflow. */
export function deriveProjectSuccessPath(context: SuccessContext, viewer: SuccessViewer): ProjectSuccessPath {
  const readiness = getProjectReadiness({
    financeMode: context.financeMode,
    confirmedParticipants: context.confirmedParticipants,
    minParticipants: context.minParticipants,
    managedFinanceReady: context.managedFinanceReady,
  })
  const base = {
    confirmedParticipants: readiness.confirmedParticipants,
    minimum: Math.max(0, Number(context.minParticipants ?? 0)),
  }
  // Finalized freezes base contributions; it is deliberately NOT called event completion.
  if (context.isCanceled || context.isFinalized) {
    const terminal = context.isCanceled ? 'canceled' : 'finalized'
    return { ...base, stage: terminal, health: terminal, visibleStages: [], blockers: [], nextAction: null,
      waitingOn: { dates: 0, attendance: 0, participants: 0 }, ready: false }
  }

  const dateReady = !context.date.selecting
  const ready = dateReady && readiness.projectReady
  const blockers: ProjectSuccessPath['blockers'] = []
  if (!dateReady) blockers.push({ type: context.date.awaitingOrganizer ? 'date_tie' : 'date' })
  if (!readiness.participationReady) blockers.push({ type: 'participants', count: readiness.remainingParticipants })
  if (!readiness.financeReady) blockers.push({ type: 'finance' })

  const gates: Array<{ id: SuccessStage; complete: boolean }> = [
    { id: 'date', complete: dateReady },
    { id: 'participants', complete: readiness.participationReady },
    ...(isManagedFinance(context.financeMode) ? [{ id: 'finance' as const, complete: readiness.financeReady }] : []),
    { id: 'ready', complete: ready },
  ]
  const stage = gates.find(gate => !gate.complete)?.id ?? 'ready'
  const visibleStages = gates.map(gate => ({ id: gate.id,
    state: gate.complete ? 'complete' as const : gate.id === stage ? 'current' as const : 'upcoming' as const }))

  let nextAction: SuccessAction | null = null
  if (viewer.isParticipant && context.date.votingOpen && context.date.hasOptions && !context.date.viewerResponded) {
    nextAction = 'choose_dates'
  } else if (viewer.isParticipant && dateReady && context.date.viewerNeedsConfirmation) {
    nextAction = 'confirm_attendance'
  } else if (!dateReady && context.date.awaitingOrganizer && viewer.canManage) {
    nextAction = 'resolve_date'
  } else if (dateReady && !readiness.participationReady && viewer.canManage && context.capacityAvailable && context.joinsAllowed) {
    nextAction = 'invite_people'
  } else if (!readiness.financeReady && dateReady && readiness.participationReady) {
    if (viewer.canPay) nextAction = 'review_payment'
    else if (viewer.canManage) nextAction = 'review_finance'
  }

  return { ...base, stage, visibleStages, blockers, nextAction, ready,
    health: context.date.awaitingOrganizer || (dateReady && !readiness.participationReady
      && !context.capacityAvailable && context.date.awaitingAttendance === 0)
      ? 'blocked' : nextAction ? 'needs_attention' : ready ? 'ready' : 'on_track',
    waitingOn: {
      dates: context.date.selecting && context.date.votingOpen ? Math.max(0, context.date.missingResponses) : 0,
      attendance: dateReady ? Math.max(0, context.date.awaitingAttendance) : 0,
      participants: readiness.remainingParticipants,
    },
  }
}
