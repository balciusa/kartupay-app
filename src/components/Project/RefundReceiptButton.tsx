'use client'

import { useState, useTransition } from 'react'
import { confirmParticipantRefundReceived } from '@/app/project/[id]/actions'
import { usePrivateProjectAccess } from './PrivateProjectAccessBoundary'

export function RefundReceiptButton({ projectId, refundRequestId }: { projectId: string; refundRequestId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { beginAccessExit, cancelAccessExit, completeAccessExit } = usePrivateProjectAccess()

  const confirmReceipt = () => {
    setError(null)
    const attemptId = beginAccessExit(projectId)
    startTransition(async () => {
      try {
        const result = await confirmParticipantRefundReceived(refundRequestId)
        if (result.accessRevoked) {
          completeAccessExit(projectId, attemptId)
          return
        }
        await cancelAccessExit(projectId, attemptId)
      } catch (caught) {
        await cancelAccessExit(projectId, attemptId)
        setError(caught instanceof Error ? caught.message : 'Refund confirmation failed. Please try again.')
      }
    })
  }

  return (
    <div className="space-y-2">
      <button
        className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:opacity-60"
        type="button"
        disabled={pending}
        onClick={confirmReceipt}
      >
        {pending ? 'Confirming securely...' : 'Confirm this refund received'}
      </button>
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
    </div>
  )
}
