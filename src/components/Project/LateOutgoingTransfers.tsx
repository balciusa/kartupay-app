'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { markLateJoinPaid } from '@/app/project/[id]/actions'

type Transfer = {
  id: string
  from_participant_id: string
  to_participant_id: string
  expected_cents: number
  sender_marked_at: string | null
  received_at: string | null
}

type Participant = {
  id: string
  short_code: string | null
  users?: { email: string | null; display_name?: string | null } | null
}

type PayOption = {
  label: string | null
  value: string
  type: string
  priority?: number
  is_active?: boolean
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

const formatEuro = (cents: number) => `\u20AC${(cents / 100).toFixed(2)}`

export function LateOutgoingTransfers({
  transfers,
  participants,
  allOptions,
  viewerParticipantId,
  projectCanceled,
}: {
  transfers: Transfer[]
  participants: Participant[]
  allOptions: Array<[string, Array<PayOption>]>
  viewerParticipantId: string | null
  projectCanceled: boolean
}) {
  const [openTransferId, setOpenTransferId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const modalRef = useRef<HTMLDivElement | null>(null)
  const participantsById = useMemo(
    () => new Map(participants.map(p => [p.id, p] as const)),
    [participants]
  )
  const allOptionsMap = useMemo(() => new Map(allOptions), [allOptions])
  const outgoingTransfers = useMemo(
    () =>
      viewerParticipantId
        ? transfers.filter(t => t.from_participant_id === viewerParticipantId && !t.received_at)
        : [],
    [transfers, viewerParticipantId]
  )
  const modalTransfer = openTransferId ? outgoingTransfers.find(t => t.id === openTransferId) ?? null : null
  const modalRecipient = modalTransfer ? participantsById.get(modalTransfer.to_participant_id) ?? null : null
  const modalOptions = modalTransfer ? allOptionsMap.get(modalTransfer.to_participant_id) ?? [] : []

  useEffect(() => {
    if (!openTransferId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenTransferId(null)
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
  }, [openTransferId])

  const handlePaymentOption = (opt: { value: string; type: string }) => {
    if (!opt?.value) return
    const type = (opt.type || '').toLowerCase()
    if (type === 'iban') {
      navigator.clipboard?.writeText(opt.value).catch(() => {})
      return
    }
    const revolut = type === 'revolut' ? normalizeRevolutUrl(opt.value) : null
    const href = revolut ? ensureHttp(revolut) : ensureHttp(opt.value)
    if (href) window.open(href, '_blank', 'noreferrer')
  }

  if (!viewerParticipantId || outgoingTransfers.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-sm text-slate-500">
        No outgoing transfers.
      </div>
    )
  }

  return (
    <>
      <div className="space-y-2.5">
        {outgoingTransfers.map(transfer => {
          const recipient = participantsById.get(transfer.to_participant_id)
          const recipientName = recipient ? displayName(recipient) : 'Participant'
          const awaiting = !!transfer.sender_marked_at && !transfer.received_at
          return (
            <div key={transfer.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">
                    {recipientName} {formatEuro(transfer.expected_cents)}
                  </span>
                  {awaiting && (
                    <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-800">
                      Awaiting confirmation
                    </span>
                  )}
                </div>
                {!awaiting ? (
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:opacity-50"
                    disabled={projectCanceled}
                    onClick={() => setOpenTransferId(transfer.id)}
                  >
                    Pay
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {modalTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close payment modal"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpenTransferId(null)}
          />
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Pay ${modalRecipient ? displayName(modalRecipient) : 'participant'}`}
            className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 font-medium">
              <span>Pay {modalRecipient ? displayName(modalRecipient) : 'participant'}</span>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-100"
                onClick={() => setOpenTransferId(null)}
              >
                Close
              </button>
            </div>
            <div className="p-4 space-y-2 overflow-y-auto flex-1">
              {modalOptions.length === 0 ? (
                <div className="text-sm opacity-70">No payment methods yet.</div>
              ) : (
                [...modalOptions]
                  .filter(opt => opt && opt.is_active !== false)
                  .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
                  .map((opt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                      title={opt.type === 'iban' ? 'Copy IBAN' : 'Open link'}
                      onClick={() => handlePaymentOption({ value: opt.value, type: opt.type })}
                    >
                      <div className="text-sm font-medium">{opt.label ?? opt.type ?? 'Payment option'}</div>
                      <div className="text-xs opacity-70 break-all font-mono">{opt.value}</div>
                    </button>
                  ))
              )}
            </div>
            <div className="px-4 py-3 border-t flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-white transition-colors hover:bg-slate-700 disabled:opacity-50 sm:w-auto"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    await markLateJoinPaid(modalTransfer.id)
                    setOpenTransferId(null)
                  })
                }}
              >
                {pending ? 'Saving...' : `I've paid ${formatEuro(modalTransfer.expected_cents)}`}
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 transition-colors hover:bg-slate-100"
                onClick={() => setOpenTransferId(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
