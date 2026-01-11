'use client'

function eur(c: number) {
  return (c / 100).toFixed(2)
}

export function SummaryCards(props: {
  totalCents: number
  minParticipants: number | null
  participantsNow: number
  scenarios: { now: number; plus1: number; plus2: number }
  maxParticipants?: number | null
  collectorLabel?: string | null
  lateSummary?: { joinersCount: number; pendingCount: number; pendingCents: number } | null
}) {
  const showShare = (cents: number) => (props.participantsNow > 0 ? `€${eur(cents)}/person` : '-')

  return (
    <section className="border rounded-2xl bg-white p-4">
      <div
        className={`grid grid-cols-1 gap-4 ${
          props.lateSummary ? 'md:grid-cols-4' : 'md:grid-cols-3'
        }`}
      >
        <div className="border rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total</div>
          <div className="text-2xl font-semibold text-slate-900">€{eur(props.totalCents)}</div>
          {typeof props.maxParticipants === 'number' && (
            <div className="text-sm text-slate-600">Max: {props.maxParticipants}</div>
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
        {props.lateSummary && (
          <div className="border rounded-xl p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Late joiners</div>
            <div className="text-sm text-slate-700">Count: {props.lateSummary.joinersCount}</div>
            <div className="text-sm text-slate-700">Pending payments: {props.lateSummary.pendingCount}</div>
            <div className="text-sm text-slate-700">Due: €{eur(props.lateSummary.pendingCents)}</div>
          </div>
        )}
      </div>
    </section>
  )
}
