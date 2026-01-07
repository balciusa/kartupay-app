'use client'
import { useMemo } from 'react'

function eur(c: number) {
  return (c/100).toFixed(2)
}

export function SummaryCards(props: {
  totalCents: number
  minParticipants: number | null
  participantsNow: number
  scenarios: { now: number, plus1: number, plus2: number }
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

  const showShare = (cents: number) =>
    props.participantsNow > 0 ? `€${eur(cents)}/person` : '—'

  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="border rounded-xl p-4">
        <div className="text-xs uppercase opacity-60">Total</div>
        <div className="text-2xl font-semibold">€{eur(props.totalCents)}</div>
        {typeof props.maxParticipants === 'number' && (
          <div className="text-sm opacity-70">Max: {props.maxParticipants}</div>
        )}
        {deadlineDisplay && (
          <div className="text-sm opacity-70">Deadline: {deadlineDisplay}</div>
        )}
      </div>

      <div className="border rounded-xl p-4">
        <div className="text-xs uppercase opacity-60">Participants</div>
        <div className="text-2xl font-semibold">
          {props.participantsNow}
          {props.minParticipants != null ? ` / ${props.minParticipants}` : ''}
        </div>
        <div className="text-sm opacity-70">
          Collector: {props.collectorLabel || 'Member'}
        </div>
      </div>

      <div className="border rounded-xl p-4">
        <div className="text-xs uppercase opacity-60">Scenarios (per person)</div>
        <div className="text-sm">Now: {showShare(props.scenarios.now)}</div>
        <div className="text-sm">+1: {showShare(props.scenarios.plus1)}</div>
        <div className="text-sm">+2: {showShare(props.scenarios.plus2)}</div>
      </div>
    </section>
  )
}
