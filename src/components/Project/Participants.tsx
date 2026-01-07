'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  markReceived,
  approveJoinRequestFromForm,
  rejectJoinRequestFromForm,
  promoteToOrganizerFromForm,
  setCollector,
  selfReportPaid,
  confirmLateJoinReceipt,
  markLateJoinPaid,
} from '@/app/project/[id]/actions'

type Participant = {
  id: string
  user_id: string
  role: string
  short_code: string | null
  joined_at: string | null
  users?: { email: string | null; display_name?: string | null } | null
}

type PayOption = { label: string | null, value: string, type: string }
type Pref = PayOption
type Opt = PayOption & { priority: number, is_active?: boolean }

// Money helpers
const euros = (cents: number) => `€${(cents / 100).toFixed(2)}`

type Transfer = {
  id: string
  project_id: string
  from_participant_id: string
  to_participant_id: string
  expected_cents: number
  sender_marked_at: string | null
  received_at: string | null
}

type PayModalState =
  | { type: 'collector' }
  | { type: 'participant'; participantId: string }

type TransferStats = {
  pendingCount: number
  pendingCents: number
  totalCount: number
  totalCents: number
  markedPendingCount: number
  markedCount: number
  confirmedCount: number
}

const makeEmptyStats = (): TransferStats => ({
  pendingCount: 0,
  pendingCents: 0,
  totalCount: 0,
  totalCents: 0,
  markedPendingCount: 0,
  markedCount: 0,
  confirmedCount: 0,
})

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

const formatEuro = (cents: number) => `€${(cents / 100).toFixed(2)}`
const readableDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '')
const mapFromEntries = <T,>(entries: Array<[string, T]> = []) => new Map(entries)

