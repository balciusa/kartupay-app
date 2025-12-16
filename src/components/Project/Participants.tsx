'use client'

import { useTransition, useState } from 'react'
import { markReceived, approveJoinRequestFromForm, rejectJoinRequestFromForm, promoteToOrganizerFromForm, setCollector } from '@/app/project/[id]/actions'

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

type IbanModalState = { value: string, label: string | null } | null

const normalizeRevolutUrl = (raw: string) => {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (trimmed.startsWith('@')) return `https://revolut.me/${trimmed.replace(/^@+/, '')}`
  if (lower.includes('revolut.me')) return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (/^revolut\.me/i.test(trimmed)) return `https://${trimmed}`
  return null
}

const ensureHttp = (raw: string) => {
  if (!raw) return null
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

const looksLikeIban = (raw: string) => {
  const normalized = (raw || '').replace(/\s+/g, '').toUpperCase()
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)
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
  collectorParticipantId?: string | null
}) {
  const [pending, start] = useTransition()
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null)
  const [ibanModal, setIbanModal] = useState<IbanModalState>(null)
  const [copiedIban, setCopiedIban] = useState(false)
  const isOrganizer = !!(props.organizerId && props.myParticipantId === props.organizerId)
  const amCollector = isOrganizer && props.collectorParticipantId === props.myParticipantId
  const pendingRequests = props.pendingRequests ?? []
  const projectCanceled = props.projectCanceled === true
  
  console.log('[Participants] Render:', {
    isOrganizer,
    organizerId: props.organizerId,
    myParticipantId: props.myParticipantId,
    pendingRequestsCount: pendingRequests.length,
    pendingRequests: pendingRequests
  })

  const openIbanModal = (opt: PayOption) => {
    setCopiedIban(false)
    setIbanModal({ value: opt.value, label: opt.label ?? opt.type })
  }

  const handlePay = (opt?: PayOption) => {
    if (!opt) return
    const value = opt.value?.trim()
    if (!value) return

    const treatAsIban = opt.type === 'iban' || opt.type === 'swedbank' || looksLikeIban(value)
    if (treatAsIban) {
      openIbanModal(opt)
      return
    }

    const revolutUrl = opt.type === 'revolut' ? normalizeRevolutUrl(value) : null
    if (revolutUrl) {
      const href = ensureHttp(revolutUrl)
      if (href) window.open(href, '_blank', 'noreferrer')
      return
    }

    const href = ensureHttp(value)
    if (href) window.open(href, '_blank', 'noreferrer')
  }

  const handleCopyIban = async (value: string) => {
    try {
      await navigator.clipboard?.writeText(value)
      setCopiedIban(true)
    } catch (e) {
      console.error('Failed to copy IBAN', e)
      setCopiedIban(false)
    }
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
          const pref = props.preferred.get(p.id)
          const all = (props.allOptions.get(p.id) ?? []).filter(o => o.is_active !== false)
          const paid = props.paidSet.has(p.id)
          const late = props.afterDeadlineSet.has(p.id)
          const otherOptions = pref ? all.filter(o => !(o.type === pref.type && o.value === pref.value)) : all
          const hasMultipleActive = all.length > 1
          const name = displayName(p)
          const isSelf = props.currentUserId && p.user_id === props.currentUserId
          const isCollectorRow = props.collectorParticipantId === p.id

          return (
            <div key={p.id} className="rounded border p-3 space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="font-medium flex items-center gap-2">
                    <span>{name}</span>
                    {isSelf && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-black text-white">You</span>
                    )}
                    <span className="text-xs uppercase opacity-50">{p.role}</span>
                    {isCollectorRow && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 text-white">Collector</span>
                    )}
                    {isOrganizer && p.role === 'member' && !isSelf && (
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
                  <div className="text-xs opacity-70">
                    {pref ? (
                      <>
                        Preferred: <span className="font-medium">{pref.label ?? pref.type}</span>{' '}
                        <span className="font-mono break-all">{pref.value}</span>
                      </>
                    ) : (
                      <span>No payment link yet</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!isSelf && (
                    <>
                      <button
                        className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
                        disabled={!pref || projectCanceled}
                        onClick={() => { if (projectCanceled) return; handlePay(pref) }}
                      >
                        Pay
                      </button>

                      {hasMultipleActive && (
                        <div className="relative">
                          <button
                            className="px-2 py-1 rounded border"
                            disabled={projectCanceled}
                            onClick={() => { if (projectCanceled) return; setMenuOpenFor(menuOpenFor === p.id ? null : p.id) }}
                            aria-label="Choose another payment option"
                          >
                            ...
                          </button>
                          {menuOpenFor === p.id && (
                            <div className="absolute right-0 mt-2 w-72 rounded border bg-white shadow-lg z-10">
                              <div className="text-xs px-3 py-2 border-b font-medium">Other options</div>
                              {otherOptions.length === 0 ? (
                                <div className="text-xs px-3 py-2 opacity-60">No other active options</div>
                              ) : (
                                otherOptions.map((o, idx) => (
                                  <button
                                    key={idx}
                                    className="block w-full text-left px-3 py-2 hover:bg-black/5"
                                    onClick={() => { if (projectCanceled) return; setMenuOpenFor(null); handlePay(o) }}
                                  >
                                    <div className="text-sm font-medium">{o.label ?? o.type}</div>
                                    <div className="text-xs opacity-70 font-mono break-all">{o.value}</div>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {amCollector && (
                    <button
                      className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
                      disabled={pending || projectCanceled}
                      onClick={() => { if (projectCanceled) return; start(async () => { await markReceived(p.id) }) }}
                    >
                      {pending ? 'Saving...' : projectCanceled ? 'Canceled' : 'Mark received'}
                    </button>
                  )}

                  {isOrganizer && p.role === 'organizer' && !isCollectorRow && (
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

              {paid && !late && (
                <div className="text-sm text-green-700">Payment received (counts for threshold)</div>
              )}
              {late && (
                <div className="text-sm bg-yellow-100 border border-yellow-300 rounded p-2">
                  <div className="font-medium">Heads up</div>
                  <div>This receipt was recorded after the deadline. It will not count toward the threshold.</div>
                </div>
              )}

            </div>
          )
        })}
      </div>

      {ibanModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg p-4 w-80 shadow-lg space-y-3">
            <div className="text-sm font-medium">IBAN details</div>
            <div className="text-xs opacity-70">Use your banking app to send to this IBAN.</div>
            <div className="border rounded px-2 py-2 font-mono text-sm break-all">
              {ibanModal.value}
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 rounded border"
                onClick={() => handleCopyIban(ibanModal.value)}
              >
                {copiedIban ? 'Copied' : 'Copy IBAN'}
              </button>
              <button
                className="px-3 py-1.5 rounded bg-black text-white"
                onClick={() => setIbanModal(null)}
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
