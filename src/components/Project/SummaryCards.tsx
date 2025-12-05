'use client'
import { useMemo, useState, useEffect } from 'react'

export function SummaryCards(props: {
  totalCents: number
  minParticipants: number
  participantsNow: number
  scenarios: { now: number; plus1: number; plus2: number }
  deadlineISO: string
}) {
  const eur = (c: number) => (c / 100).toFixed(2)
  const progress = useMemo(() => {
    const pct = Math.min(100, Math.round((100 * props.participantsNow) / props.minParticipants))
    return isFinite(pct) ? pct : 0
  }, [props.participantsNow, props.minParticipants])

  const [formattedDate, setFormattedDate] = useState<string | null>(null)
  
  useEffect(() => {
    setFormattedDate(new Date(props.deadlineISO).toLocaleString())
  }, [props.deadlineISO])

  // Use a consistent format for SSR to avoid hydration mismatch
  const fallbackDate = useMemo(() => {
    const date = new Date(props.deadlineISO)
    return date.toISOString().replace('T', ' ').slice(0, 19)
  }, [props.deadlineISO])

  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="border rounded-xl p-4">
        <div className="text-xs uppercase opacity-60">Total</div>
        <div className="text-2xl font-semibold">€{eur(props.totalCents)}</div>
        <div className="text-xs opacity-60">Deadline: {formattedDate ?? fallbackDate}</div>
      </div>
      <div className="border rounded-xl p-4">
        <div className="text-xs uppercase opacity-60">Participant Threshold</div>
        <div className="text-2xl font-semibold">
          {props.participantsNow} / {props.minParticipants}
        </div>
        <div className="h-2 bg-black/10 rounded mt-2">
          <div className="h-2 bg-black/70 rounded" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="border rounded-xl p-4">
        <div className="text-xs uppercase opacity-60">Scenarios</div>
        <div className="text-sm">Now: €{eur(props.scenarios.now)}</div>
        <div className="text-sm">+1: €{eur(props.scenarios.plus1)}</div>
        <div className="text-sm">+2: €{eur(props.scenarios.plus2)}</div>
      </div>
    </section>
  )
}
