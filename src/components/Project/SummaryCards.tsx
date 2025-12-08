'use client'
import { useMemo } from 'react'

function eur(c: number) {
  return (c/100).toFixed(2)
}

export function SummaryCards(props: {
  totalCents: number
  minParticipants: number
  participantsNow: number
  scenarios: { now: number, plus1: number, plus2: number }
  deadlineISO: string
}) {
  const progress = useMemo(() => {
    const pct = Math.min(100, Math.round(100 * props.participantsNow / (props.minParticipants || 1)))
    return isFinite(pct) ? pct : 0
  }, [props.participantsNow, props.minParticipants])

  const deadlineDisplay = useMemo(() => {
    const date = new Date(props.deadlineISO)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString('en-GB', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }, [props.deadlineISO])

  const showShare = (cents: number) =>
    props.participantsNow > 0 ? `€${eur(cents)}/person` : '—'

  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="border rounded-xl p-4">
        <div className="text-xs uppercase opacity-60">Total</div>
        <div className="text-2xl font-semibold">€{eur(props.totalCents)}</div>
        <div className="text-xs opacity-60">Deadline: {deadlineDisplay}</div>
      </div>

      <div className="border rounded-xl p-4">
        <div className="text-xs uppercase opacity-60">Participant Threshold</div>
        <div className="text-2xl font-semibold">{props.participantsNow} / {props.minParticipants}</div>
        <div className="h-2 bg-black/10 rounded mt-2">
          <div className="h-2 bg-black/70 rounded" style={{ width: `${progress}%` }} />
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
