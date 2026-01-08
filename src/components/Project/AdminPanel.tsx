'use client'

import { useEffect, useRef, useState } from 'react'
import { abortProject, finalizeProject, approveJoinRequestFromForm, rejectJoinRequestFromForm } from '@/app/project/[id]/actions'

type JoinRequest = {
  id: string
  requester_user_id: string
  created_at: string
  status: string
}

export function AdminPanel({
  projectId,
  pendingRequests,
  pendingCount,
  isOrganizer,
  canFinalize,
  canCancel,
}: {
  projectId: string
  pendingRequests: JoinRequest[]
  pendingCount: number
  isOrganizer: boolean
  canFinalize: boolean
  canCancel: boolean
}) {
  const [requestsOpen, setRequestsOpen] = useState(false)
  const canManage = isOrganizer
  const modalRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!requestsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRequestsOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const container = modalRef.current
      if (!container) return
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable && focusable.length > 0) {
      focusable[0].focus()
    }
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [requestsOpen])
  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold">Organize</div>
          <button
            type="button"
            className="w-full px-3 py-2 rounded border text-sm"
            disabled={!isOrganizer}
          >
            Manage participants
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 rounded border text-sm"
            disabled={!isOrganizer}
          >
            Change collector
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 rounded border text-sm"
            disabled={!isOrganizer}
          >
            Edit totals
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 rounded border text-sm text-center disabled:opacity-50 flex items-center justify-center gap-2"
            disabled={!canManage}
            onClick={() => setRequestsOpen(true)}
          >
            <span>Manage requests</span>
            {pendingCount > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-400 text-amber-950">
                {pendingCount}
              </span>
            )}
          </button>
        </div>
        <div className="border rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold">Project status</div>
          <form className="w-full">
            <button
              type="submit"
              className="w-full px-3 py-2 rounded bg-black text-white text-sm disabled:opacity-50"
              formAction={isOrganizer && canFinalize ? finalizeProject.bind(null, projectId) : undefined}
              disabled={!isOrganizer || !canFinalize}
            >
              Finalize project
            </button>
          </form>
          <form className="w-full">
            <button
              type="submit"
              className="w-full px-3 py-2 rounded border text-sm disabled:opacity-50"
              formAction={isOrganizer && canCancel ? abortProject.bind(null, projectId) : undefined}
              disabled={!isOrganizer || !canCancel}
            >
              Cancel project
            </button>
          </form>
        </div>
      </div>
      {requestsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close requests modal"
            className="absolute inset-0 bg-black/40"
            onClick={() => setRequestsOpen(false)}
          />
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Manage requests"
            className="relative w-full max-w-xl rounded-lg bg-white shadow-lg border flex flex-col max-h-[90vh]"
          >
            <div className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Manage requests</span>
              <button type="button" className="text-sm px-2 py-1 rounded border" onClick={() => setRequestsOpen(false)}>
                Close
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              {!isOrganizer ? (
                <div className="text-sm opacity-70">Organizer-only tools live here.</div>
              ) : pendingRequests.length === 0 ? (
                <div className="text-sm opacity-70">No pending join requests.</div>
              ) : (
                <div className="space-y-2">
                  {pendingRequests.map(req => (
                    <div key={req.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="space-y-0.5">
                        <div className="font-medium">User {req.requester_user_id.slice(0, 6)}</div>
                        <div className="text-xs opacity-70">
                          {new Date(req.created_at).toLocaleString('en-US', {
                            year: 'numeric',
                            month: 'numeric',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <form action={approveJoinRequestFromForm}>
                          <input type="hidden" name="requestId" value={req.id} />
                          <button type="submit" className="px-3 py-1.5 rounded bg-black text-white text-xs">
                            Approve
                          </button>
                        </form>
                        <form action={rejectJoinRequestFromForm}>
                          <input type="hidden" name="requestId" value={req.id} />
                          <button type="submit" className="px-3 py-1.5 rounded border text-xs">
                            Reject
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
