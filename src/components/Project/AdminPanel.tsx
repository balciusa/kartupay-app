'use client'

import { useEffect, useRef, useState } from 'react'
import {
  abortProject,
  finalizeProject,
  approveJoinRequestFromForm,
  rejectJoinRequestFromForm,
  promoteToOrganizerFromForm,
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
  isOrganizer,
  canFinalize,
  canCancel,
}: {
  projectId: string
  participants: Participant[]
  collectorId: string | null
  myParticipantId: string | null
  pendingRequests: JoinRequest[]
  pendingCount: number
  isOrganizer: boolean
  canFinalize: boolean
  canCancel: boolean
}) {
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const canManage = isOrganizer
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
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold">Organize</div>
          <button
            type="button"
            className="w-full px-3 py-2 rounded border text-sm"
            disabled={!isOrganizer}
            onClick={() => setParticipantsOpen(true)}
          >
            Manage participants
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
              {!isOrganizer ? (
                <div className="text-sm opacity-70">Organizer-only tools live here.</div>
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
                            {p.role === 'organizer' && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-black">
                                Organizer
                              </span>
                            )}
                            {isCollector && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                                Collector
                              </span>
                            )}
                            {isSelf && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-black text-white">
                                You
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {p.role === 'member' && (
                            <form action={promoteToOrganizerFromForm}>
                              <input type="hidden" name="participantId" value={p.id} />
                              <button
                                type="submit"
                                className="text-xs px-2 py-0.5 rounded bg-black text-white"
                              >
                                Promote to organizer
                              </button>
                            </form>
                          )}
                          {!isCollector && (
                            <form action={setCollector.bind(null, projectId, p.id)}>
                              <button
                                type="submit"
                                className="text-xs px-2 py-0.5 rounded bg-black text-white"
                              >
                                Make collector
                              </button>
                            </form>
                          )}
                        </div>
                      </div>
                    )
                  })}
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
