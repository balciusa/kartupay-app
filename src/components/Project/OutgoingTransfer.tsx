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
  canPay,
  contextLabel,
  reportPaidAction,
}: {
  collectorName: string
  amountLabel: string
  collectorOptions: PayOption[]
  participantId: string | null
  viewerPaid: boolean
  viewerHasPendingSignal: boolean
  projectCanceled: boolean
  canPay: boolean
  contextLabel?: string
  reportPaidAction?: (() => Promise<void>) | undefined
}) {
  const [open, setOpen] = useState(false)
  const modalRef = useRef<HTMLDivElement | null>(null)
  const resolvedReportPaidAction = reportPaidAction ?? (participantId ? selfReportPaid.bind(null, participantId) : null)
  const canSelfReport = !!resolvedReportPaidAction && !viewerPaid && !viewerHasPendingSignal && !projectCanceled
  const options = useMemo(
    () =>
      (collectorOptions ?? [])
        .filter(opt => opt && opt.is_active !== false)
        .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999)),
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
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <div className="text-sm font-medium text-slate-900">
              {collectorName} - {amountLabel}
            </div>
            {contextLabel ? <div className="text-xs text-slate-600">{contextLabel}</div> : null}
          </div>
          {viewerPaid ? (
            <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-1 text-[10px] font-medium text-emerald-700">
              Settled
            </span>
          ) : viewerHasPendingSignal ? (
            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-800">
              Awaiting confirmation
            </span>
          ) : !canPay ? (
            <span className="text-xs text-slate-500">Waiting for minimum participants</span>
          ) : (
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:opacity-50"
              disabled={projectCanceled}
              onClick={() => setOpen(true)}
            >
              Pay
            </button>
          )}
        </div>
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
            className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 font-medium">
              <span>Pay {collectorName}</span>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-100"
                onClick={() => setOpen(false)}
              >
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
              {resolvedReportPaidAction ? (
                <form
                  action={resolvedReportPaidAction}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center flex-1"
                  onSubmit={() => setOpen(false)}
                >
                  <div className="text-xs opacity-70">Let the collector know you sent the payment.</div>
                  <button
                    type="submit"
                    className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-white transition-colors hover:bg-slate-700 disabled:opacity-50 sm:w-auto"
                    disabled={!canSelfReport}
                  >
                    I&apos;ve paid {amountLabel}
                  </button>
                </form>
              ) : (
                <div className="text-xs opacity-70 flex-1">You need an active participant slot to self-report.</div>
              )}
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 transition-colors hover:bg-slate-100"
                onClick={() => setOpen(false)}
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
