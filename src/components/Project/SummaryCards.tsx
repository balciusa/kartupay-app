'use client'
import { useMemo } from 'react'

function eur(c: number) {
  return (c / 100).toFixed(2)
}

export function SummaryCards(props: {
  totalCents: number
  minParticipants: number | null
  participantsNow: number
  scenarios: { now: number; plus1: number; plus2: number }
  deadlineISO?: string | null
  maxParticipants?: number | null
  collectorLabel?: string | null
}) {
  const deadlineDisplay = useMemo(() => {
    if (!props.deadlineISO) return null
    const date = new Date(props.deadlineISO)
    if (Number.isNaN(date.getTime())) return null
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  }, [props.deadlineISO])

  const showShare = (cents: number) => (props.participantsNow > 0 ? `€${eur(cents)}/person` : '-')

  return (
    <section className="border rounded-2xl bg-white p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="border rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total</div>
          <div className="text-2xl font-semibold text-slate-900">€{eur(props.totalCents)}</div>
          {typeof props.maxParticipants === 'number' && (
            <div className="text-sm text-slate-600">Max: {props.maxParticipants}</div>
          )}
          {deadlineDisplay && (
            <div className="text-sm text-slate-600">Deadline: {deadlineDisplay}</div>
          )}
        </div>

        <div className="border rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Participants</div>
          <div className="text-2xl font-semibold text-slate-900">
            {props.participantsNow}
            {props.minParticipants != null ? ` / ${props.minParticipants}` : ''}
          </div>
        </div>

        <div className="border rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Scenarios (per person)</div>
          <div className="text-sm text-slate-700">Now: {showShare(props.scenarios.now)}</div>
          <div className="text-sm text-slate-700">+1: {showShare(props.scenarios.plus1)}</div>
          <div className="text-sm text-slate-700">+2: {showShare(props.scenarios.plus2)}</div>
        </div>
      </div>
    </section>
  )
}
