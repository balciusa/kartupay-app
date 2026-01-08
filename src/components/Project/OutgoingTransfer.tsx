'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { selfReportPaid } from '@/app/project/[id]/actions'

type PayOption = {
  label: string | null
  value: string
  type: string
  priority?: number
  is_active?: boolean
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

export function OutgoingTransfer({
  collectorName,
  amountLabel,
  collectorOptions,
  participantId,
  viewerPaid,
  viewerHasPendingSignal,
  projectCanceled,
}: {
  collectorName: string
  amountLabel: string
  collectorOptions: PayOption[]
  participantId: string | null
  viewerPaid: boolean
  viewerHasPendingSignal: boolean
  projectCanceled: boolean
}) {
  const [open, setOpen] = useState(false)
  const modalRef = useRef<HTMLDivElement | null>(null)
  const canSelfReport = !!participantId && !viewerPaid && !viewerHasPendingSignal && !projectCanceled
  const options = useMemo(
    () => (collectorOptions ?? []).filter(opt => opt && opt.is_active !== false).sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999)),
    [collectorOptions]
  )

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

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
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
  }, [open])

  return (
    <>
      <div className="flex items-center justify-between py-2 text-sm">
        <div>{collectorName} — {amountLabel}</div>
        {viewerPaid ? (
          <span className="text-xs opacity-70">Settled</span>
        ) : viewerHasPendingSignal ? (
          <button
            type="button"
            className="px-3 py-1.5 rounded border border-amber-500 bg-amber-300 text-xs text-amber-900 cursor-default"
            disabled
          >
            Waiting Payment Confirmation
          </button>
        ) : (
          <button
            type="button"
            className="px-3 py-1.5 rounded border text-xs disabled:opacity-50"
            disabled={projectCanceled}
            onClick={() => setOpen(true)}
          >
            Pay
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close payment modal"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Pay ${collectorName}`}
            className="relative w-full max-w-md rounded-lg bg-white shadow-lg border flex flex-col max-h-[90vh]"
          >
            <div className="px-4 py-3 border-b font-medium flex items-center justify-between">
              <span>Pay {collectorName}</span>
              <button type="button" className="text-sm px-2 py-1 rounded border" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <div className="p-4 space-y-2 overflow-y-auto flex-1">
              {options.length === 0 ? (
                <div className="text-sm opacity-70">No payment methods yet. Ask the collector to add one in Settings.</div>
              ) : (
                options.map((opt, idx) => (
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
            <div className="px-4 py-3 border-t flex flex-col gap-2 sm:flex-row sm:items-center">
              {participantId ? (
                <form
                  action={selfReportPaid.bind(null, participantId)}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center flex-1"
                  onSubmit={() => setOpen(false)}
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
                <div className="text-xs opacity-70 flex-1">You need an active participant slot to self-report.</div>
              )}
              <button type="button" className="px-3 py-1.5 rounded border" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
