'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ActivityLogTab, type ActivityLogItem } from '@/components/Project/ActivityLogTab'
import {
  abortProject,
  finalizeProject,
  startCollecting,
  approveJoinRequestFromForm,
  rejectJoinRequestFromForm,
  setCollector,
} from '@/app/project/[id]/actions'

type JoinRequest = {
  id: string
  requester_user_id: string
  created_at: string
  status: string
}

type Participant = {
  id: string
  user_id: string
  role: string
  short_code: string | null
  users?: { email: string | null; display_name?: string | null } | null
}

const maskEmail = (email?: string | null) => {
  if (!email) return null
  const [name, domain] = email.split('@')
  if (!domain) return email
  const head = name.slice(0, 2)
  return `${head}***@${domain}`
}

const displayName = (p: Participant) => {
  const name = p.users?.display_name ?? null
  if (name) return name
  const masked = maskEmail(p.users?.email ?? null)
  if (masked) return masked
  if (p.short_code) return `#${p.short_code}`
  return 'Member'
}

export function AdminPanel({
  projectId,
  participants,
  collectorId,
  myParticipantId,
  pendingRequests,
  pendingCount,
  canManage,
  canFinalize,
  canStartCollecting,
  startCollectingBlockedReason,
  canCancel,
  openRequestsOnMount = false,
  activityItems,
}: {
  projectId: string
  participants: Participant[]
  collectorId: string | null
  myParticipantId: string | null
  pendingRequests: JoinRequest[]
  pendingCount: number
  canManage: boolean
  canFinalize: boolean
  canStartCollecting: boolean
  startCollectingBlockedReason: string | null
  canCancel: boolean
  openRequestsOnMount?: boolean
  activityItems: ActivityLogItem[]
}) {
  const [requestsOpen, setRequestsOpen] = useState(!!openRequestsOnMount)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [startCollectingOpen, setStartCollectingOpen] = useState(false)
  const [assigningCollector, startAssigningCollector] = useTransition()
  const [selectedCollectorId, setSelectedCollectorId] = useState<string | null>(collectorId)
  const router = useRouter()
  const modalRef = useRef<HTMLDivElement | null>(null)
  const participantsModalRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    if (!participantsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setParticipantsOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const container = participantsModalRef.current
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
    const focusable = participantsModalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable && focusable.length > 0) {
      focusable[0].focus()
    }
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [participantsOpen])
  return (
    <section className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border rounded-xl p-5 md:p-6 space-y-4">
          <div className="space-y-1">
            <div className="text-lg font-semibold">Organize</div>
            <div className="text-sm text-muted-foreground">Manage participants and join requests.</div>
          </div>
          <button
            type="button"
            className="w-full px-4 py-2 rounded-full border text-sm bg-white hover:bg-slate-50 disabled:opacity-50"
            disabled={!canManage}
            onClick={() => {
              setSelectedCollectorId(collectorId)
              setParticipantsOpen(true)
            }}
          >
            Manage participants
          </button>
          <button
            type="button"
            className="w-full px-4 py-2 rounded-full border text-sm text-center disabled:opacity-50 flex items-center justify-center gap-2 bg-white hover:bg-slate-50"
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
        <div className="border rounded-xl p-5 md:p-6 space-y-4">
          <div className="space-y-1">
            <div className="text-lg font-semibold">Project status</div>
            <div className="text-sm text-muted-foreground">
              {canStartCollecting ? 'Start collecting when ready, then close or cancel when needed.' : 'Close or cancel when needed.'}
            </div>
          </div>
          {canStartCollecting && (
            <div className="space-y-1.5">
              <button
                type="button"
                className="w-full px-4 py-2 rounded-full bg-black text-white text-sm disabled:opacity-50"
                disabled={!canManage || !!startCollectingBlockedReason}
                onClick={() => setStartCollectingOpen(true)}
              >
                Start collecting
              </button>
              {startCollectingBlockedReason && (
                <div className="text-xs text-slate-500">{startCollectingBlockedReason}</div>
              )}
            </div>
          )}
          <form className="w-full">
            <button
              type="submit"
              className="w-full px-4 py-2 rounded-full bg-black text-white text-sm disabled:opacity-50"
              formAction={canManage && canFinalize ? finalizeProject.bind(null, projectId) : undefined}
              disabled={!canManage || !canFinalize}
            >
                Close project
              </button>
          </form>
          <form className="w-full">
            <button
              type="submit"
              className="w-full px-4 py-2 rounded-full border text-sm disabled:opacity-50 bg-white hover:bg-slate-50"
              formAction={canManage && canCancel ? abortProject.bind(null, projectId) : undefined}
              disabled={!canManage || !canCancel}
            >
              Cancel project
            </button>
          </form>
        </div>
      </div>
      <section className="border rounded-xl p-5 md:p-6">
        <ActivityLogTab items={activityItems} />
      </section>
      {startCollectingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close start collecting modal"
            className="absolute inset-0 bg-black/40"
            onClick={() => setStartCollectingOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Start collecting confirmation"
            className="relative w-full max-w-lg rounded-lg bg-white shadow-lg border"
          >
            <div className="px-4 py-3 border-b font-medium">Start collecting</div>
            <div className="p-4 space-y-3 text-sm text-slate-700">
              <p>
                You are the collector for this project. Starting collection will move the project from
                <span className="font-medium"> Pending </span>
                to
                <span className="font-medium"> Collecting</span>.
              </p>
              <p>
                This action will automatically mark your
                <span className="font-medium"> base share</span>
                as paid.
              </p>
              <p>
                It will also auto-mark your share as paid for any extras where you are both payer and collector.
              </p>
            </div>
            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded border text-sm"
                onClick={() => setStartCollectingOpen(false)}
              >
                Cancel
              </button>
              <form
                action={canManage && !startCollectingBlockedReason ? startCollecting.bind(null, projectId) : undefined}
                onSubmit={() => setStartCollectingOpen(false)}
              >
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded bg-black text-white text-sm disabled:opacity-50"
                  disabled={!canManage || !!startCollectingBlockedReason}
                >
                  Confirm and start
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
      {participantsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close participants modal"
            className="absolute inset-0 bg-black/40"
            onClick={() => setParticipantsOpen(false)}
          />
          <div
            ref={participantsModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Manage participants"
            className="relative w-full max-w-xl rounded-lg bg-white shadow-lg border flex flex-col max-h-[90vh]"
          >
            <div className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Manage participants</span>
              <button
                type="button"
                className="text-sm px-2 py-1 rounded border"
                onClick={() => setParticipantsOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              {!canManage ? (
                <div className="text-sm opacity-70">Collector-only tools live here.</div>
              ) : participants.length === 0 ? (
                <div className="text-sm opacity-70">No participants found.</div>
              ) : (
                <div className="space-y-2">
                  {participants.map(p => {
                    const isCollector = !!(collectorId && p.id === collectorId)
                    const isSelf = !!(myParticipantId && p.id === myParticipantId)
                    return (
                      <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                        <div className="space-y-0.5">
                          <div className="font-medium flex items-center gap-2 flex-wrap">
                            <span>{displayName(p)}</span>
                            {isCollector && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                                Collector
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {!isSelf && (
                            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                              <input
                                type="radio"
                                name="collector_selection"
                                className="h-4 w-4 accent-black"
                                checked={selectedCollectorId === p.id}
                                onChange={() => setSelectedCollectorId(p.id)}
                              />
                              Select collector
                            </label>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <div className="pt-2 border-t flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded border text-xs disabled:opacity-50"
                      disabled={!selectedCollectorId || selectedCollectorId === collectorId || assigningCollector}
                      onClick={() => {
                        if (!selectedCollectorId || selectedCollectorId === collectorId) return
                        startAssigningCollector(async () => {
                          try {
                            await setCollector(projectId, selectedCollectorId)
                            setParticipantsOpen(false)
                            router.refresh()
                          } catch (error: unknown) {
                            console.error('[AdminPanel] Failed to set collector', error)
                            const maybeError = error as { message?: string } | null
                            alert(maybeError?.message || 'Failed to assign collector')
                          }
                        })
                      }}
                    >
                      {assigningCollector ? 'Saving...' : 'Confirm collector'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
              {!canManage ? (
                <div className="text-sm opacity-70">Collector-only tools live here.</div>
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
