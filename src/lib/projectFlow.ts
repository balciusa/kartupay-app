export type ProjectFlowStepKey = 'planning' | 'payments_open' | 'locked'

export type ProjectFlowStep = {
  key: ProjectFlowStepKey
  label: string
  description: string
}

export type ProjectFlowState =
  | {
      kind: 'active'
      currentStepKey: ProjectFlowStepKey
      currentIndex: number
      steps: ProjectFlowStep[]
    }
  | {
      kind: 'canceled'
      steps: ProjectFlowStep[]
    }

export const PROJECT_FLOW_STEPS: ProjectFlowStep[] = [
  {
    key: 'planning',
    label: 'Pending',
    description: 'Gather participants and finalize details before collection starts.',
  },
  {
    key: 'payments_open',
    label: 'Collecting',
    description: 'Members can start paying and late joins may still trigger rebalancing.',
  },
  {
    key: 'locked',
    label: 'Locked',
    description: 'Base shares are frozen and the participant list is treated as final.',
  },
]

export function getProjectFlowState(input: {
  status: string | null | undefined
  isCanceled: boolean
  isFinalized: boolean
}): ProjectFlowState {
  if (input.isCanceled) {
    return {
      kind: 'canceled',
      steps: PROJECT_FLOW_STEPS,
    }
  }

  const normalizedStatus = String(input.status ?? '').trim().toLowerCase()
  const currentStepKey: ProjectFlowStepKey =
    input.isFinalized || normalizedStatus === 'closed'
      ? 'locked'
      : normalizedStatus === 'collecting'
        ? 'payments_open'
        : 'planning'

  return {
    kind: 'active',
    currentStepKey,
    currentIndex: PROJECT_FLOW_STEPS.findIndex(step => step.key === currentStepKey),
    steps: PROJECT_FLOW_STEPS,
  }
}
