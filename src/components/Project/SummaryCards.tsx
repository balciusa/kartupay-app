'use client'

function formatEur(cents: number) {
  return (cents / 100).toFixed(2)
}

export function SummaryCards(props: {
  totalCents: number
  collectedCents: number
  totalIsPerPerson: boolean
  minParticipants: number | null
  maxParticipants?: number | null
  participantsNow: number
  scenarios: { now: number; plus1: number; plus2: number }
  lateSummary?: { joinersCount: number; pendingCount: number; pendingCents: number } | null
}) {
  const totalCents = Math.max(0, Number(props.totalCents ?? 0))
  const collectedCents = Math.max(0, Number(props.collectedCents ?? 0))
  const collectedClamped = totalCents > 0 ? Math.min(collectedCents, totalCents) : collectedCents
  const progressPercent = totalCents > 0 ? Math.min(100, Math.round((collectedClamped / totalCents) * 100)) : 0
  const lateSummary = props.lateSummary ?? { joinersCount: 0, pendingCount: 0, pendingCents: 0 }
  const showLateJoiners =
    lateSummary.joinersCount > 0 || lateSummary.pendingCount > 0 || lateSummary.pendingCents > 0
  const showScenarios = !props.totalIsPerPerson
  const cardsCount = 1 + (showLateJoiners ? 1 : 0) + (showScenarios ? 1 : 0)
  const gridColsClass = cardsCount === 1 ? 'md:grid-cols-1' : cardsCount === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'
  const hasMaxParticipants = typeof props.maxParticipants === 'number' && props.maxParticipants > 0
  const maxParticipants = hasMaxParticipants ? Number(props.maxParticipants) : null
  const capacityPercent =
    hasMaxParticipants && maxParticipants
      ? Math.max(0, Math.min(100, Math.round((props.participantsNow / maxParticipants) * 100)))
      : 0
  const remainingSpots =
    hasMaxParticipants && maxParticipants ? Math.max(0, maxParticipants - props.participantsNow) : null

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm md:p-6">
      <div className="space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold text-slate-900">Funding progress</h2>
          </div>
          <p className="text-sm text-slate-600">Track how close you are to the collection target.</p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700">
                Collected EUR {formatEur(collectedClamped)}
              </span>
              <span className="text-slate-600">of EUR {formatEur(totalCents)}</span>
            </div>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-slate-900 transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-3 ${gridColsClass}`}>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-600">Participants</div>
            <div className="mt-1 flex items-end gap-2">
              <div className="text-3xl font-semibold leading-none text-slate-900">{props.participantsNow}</div>
              {hasMaxParticipants && maxParticipants ? (
                <div className="text-lg font-medium leading-none text-slate-500">/ {maxParticipants}</div>
              ) : null}
            </div>
            {hasMaxParticipants ? (
              <div className="mt-2 space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-slate-700" style={{ width: `${capacityPercent}%` }} />
                </div>
                <div className="text-sm text-slate-600">
                  {remainingSpots === 0 ? 'Capacity reached' : `${remainingSpots} spots left`}
                </div>
              </div>
            ) : (
              <div className="mt-2 text-sm text-slate-600">No max participant limit</div>
            )}
            <div className="mt-1 text-sm text-slate-600">
              {props.minParticipants != null ? `Minimum is ${props.minParticipants}` : 'No minimum set'}
            </div>
          </div>

          {showLateJoiners && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-600">Late joiners</div>
              <div className="mt-1 text-3xl font-semibold leading-none text-slate-900">{lateSummary.joinersCount}</div>
              <div className="mt-2 text-sm text-slate-600">
                {lateSummary.pendingCount} payments pending (EUR {formatEur(lateSummary.pendingCents)})
              </div>
            </div>
          )}

          {showScenarios && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-600">Per-person price scenarios</div>
              <div className="mt-2 space-y-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Current</div>
                  <div className="text-lg font-semibold leading-none text-slate-900">
                    EUR {formatEur(props.scenarios.now)}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-1.5 text-sm">
                    <span className="text-slate-600">If 1 more joins</span>
                    <span className="font-semibold text-slate-900">EUR {formatEur(props.scenarios.plus1)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-1.5 text-sm">
                    <span className="text-slate-600">If 2 more join</span>
                    <span className="font-semibold text-slate-900">EUR {formatEur(props.scenarios.plus2)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
