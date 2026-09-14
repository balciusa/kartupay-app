'use client'

import { useState } from 'react'
import { finalizeProject, startCollecting } from '@/app/project/[id]/actions'
import { getProjectFlowState } from '@/lib/projectFlow'
import { getProjectStatusUiKey, projectStatusUi } from '@/lib/projectStatusUi'

type ProjectFlowBarProps = {
  projectId: string
  status: string | null | undefined
  isCanceled: boolean
  isFinalized: boolean
  canManage: boolean
  canStartCollecting: boolean
  canFinalize: boolean
  startCollectingBlockedReason: string | null
  collectorBaseShareLabel: string
}

export function ProjectFlowBar({
  projectId,
  status,
  isCanceled,
  isFinalized,
  canManage,
  canStartCollecting,
  canFinalize,
  startCollectingBlockedReason,
  collectorBaseShareLabel,
}: ProjectFlowBarProps) {
  const [startCollectingOpen, setStartCollectingOpen] = useState(false)
  const flow = getProjectFlowState({
    status,
    isCanceled,
    isFinalized,
  })
  const currentStatusKey = getProjectStatusUiKey({
    status,
    isCanceled,
    isFinalized,
  })

  const stateView = (() => {
    if (flow.kind === 'canceled') {
      return {
        message: 'This project was canceled before the participant list was finalized.',
        helper: null,
        actionLabel: null,
        enabled: false,
      }
    }

    if (flow.currentStepKey === 'planning') {
      return {
        message: canManage
          ? 'Payments are not open yet. Open them when most participants have joined.'
          : 'Payments are not open yet. Waiting for the collector to open them.',
        helper: 'New joins after this point may trigger rebalancing.',
        actionLabel: 'Open payments',
        enabled: canManage && canStartCollecting && !startCollectingBlockedReason,
      }
    }

    if (flow.currentStepKey === 'payments_open') {
      return {
        message: canManage
          ? 'Payments are open. Lock the participant list when the base group is final.'
          : 'Payments are open. Waiting for the collector to lock the participant list.',
        helper: 'New joins may still trigger rebalancing until the list is locked.',
        actionLabel: 'Lock participant list',
        enabled: canManage && canFinalize,
      }
    }

    return {
      message: 'Participant list is finalized. Base contributions are frozen.',
      helper: null,
      actionLabel: null,
      enabled: false,
    }
  })()

  return (
    <section className="surface-card space-y-3 p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        {flow.steps.map((step, index) => {
          const isCurrent = flow.kind === 'active' && flow.currentIndex === index
          const isDone = flow.kind === 'active' && flow.currentIndex > index
          const stepStatusKey = (() => {
            if (step.key === 'planning') return 'pending'
            if (step.key === 'payments_open') return 'collecting'
            return 'locked'
          })()
          const itemClass = isCurrent
            ? projectStatusUi[currentStatusKey].flowBadgeClassName
            : isDone
              ? projectStatusUi[stepStatusKey].flowBadgeClassName
              : projectStatusUi.unknown.flowBadgeClassName
          const dotClass = isCurrent
            ? projectStatusUi[currentStatusKey].badgeClassName
            : isDone
              ? projectStatusUi[stepStatusKey].badgeClassName
              : projectStatusUi.unknown.badgeClassName
          const connectorClass =
            flow.kind === 'active' && flow.currentIndex > index
              ? projectStatusUi[stepStatusKey].flowBadgeClassName
              : projectStatusUi.unknown.flowBadgeClassName

          return (
            <div key={step.key} className="flex min-w-0 items-center gap-2">
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${itemClass}`}>
                <span className={`h-2 w-2 rounded-full border ${dotClass}`} />
                <span>{step.label}</span>
              </div>
              {index < flow.steps.length - 1 ? (
                <div className={`h-px w-5 border-t md:w-8 ${connectorClass}`} aria-hidden="true" />
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-slate-700">{stateView.message}</p>
          {stateView.helper ? <p className="text-xs text-slate-500">{stateView.helper}</p> : null}
          {startCollectingBlockedReason && flow.kind === 'active' && flow.currentStepKey === 'planning' && canManage ? (
            <p className="text-xs text-slate-500">{startCollectingBlockedReason}</p>
          ) : null}
        </div>

        {flow.kind === 'active' && flow.currentStepKey === 'planning' && canManage ? (
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={!stateView.enabled}
            onClick={() => setStartCollectingOpen(true)}
          >
            {stateView.actionLabel}
          </button>
        ) : null}

        {flow.kind === 'active' && flow.currentStepKey === 'payments_open' && canManage ? (
          <form action={stateView.enabled ? finalizeProject.bind(null, projectId) : undefined}>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={!stateView.enabled}
            >
              {stateView.actionLabel}
            </button>
          </form>
        ) : null}
      </div>

      {startCollectingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close open payments modal"
            className="absolute inset-0 bg-black/40"
            onClick={() => setStartCollectingOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Open payments confirmation"
            className="relative w-full max-w-lg rounded-lg border bg-white shadow-lg"
          >
            <div className="border-b px-4 py-3 font-medium">Open payments</div>
            <div className="space-y-3 p-4 text-sm text-slate-700">
              <p>
                Opening payments moves the project from
                <span className="font-medium"> Planning </span>
                to
                <span className="font-medium"> Collecting</span>.
              </p>
              <p>
                This action automatically marks your{' '}
                <span className="font-medium">base share ({collectorBaseShareLabel})</span>{' '}
                as paid.
              </p>
              <p>
                It also auto-marks your share as paid for extras where you are both payer and collector.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-sm"
                onClick={() => setStartCollectingOpen(false)}
              >
                Cancel
              </button>
              <form
                action={stateView.enabled ? startCollecting.bind(null, projectId) : undefined}
                onSubmit={() => setStartCollectingOpen(false)}
              >
                <button
                  type="submit"
                  className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  disabled={!stateView.enabled}
                >
                  Confirm and open
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