export function Participants(props: {
  projectId: string
  participants: Array<Participant>
  preferred: Array<[string, Pref]>
  allOptions: Array<[string, Array<Opt>]>
  paidSet: Set<string>
  afterDeadlineSet: Set<string>
  organizerId: string | null
  pendingRequests?: Array<{ id: string; requester_user_id: string; created_at: string; status: string }>
  showPendingRequests?: boolean
  showPayments?: boolean
  myParticipantId: string | null
  currentUserId: string | null
  projectCanceled?: boolean
  perPersonCents: number
  collectorId: string | null
  collectorOptions: Array<{ label: string | null; value: string; type: string; priority?: number; is_active?: boolean }>
  pendingSignalsSet?: Set<string>
  transfers: Transfer[]
  closedAt: string | null
  projectStatus: string | null
}) {
  const [pending, start] = useTransition()
  const [confirming, startConfirm] = useTransition()
  const [markingLatePaid, startMarkLatePaid] = useTransition()
  const [payOpenFor, setPayOpenFor] = useState<PayModalState | null>(null)
  const router = useRouter()
  const isOrganizer = !!(props.organizerId && props.myParticipantId === props.organizerId)
  const pendingRequests = props.pendingRequests ?? []
  const showPendingRequests = props.showPendingRequests !== false
  const showPayments = props.showPayments !== false
  const projectCanceled = props.projectCanceled === true
  const pendingSignalsSet = props.pendingSignalsSet ?? new Set<string>()
  const allOptionsMap = useMemo(() => mapFromEntries(props.allOptions ?? []), [props.allOptions])
  const transfersList = props.transfers ?? []
  const transferAggregates = useMemo(() => {
    type Stats = {
      pendingCount: number
      pendingCents: number
      totalCount: number
      totalCents: number
      markedPendingCount: number
      markedCount: number
      confirmedCount: number
    }
    const makeStats = (): Stats => ({
      pendingCount: 0,
      pendingCents: 0,
      totalCount: 0,
      totalCents: 0,
      markedPendingCount: 0,
      markedCount: 0,
      confirmedCount: 0,
    })
    const senderMap = new Map<string, Transfer[]>()
    const recipientMap = new Map<string, Transfer[]>()
    const incomingStats = new Map<string, Stats>()
    const outgoingStats = new Map<string, Stats>()
    const pairMap = new Map<string, Transfer[]>()

    for (const t of transfersList) {
      if (!senderMap.has(t.from_participant_id)) senderMap.set(t.from_participant_id, [])
      senderMap.get(t.from_participant_id)!.push(t)
      if (!recipientMap.has(t.to_participant_id)) recipientMap.set(t.to_participant_id, [])
      recipientMap.get(t.to_participant_id)!.push(t)

      const pairKey = `${t.from_participant_id}__${t.to_participant_id}`
      if (!pairMap.has(pairKey)) pairMap.set(pairKey, [])
      pairMap.get(pairKey)!.push(t)

      const recStats = incomingStats.get(t.to_participant_id) ?? makeStats()
      recStats.totalCount += 1
      recStats.totalCents += t.expected_cents
      if (t.sender_marked_at) recStats.markedCount += 1
      if (t.sender_marked_at && !t.received_at) recStats.markedPendingCount += 1
      if (t.received_at) recStats.confirmedCount += 1
      if (!t.received_at) {
        recStats.pendingCount += 1
        recStats.pendingCents += t.expected_cents
      }
      incomingStats.set(t.to_participant_id, recStats)

      const sndStats = outgoingStats.get(t.from_participant_id) ?? makeStats()
      sndStats.totalCount += 1
      sndStats.totalCents += t.expected_cents
      if (t.sender_marked_at) sndStats.markedCount += 1
      if (t.sender_marked_at && !t.received_at) sndStats.markedPendingCount += 1
      if (t.received_at) sndStats.confirmedCount += 1
      if (!t.received_at) {
        sndStats.pendingCount += 1
        sndStats.pendingCents += t.expected_cents
      }
      outgoingStats.set(t.from_participant_id, sndStats)
    }

    return { senderMap, recipientMap, incomingStats, outgoingStats, pairMap }
  }, [transfersList])
  const lateTransfersBySenderMap = transferAggregates.senderMap
  const lateTransfersByRecipientMap = transferAggregates.recipientMap
  const incomingStatsMap = transferAggregates.incomingStats
  const outgoingStatsMap = transferAggregates.outgoingStats
  const pairTransfersMap = transferAggregates.pairMap
  const participantsById = useMemo(
    () => new Map(props.participants.map(p => [p.id, p] as const)),
    [props.participants]
  )
  const closedAtDate = useMemo(() => (props.closedAt ? new Date(props.closedAt) : null), [props.closedAt])
  const isFinalized = useMemo(() => {
    const status = (props.projectStatus ?? '').toLowerCase()
    return status === 'closed' || status === 'finalized'
  }, [props.projectStatus])
  
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
  const openPayForCollector = () => setPayOpenFor({ type: 'collector' })
  const openPayForParticipant = (participantId: string) => setPayOpenFor({ type: 'participant', participantId })
  const handlePaymentOption = (opt: { value: string; type: string }) => {
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
  const modalTargetParticipant =
    payOpenFor?.type === 'participant' ? participantsById.get(payOpenFor.participantId) ?? null : null
  const modalOptions =
    payOpenFor?.type === 'collector'
      ? collectorOptions
      : payOpenFor?.type === 'participant'
        ? allOptionsMap.get(payOpenFor.participantId) ?? []
        : []
  const modalTitle =
    payOpenFor?.type === 'participant' && modalTargetParticipant
      ? `Pay ${displayName(modalTargetParticipant)}`
      : 'Choose a payment method'
  const viewerModalTransfers =
    payOpenFor?.type === 'participant' && viewerParticipantId
      ? pairTransfersMap.get(`${viewerParticipantId}__${payOpenFor.participantId}`) ?? []
      : []
  const modalLatePending =
    viewerModalTransfers.find(t => !t.received_at && !t.sender_marked_at) ?? null
  const modalLateAwaiting =
    !modalLatePending ? viewerModalTransfers.find(t => !t.received_at && !!t.sender_marked_at) ?? null : null
  const modalLateSettled =
    !modalLatePending && !modalLateAwaiting ? viewerModalTransfers.find(t => !!t.received_at) ?? null : null

  return (
    <section className="border rounded-xl p-4 space-y-4">
      <h2 className="text-lg font-semibold">Participants</h2>

      {showPendingRequests && isOrganizer && pendingRequests.length > 0 && (
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
          const name = displayName(p)
          const rowIsCollector = !!(props.collectorId && p.id === props.collectorId)
          const viewerIsCollector = !!(props.collectorId && props.myParticipantId === props.collectorId)
          const isSelfRow = !!(props.myParticipantId && props.myParticipantId === p.id)
          const amountLabel = formatEuro(props.perPersonCents)
          const senderLateTransfers = lateTransfersBySenderMap.get(p.id) ?? []
          const recipientLateTransfers = lateTransfersByRecipientMap.get(p.id) ?? []
          const incomingStats = incomingStatsMap.get(p.id) ?? makeEmptyStats()
          const outgoingStats = outgoingStatsMap.get(p.id) ?? makeEmptyStats()
          const joinedAtDate = p.joined_at ? new Date(p.joined_at) : null
          const joinedAfterClose = !!(closedAtDate && joinedAtDate && joinedAtDate > closedAtDate)
          const showsIncomingBadge = isFinalized && incomingStats.totalCount > 0
          const showsOutgoingBadge = isFinalized && outgoingStats.totalCount > 0
          const isLateParticipant = isFinalized && (showsOutgoingBadge || joinedAfterClose)
          if (isLateParticipant) {
            console.log('[Participants] Late participant debug', {
              participantId: p.id,
              outgoingLateTransfers: senderLateTransfers.length,
              incomingLateTransfers: recipientLateTransfers.length,
            })
          }
          const allIncomingSettled = incomingStats.totalCount > 0 && incomingStats.pendingCount === 0
          const hasIncomingMarkedAwaiting = incomingStats.markedPendingCount > 0
          const incomingBadgeText = allIncomingSettled
            ? 'All settled (late)'
            : hasIncomingMarkedAwaiting
              ? 'Reported paid (late)'
              : `Receives ${euros(incomingStats.pendingCents)} from ${incomingStats.pendingCount}`
          const viewerPairKey = viewerParticipantId ? `${viewerParticipantId}__${p.id}` : null
          const viewerPairTransfers = viewerPairKey ? pairTransfersMap.get(viewerPairKey) ?? [] : []
          const viewerPairPending = viewerPairTransfers.filter(t => !t.received_at)
          const viewerPairPendingUnmarked = viewerPairPending.filter(t => !t.sender_marked_at)
          const viewerPairPendingMarked = viewerPairPending.filter(t => !!t.sender_marked_at)
          const viewerPairConfirmed = viewerPairTransfers.filter(t => !!t.received_at)
          const pendingUnmarkedCents = viewerPairPendingUnmarked.reduce((sum, t) => sum + t.expected_cents, 0)
          const pendingMarkedCents = viewerPairPendingMarked.reduce((sum, t) => sum + t.expected_cents, 0)
          const viewerHasLateLink = !!viewerParticipantId && !isSelfRow && isFinalized && viewerPairTransfers.length > 0
          const viewerShowsLateOwesChip = viewerHasLateLink && viewerPairPendingUnmarked.length > 0
          const viewerShowsLateAwaitingChip =
            viewerHasLateLink && viewerPairPendingUnmarked.length === 0 && viewerPairPendingMarked.length > 0
          const viewerShowsLateSettledChip =
            viewerHasLateLink && viewerPairPending.length === 0 && viewerPairConfirmed.length > 0
          const latePayAvailable = viewerHasLateLink && viewerPairPendingUnmarked.length > 0
          const showStandardPay =
            !isFinalized &&
            !isLateParticipant &&
            isSelfRow &&
            !viewerIsCollector &&
            !rowIsCollector &&
            !paid &&
            !viewerSettled &&
            !viewerHasPendingSignal &&
            !sent
          const showPay = showPayments && (isFinalized ? latePayAvailable : showStandardPay)

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
          } else if (paid) {
            // When payment is settled, show "Paid" instead of "Owes"
            statusLabel = `Paid ${amountLabel}`
            statusClass += ' bg-gray-100 text-gray-800 border-gray-200'
          } else {
            statusLabel = `Owes ${amountLabel}`
            statusClass += ' bg-gray-100 text-gray-800 border-gray-200'
          }
          const markReceivedDisabled = pending || projectCanceled || paid || isLateParticipant

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
                    {showPayments && (
                      <span
                        className={statusClass}
                        title={sent && !paid ? 'Waiting for confirmation' : undefined}
                      >
                        {statusLabel}
                      </span>
                    )}
                    {showPayments && showsIncomingBadge && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          allIncomingSettled ? 'bg-green-600 text-white' : 'bg-amber-600 text-white'
                        }`}
                      >
                        {incomingBadgeText}
                      </span>
                    )}
                    {showPayments && viewerShowsLateAwaitingChip && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-600 text-white">
                        Sent {euros(pendingMarkedCents)} (late), awaiting confirmation
                      </span>
                    )}
                    {showPayments && viewerShowsLateSettledChip && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white">
                        Settled (late)
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
                        if (isFinalized) {
                          openPayForParticipant(p.id)
                        } else {
                          openPayForCollector()
                        }
                      }}
                    >
                      {isFinalized ? `Pay ${name}` : `Pay ${amountLabel}`}
                    </button>
                  )}

                  {showPayments && !isFinalized && !showPay && viewerSettled && !rowIsCollector && isSelfRow && (
                    <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 border border-green-300">
                      Settled
                    </span>
                  )}

                  {showPayments && viewerIsCollector && !rowIsCollector && !isFinalized && !paid && !isLateParticipant && (
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

                  {showPayments && viewerIsCollector && !rowIsCollector && !isLateParticipant && paid && (
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

              {showPayments && recipientLateTransfers.length > 0 && (
                <div className="rounded-md border bg-slate-50 p-3 space-y-2">
                  <div className="text-sm font-medium">Incoming late payments</div>
                  <div className="space-y-2">
                    {recipientLateTransfers.map(transfer => {
                      const sender = participantsById.get(transfer.from_participant_id)
                      const senderName = sender ? displayName(sender) : 'Participant'
                      const settled = !!transfer.received_at
                      const senderMarked = !!transfer.sender_marked_at
                      return (
                        <div
                          key={transfer.id}
                          className="rounded border bg-white p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <div className="text-sm font-medium">{senderName}</div>
                            <div className="text-xs opacity-70">
                              {settled
                                ? `Settled ${readableDate(transfer.received_at)}`
                                : senderMarked
                                  ? `Reported paid ${readableDate(transfer.sender_marked_at)}`
                                  : `Owes ${formatEuro(transfer.expected_cents)}`}
                            </div>
                          </div>
                          {!settled && isSelfRow ? (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded border bg-white text-xs sm:text-sm disabled:opacity-50"
                              disabled={confirming}
                              onClick={() => {
                                startConfirm(async () => {
                                  await confirmLateJoinReceipt(transfer.id)
                                  router.refresh()
                                })
                              }}
                            >
                              {confirming ? 'Saving...' : 'Confirm received'}
                            </button>
                          ) : settled ? (
                            <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 border border-green-300">
                              Settled
                            </span>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            </div>
          )
        })}
      </div>

      {showPayments && payOpenFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-lg border flex flex-col max-h-[90vh]">
            <div className="px-4 py-3 border-b font-medium">{modalTitle}</div>
            <div className="p-4 space-y-2 overflow-y-auto flex-1">
              {modalOptions.length === 0 ? (
                <div className="text-sm opacity-70">
                  {payOpenFor.type === 'collector'
                    ? 'No payment methods yet. Ask the collector to add one in Settings.'
                    : 'No payment link yet.'}
                </div>
              ) : (
                [...modalOptions]
                  .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
                  .map((opt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="w-full text-left px-3 py-2 rounded border hover:bg-black/5"
                      title={opt.type === 'iban' ? 'Copy IBAN' : 'Open link'}
                      onClick={() => handlePaymentOption({ value: opt.value, type: opt.type })}
                    >
                      <div className="text-sm font-medium">{opt.label ?? opt.type ?? 'Payment option'}</div>
                      <div className="text-xs opacity-70 break-all font-mono">{opt.value}</div>
                    </button>
                  ))
              )}
            </div>
            <div className="px-4 py-3 border-t flex flex-col gap-2 sm:flex-row sm:items-center sticky bottom-0 bg-white">
              {payOpenFor.type === 'collector' ? (
                selfReportAction ? (
                  <form
                    action={selfReportAction}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center flex-1"
                    onSubmit={() => setPayOpenFor(null)}
                  >
                    <div className="text-xs opacity-70">Let the collector know you sent the payment.</div>
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50 w-full sm:w-auto"
                      disabled={!canSelfReport}
                    >
                      I&apos;ve paid
                    </button>
                  </form>
                ) : (
                  <div className="text-xs opacity-70 flex-1">
                    You need an active participant slot to self-report payments.
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-2 flex-1">
                  <div className="text-xs opacity-70">
                    Pay {modalTargetParticipant ? displayName(modalTargetParticipant) : 'this participant'} using the
                    methods above, then mark it here.
                  </div>
                  {modalLatePending && (
                    <button
                      className="px-3 py-1.5 rounded bg-black text-white w-full sm:w-auto disabled:opacity-50"
                      type="button"
                      disabled={markingLatePaid}
                      onClick={() => {
                        if (markingLatePaid) return
                        startMarkLatePaid(async () => {
                          await markLateJoinPaid(modalLatePending.id)
                          router.refresh()
                          setPayOpenFor(null)
                        })
                      }}
                    >
                      {markingLatePaid ? 'Saving...' : `I've paid ${euros(modalLatePending.expected_cents)}`}
                    </button>
                  )}
                  {modalLateAwaiting && (
                    <div className="text-xs px-2 py-1 rounded bg-amber-600 text-white w-fit">
                      Sent {euros(modalLateAwaiting.expected_cents)} (late), awaiting confirmation
                    </div>
                  )}
                  {modalLateSettled && (
                    <div className="text-xs px-2 py-1 rounded bg-green-600 text-white w-fit">
                      Confirmed (late){' '}
                      {modalLateSettled.received_at ? `on ${readableDate(modalLateSettled.received_at)}` : ''}
                    </div>
                  )}
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
