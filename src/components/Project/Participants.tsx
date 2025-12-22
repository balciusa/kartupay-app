'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  markReceived,
  approveJoinRequestFromForm,
  rejectJoinRequestFromForm,
  promoteToOrganizerFromForm,
  setCollector,
  selfReportPaid,
} from '@/app/project/[id]/actions'

type Participant = {
  id: string
  user_id: string
  role: string
  short_code: string | null
  users?: { email: string | null } | null
}

type PayOption = { label: string | null, value: string, type: string }
type Pref = PayOption
type Opt = PayOption & { priority: number, is_active?: boolean }

const ensureHttp = (raw: string) => {
  if (!raw) return null
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

const normalizeRevolutUrl = (raw: string) => {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('@')) return `https://revolut.me/${trimmed.replace(/^@+/, '')}`
  if (/^revolut\.me/i.test(trimmed)) return `https://${trimmed}`
  if (trimmed.toLowerCase().includes('revolut.me')) return ensureHttp(trimmed)
  return null
}

const displayName = (p: Participant) =>
  p.users?.email || (p.short_code ? `#${p.short_code}` : 'Anonymous')

export function Participants(props: {
  projectId: string
  participants: Array<Participant>
  preferred: Map<string, Pref>
  allOptions: Map<string, Array<Opt>>
  paidSet: Set<string>
  afterDeadlineSet: Set<string>
  organizerId: string | null
  pendingRequests?: Array<{ id: string; requester_user_id: string; created_at: string; status: string }>
  myParticipantId: string | null
  currentUserId: string | null
  projectCanceled?: boolean
  perPersonCents: number
  collectorId: string | null
  collectorOptions: Array<{ label: string | null; value: string; type: string; priority?: number; is_active?: boolean }>
  pendingSignalsSet?: Set<string>
}) {
  const [pending, start] = useTransition()
  const [payOpenFor, setPayOpenFor] = useState<string | null>(null)
  const router = useRouter()
  const isOrganizer = !!(props.organizerId && props.myParticipantId === props.organizerId)
  const pendingRequests = props.pendingRequests ?? []
  const projectCanceled = props.projectCanceled === true
  const pendingSignalsSet = props.pendingSignalsSet ?? new Set<string>()
  
  console.log('[Participants] Render:', {
    isOrganizer,
    organizerId: props.organizerId,
    myParticipantId: props.myParticipantId,
    pendingRequestsCount: pendingRequests.length,
    pendingRequests: pendingRequests
  })

  const viewerParticipantId = props.myParticipantId ?? null
  const viewerSettled = viewerParticipantId ? props.paidSet.has(viewerParticipantId) : false
  const viewerHasPendingSignal = viewerParticipantId ? pendingSignalsSet.has(viewerParticipantId) : false
  const selfReportAction = viewerParticipantId ? selfReportPaid.bind(null, viewerParticipantId) : null
  const canSelfReport = !!selfReportAction && !viewerSettled && !viewerHasPendingSignal && !projectCanceled
  const collectorOptions = (props.collectorOptions ?? []).filter(opt => opt && opt.is_active !== false)
  const openPayForCollector = () => setPayOpenFor('collector')
  const handleCollectorOption = (opt: { value: string; type: string }) => {
    if (!opt?.value) return
    const type = (opt.type || '').toLowerCase()
    if (type === 'iban') {
      navigator.clipboard?.writeText(opt.value).catch(() => {})
      setPayOpenFor(null)
      return
    }
    const revolut = type === 'revolut' ? normalizeRevolutUrl(opt.value) : null
    const href = revolut ? ensureHttp(revolut) : ensureHttp(opt.value)
    if (href) window.open(href, '_blank', 'noreferrer')
    setPayOpenFor(null)
  }

  return (
    <section className="border rounded-xl p-4 space-y-4">
      <h2 className="text-lg font-semibold">Participants</h2>

      {isOrganizer && pendingRequests.length > 0 && (
        <div className="rounded border p-3 space-y-3">
          <div className="font-medium">Pending join requests</div>
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
                      hour12: true
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
        </div>
      )}

      <div className="grid gap-3">
        {props.participants.map(p => {
          const paid = props.paidSet.has(p.id)
          const sent = pendingSignalsSet.has(p.id)
          const late = props.afterDeadlineSet.has(p.id)
          const name = displayName(p)
          const rowIsCollector = !!(props.collectorId && p.id === props.collectorId)
          const viewerIsCollector = !!(props.collectorId && props.myParticipantId === props.collectorId)
          const isSelfRow = !!(props.myParticipantId && props.myParticipantId === p.id)
          const perPersonEuro = (props.perPersonCents / 100).toFixed(2)
          const amountLabel = `€${perPersonEuro}`
          // Only show Pay button if it's the viewer's own row, they haven't paid, and they're not the collector
          const showPay =
            isSelfRow &&
            !viewerIsCollector &&
            !rowIsCollector &&
            !paid && // Also check if this row participant has paid (should match viewerSettled when isSelfRow is true)
            !viewerSettled &&
            !viewerHasPendingSignal &&
            !sent

          let statusLabel: string
          let statusClass = 'text-[10px] px-1.5 py-0.5 rounded border font-medium'
          if (rowIsCollector) {
            statusLabel = 'Collector'
            statusClass += ' bg-emerald-600 text-white border-emerald-700'
          } else if (paid && !isSelfRow && !(viewerIsCollector && !rowIsCollector)) {
            // Don't show "Settled" in status label for self row or when collector views paid member - it's shown on the right side instead
            statusLabel = 'Settled'
            statusClass += ' bg-emerald-50 text-emerald-700 border-emerald-200'
          } else if (sent) {
            statusLabel = `Sent - ${amountLabel}`
            statusClass += ' bg-amber-50 text-amber-800 border-amber-200'
          } else {
            statusLabel = `Owes ${amountLabel}`
            statusClass += ' bg-gray-100 text-gray-800 border-gray-200'
          }
          const showLateTag = !rowIsCollector && paid && late
          const markReceivedDisabled = pending || projectCanceled || paid

          return (
            <div key={p.id} className="rounded border p-3 space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="font-medium flex items-center gap-2">
                    <span>{name}</span>
                    {isSelfRow && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-black text-white">You</span>
                    )}
                    <span className="text-xs uppercase opacity-50">{p.role}</span>
                    <span
                      className={statusClass}
                      title={sent && !paid ? 'Waiting for confirmation' : undefined}
                    >
                      {statusLabel}
                    </span>
                    {showLateTag && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700">
                        Late
                      </span>
                    )}
                    {isOrganizer && p.role === 'member' && !isSelfRow && (
                      <form action={promoteToOrganizerFromForm} className="inline">
                        <input type="hidden" name="participantId" value={p.id} />
                        <button
                          type="submit"
                          className="text-xs px-2 py-0.5 rounded border hover:bg-gray-50"
                          title="Promote to organizer"
                        >
                          Promote
                        </button>
                      </form>
                    )}
                  </div>
                  {rowIsCollector && (
                    <div className="text-xs text-emerald-600">Collects payments</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {showPay && (
                    <button
                      className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
                      type="button"
                      disabled={projectCanceled}
                      title={
                        projectCanceled ? 'Payments disabled for canceled projects' : undefined
                      }
                      onClick={() => {
                        if (projectCanceled) return
                        openPayForCollector()
                      }}
                    >
                      {`Pay ${amountLabel}`}
                    </button>
                  )}

                  {!showPay && viewerSettled && !rowIsCollector && isSelfRow && (
                    <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 border border-green-300">
                      Settled
                    </span>
                  )}

                  {viewerIsCollector && !rowIsCollector && !paid && (
                    <button
                      className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
                      type="button"
                      disabled={markReceivedDisabled}
                      onClick={() => {
                        if (projectCanceled || paid) return
                        start(async () => {
                          await markReceived(p.id)
                          router.refresh()
                        })
                      }}
                    >
                      {pending ? 'Saving...' : projectCanceled ? 'Canceled' : 'Mark received'}
                    </button>
                  )}

                  {viewerIsCollector && !rowIsCollector && paid && (
                    <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 border border-green-300">
                      Settled
                    </span>
                  )}

                  {isOrganizer && p.role === 'organizer' && !rowIsCollector && (
                    <form action={setCollector.bind(null, props.projectId, p.id)}>
                      <button className="px-2 py-1 rounded border text-xs" type="submit">
                        Make collector
                      </button>
                    </form>
                  )}
                </div>

                {projectCanceled && (
                  <div className="text-xs text-red-700 mt-1">
                    Payment updates are disabled because the project was canceled.
                  </div>
                )}
              </div>

            </div>
          )
        })}
      </div>

      {payOpenFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-lg border flex flex-col max-h-[90vh]">
            <div className="px-4 py-3 border-b font-medium">Choose a payment method</div>
            <div className="p-4 space-y-2 overflow-y-auto flex-1">
              {collectorOptions.length === 0 ? (
                <div className="text-sm opacity-70">
                  No payment methods yet. Ask the collector to add one in Settings.
                </div>
              ) : (
                [...collectorOptions]
                  .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
                  .map((opt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="w-full text-left px-3 py-2 rounded border hover:bg-black/5"
                      title={opt.type === 'iban' ? 'Copy IBAN' : 'Open link'}
                      onClick={() => handleCollectorOption({ value: opt.value, type: opt.type })}
                    >
                      <div className="text-sm font-medium">{opt.label ?? opt.type ?? 'Payment option'}</div>
                      <div className="text-xs opacity-70 break-all font-mono">{opt.value}</div>
                    </button>
                  ))
              )}
            </div>
            <div className="px-4 py-3 border-t flex flex-col gap-2 sm:flex-row sm:items-center sticky bottom-0 bg-white">
              {selfReportAction ? (
                <form
                  action={selfReportAction}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center flex-1"
                  onSubmit={() => setPayOpenFor(null)}
                >
                  <div className="text-xs opacity-70">
                    Let the collector know you sent the payment.
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50 w-full sm:w-auto"
                    disabled={!canSelfReport}
                  >
                    I've paid
                  </button>
                </form>
              ) : (
                <div className="text-xs opacity-70 flex-1">
                  You need an active participant slot to self-report payments.
                </div>
              )}
              <button
                type="button"
                className="px-3 py-1.5 rounded border"
                onClick={() => setPayOpenFor(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  )
}
