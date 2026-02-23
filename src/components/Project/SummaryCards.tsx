'use client'

function formatEur(cents: number) {
  return (cents / 100).toFixed(2)
}

function formatCurrency(cents: number) {
  return `\u20AC${formatEur(cents)}`
}

export function SummaryCards(props: {
  totalCents: number
  collectedCents: number
  totalIsPerPerson: boolean
  minParticipants: number | null
  maxParticipants?: number | null
  participantsNow: number
  scenarios: { now: number; plus1: number; plus2: number }
  extrasSummary?: {
    targetCents: number
    collectedCents: number
    grandTotalTargetCents: number
    grandTotalCollectedCents: number
    perPersonTargetCents: number
    perPersonCollectedCents: number
  } | null
  lateSummary?: { joinersCount: number; pendingCount: number; pendingCents: number } | null
}) {
  const baseTotalCents = Math.max(0, Number(props.totalCents ?? 0))
  const baseCollectedCents = Math.max(0, Number(props.collectedCents ?? 0))
  const extrasSummary = props.extrasSummary
    ? {
        targetCents: Math.max(0, Number(props.extrasSummary.targetCents ?? 0)),
        collectedCents: Math.max(0, Number(props.extrasSummary.collectedCents ?? 0)),
        grandTotalTargetCents: Math.max(0, Number(props.extrasSummary.grandTotalTargetCents ?? 0)),
        grandTotalCollectedCents: Math.max(0, Number(props.extrasSummary.grandTotalCollectedCents ?? 0)),
        perPersonTargetCents: Math.max(0, Number(props.extrasSummary.perPersonTargetCents ?? 0)),
        perPersonCollectedCents: Math.max(0, Number(props.extrasSummary.perPersonCollectedCents ?? 0)),
      }
    : null

  const totalCents = baseTotalCents + (extrasSummary?.targetCents ?? 0)
  const collectedCents = baseCollectedCents + (extrasSummary?.collectedCents ?? 0)
  const collectedClamped = totalCents > 0 ? Math.min(collectedCents, totalCents) : collectedCents
  const progressPercent = totalCents > 0 ? Math.min(100, Math.round((collectedClamped / totalCents) * 100)) : 0

  const baseCollectedClamped =
    baseTotalCents > 0 ? Math.min(baseCollectedCents, baseTotalCents) : baseCollectedCents
  const baseProgressPercent =
    baseTotalCents > 0 ? Math.min(100, Math.round((baseCollectedClamped / baseTotalCents) * 100)) : 0

  const extrasCollectedClamped =
    extrasSummary && extrasSummary.targetCents > 0
      ? Math.min(extrasSummary.collectedCents, extrasSummary.targetCents)
      : (extrasSummary?.collectedCents ?? 0)
  const extrasProgressPercent =
    extrasSummary && extrasSummary.targetCents > 0
      ? Math.min(100, Math.round((extrasCollectedClamped / extrasSummary.targetCents) * 100))
      : 0

  const lateSummary = props.lateSummary ?? { joinersCount: 0, pendingCount: 0, pendingCents: 0 }
  const showLateJoiners =
    lateSummary.joinersCount > 0 || lateSummary.pendingCount > 0 || lateSummary.pendingCents > 0
  const showExtras = !!extrasSummary && extrasSummary.targetCents > 0
  const showScenarios = !props.totalIsPerPerson
  const cardsCount = 1 + (showLateJoiners ? 1 : 0) + (showExtras ? 1 : 0) + (showScenarios ? 1 : 0)
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
    <section className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-100 p-5 shadow-sm md:p-6">
      <div className="space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-2xl font-semibold leading-none text-teal-700">
              $
            </div>
            <h2 className="text-2xl font-semibold text-slate-900">Funding Progress</h2>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 md:p-5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="text-3xl font-semibold leading-none text-slate-900">
              {formatCurrency(collectedClamped)} / {formatCurrency(totalCents)}
            </div>
            <div className="pb-0.5 text-sm text-slate-600 md:text-base">collected</div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-slate-600 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="w-12 text-right text-3xl font-medium leading-none text-slate-700">{progressPercent}%</div>
          </div>

          <div className="mt-4 space-y-2.5">
            <div className="space-y-1.5">
              <div className="text-sm text-slate-700">
                Base: {formatCurrency(baseCollectedClamped)} / {formatCurrency(baseTotalCents)}
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-slate-600 transition-all"
                    style={{ width: `${baseProgressPercent}%` }}
                  />
                </div>
                <div className="w-11 text-right text-sm text-slate-500">{baseProgressPercent}%</div>
              </div>
            </div>

            {showExtras && extrasSummary ? (
              <div className="space-y-1.5">
                <div className="text-sm text-slate-700">
                  Extras: {formatCurrency(extrasCollectedClamped)} / {formatCurrency(extrasSummary.targetCents)}
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-slate-400 transition-all"
                      style={{ width: `${extrasProgressPercent}%` }}
                    />
                  </div>
                  <div className="w-11 text-right text-sm text-slate-500">{extrasProgressPercent}%</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-3 ${gridColsClass}`}>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/85 p-5">
            <div className="text-2xl font-semibold leading-none text-slate-900">Participants</div>
            <div className="mt-3 flex items-end gap-2">
              <div className="text-4xl font-semibold leading-none text-slate-900">{props.participantsNow}</div>
              {hasMaxParticipants && maxParticipants ? (
                <div className="text-4xl font-semibold leading-none text-slate-700">/ {maxParticipants}</div>
              ) : null}
            </div>
            {hasMaxParticipants ? (
              <div className="mt-4 space-y-2">
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-teal-500/70" style={{ width: `${capacityPercent}%` }} />
                </div>
                <div className="text-2xl font-semibold leading-none text-slate-900">
                  {remainingSpots === 0 ? 'Capacity reached' : `${remainingSpots} spots left`}
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-600">No max participant limit</div>
            )}
            <div className="mt-1 text-xl leading-none text-slate-500">
              {props.minParticipants != null ? `Minimum is ${props.minParticipants}` : 'No minimum set'}
            </div>
            <div className="mt-5 border-t border-slate-200" />
          </div>

          {showLateJoiners && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-600">Late joiners</div>
              <div className="mt-1 text-3xl font-semibold leading-none text-slate-900">{lateSummary.joinersCount}</div>
              <div className="mt-2 text-sm text-slate-600">
                {lateSummary.pendingCount} payments pending ({formatCurrency(lateSummary.pendingCents)})
              </div>
            </div>
          )}

          {showExtras && extrasSummary && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/85 p-5">
              <div className="text-2xl font-semibold leading-none text-slate-900">Extras</div>
              <div className="mt-4 text-4xl font-semibold leading-none text-slate-900">
                EUR {formatEur(extrasSummary.collectedCents)}
              </div>
              <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-teal-500/70" style={{ width: `${extrasProgressPercent}%` }} />
              </div>
              <div className="mt-3 text-xl leading-none text-slate-500">
                of EUR {formatEur(extrasSummary.targetCents)}
              </div>
              <div className="mt-5 border-t border-slate-200" />
            </div>
          )}

          {showScenarios && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-600">Per-person price scenarios</div>
              <div className="mt-2 space-y-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Current</div>
                  <div className="text-lg font-semibold leading-none text-slate-900">
                    {formatCurrency(props.scenarios.now)}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-1.5 text-sm">
                    <span className="text-slate-600">If 1 more joins</span>
                    <span className="font-semibold text-slate-900">{formatCurrency(props.scenarios.plus1)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-1.5 text-sm">
                    <span className="text-slate-600">If 2 more join</span>
                    <span className="font-semibold text-slate-900">{formatCurrency(props.scenarios.plus2)}</span>
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
