import Link from 'next/link'

function formatCurrency(cents: number) {
  const normalized = Math.max(0, Number(cents ?? 0))
  return `EUR ${(normalized / 100).toFixed(2)}`
}

type PendingOverviewCardsProps = {
  readinessScore: number
  participantsNow: number
  minParticipants: number | null
  maxParticipants: number | null
  pendingRequestsCount: number | null
  pendingRequestsHref?: string | null
  minParticipantsReached: boolean
  collectorPaymentOptionsCount: number
  pollCount: number
  resolvedPollCount: number
  unresolvedPollCount: number
  hasEventWindow: boolean
  hasEventLocation: boolean
  totalIsPerPerson: boolean
  scenarios: {
    now: number
    atMinimum: number
    plus1: number
    plus2: number
  }
}

type CheckItem = {
  label: string
  hint: string
  ok: boolean
}

export function PendingOverviewCards(props: PendingOverviewCardsProps) {
  const minParticipants = typeof props.minParticipants === 'number' && props.minParticipants > 0
    ? props.minParticipants
    : null
  const maxParticipants = typeof props.maxParticipants === 'number' && props.maxParticipants > 0
    ? props.maxParticipants
    : null

  const participantsToMinimum = minParticipants ? Math.max(0, minParticipants - props.participantsNow) : 0
  const toMinimumPercent = minParticipants
    ? Math.max(0, Math.min(100, Math.round((props.participantsNow / minParticipants) * 100)))
    : 100
  const toCapacityPercent = maxParticipants
    ? Math.max(0, Math.min(100, Math.round((props.participantsNow / maxParticipants) * 100)))
    : null
  const spotsLeft = maxParticipants ? Math.max(0, maxParticipants - props.participantsNow) : null

  const requiredChecks: CheckItem[] = [
    {
      label: 'Minimum participants reached',
      hint: minParticipants
        ? `${props.participantsNow}/${minParticipants} participants`
        : 'No minimum target configured',
      ok: props.minParticipantsReached || !minParticipants,
    },
  ]

  const recommendedChecks: CheckItem[] = [
    {
      label: 'Collector payment method active',
      hint: props.collectorPaymentOptionsCount > 0
        ? `${props.collectorPaymentOptionsCount} active option(s)`
        : 'Add at least one payment method',
      ok: props.collectorPaymentOptionsCount > 0,
    },
    {
      label: 'Required poll votes reached',
      hint: props.pollCount === 0
        ? 'No polls to resolve'
        : `${props.resolvedPollCount}/${props.pollCount} poll(s) resolved`,
      ok: props.unresolvedPollCount === 0,
    },
    {
      label: 'Event details completed',
      hint: props.hasEventWindow && props.hasEventLocation
        ? 'Date/time and location are set'
        : !props.hasEventWindow && !props.hasEventLocation
          ? 'Add date/time and location'
          : !props.hasEventWindow
            ? 'Add date/time'
            : 'Add location',
      ok: props.hasEventWindow && props.hasEventLocation,
    },
  ]

  const requiredBlockers = requiredChecks.filter(item => !item.ok).length
  const recommendedLeft = recommendedChecks.filter(item => !item.ok).length
  const readinessSummary = requiredBlockers > 0
    ? `${requiredBlockers} required check${requiredBlockers === 1 ? '' : 's'} left before collection can start.`
    : recommendedLeft > 0
      ? `Ready to start collecting. ${recommendedLeft} recommended improvement${recommendedLeft === 1 ? '' : 's'} left.`
      : 'Ready to start collecting.'

  const minimumScenarioLabel = minParticipants ? `At minimum (${minParticipants})` : 'At current size'
  const pendingRequestsLabel = props.pendingRequestsCount == null ? 'Collector view only' : `${props.pendingRequestsCount}`
  const pendingRequestsCanOpenModal =
    typeof props.pendingRequestsCount === 'number' &&
    props.pendingRequestsCount > 0 &&
    !!props.pendingRequestsHref

  return (
    <section className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/70 to-white p-5 shadow-sm md:p-6">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-2xl font-semibold leading-none text-amber-700">
            !
          </div>
          <div className="space-y-0.5">
            <h2 className="text-2xl font-semibold text-slate-900">Pending Readiness</h2>
            <p className="text-sm text-slate-600">Track what will move this project from pending to collecting.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-white p-4 md:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm text-slate-600">Readiness score</div>
              <div className="text-3xl font-semibold leading-none text-slate-900">{props.readinessScore}%</div>
            </div>
            <div className="text-sm text-slate-600">{readinessSummary}</div>
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-amber-100">
            <div className="h-full rounded-full bg-amber-500/80 transition-all" style={{ width: `${props.readinessScore}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-600">Participant funnel</div>
            <div className="mt-2 text-3xl font-semibold leading-none text-slate-900">{props.participantsNow}</div>
            <div className="mt-2 text-sm text-slate-600">
              Min: {minParticipants ?? 'none'} | Max: {maxParticipants ?? 'none'}
            </div>

            <div className="mt-3 space-y-2.5">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Progress to minimum</span>
                  <span>{toMinimumPercent}%</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-emerald-500/75" style={{ width: `${toMinimumPercent}%` }} />
                </div>
                <div className="text-xs text-slate-500">
                  {participantsToMinimum > 0 ? `${participantsToMinimum} more needed` : 'Minimum reached'}
                </div>
              </div>

              {toCapacityPercent != null && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Capacity used</span>
                    <span>{toCapacityPercent}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-slate-500/70" style={{ width: `${toCapacityPercent}%` }} />
                  </div>
                  <div className="text-xs text-slate-500">
                    {spotsLeft === 0 ? 'Capacity reached' : `${spotsLeft} spot(s) left`}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-3 border-t border-slate-200 pt-3 text-sm text-slate-600">
              Pending requests:{' '}
              {pendingRequestsCanOpenModal ? (
                <Link
                  href={props.pendingRequestsHref ?? '#'}
                  className="font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800"
                >
                  {pendingRequestsLabel}
                </Link>
              ) : (
                <span className="font-semibold text-slate-900">{pendingRequestsLabel}</span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-600">Start-collecting checks</div>
            <div className="mt-3 space-y-2">
              {requiredChecks.map(item => (
                <div key={item.label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-900">{item.label}</span>
                    <span className={item.ok ? 'text-emerald-700' : 'text-rose-700'}>
                      {item.ok ? 'OK' : 'Required'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{item.hint}</div>
                </div>
              ))}

              <div className="pt-1 text-xs uppercase tracking-wide text-slate-500">Recommended</div>

              {recommendedChecks.map(item => (
                <div key={item.label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-900">{item.label}</span>
                    <span className={item.ok ? 'text-emerald-700' : 'text-amber-700'}>
                      {item.ok ? 'OK' : 'Recommended'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{item.hint}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-600">Budget scenarios</div>
            <div className="mt-1 text-xs text-slate-500">
              {props.totalIsPerPerson
                ? 'Per-person amount is fixed by project settings.'
                : 'Per-person amount drops as more participants join.'}
            </div>
            <div className="mt-3 space-y-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Current</div>
                <div className="text-lg font-semibold text-slate-900">{formatCurrency(props.scenarios.now)}</div>
              </div>
              <div className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-1.5 text-sm">
                <span className="text-slate-600">{minimumScenarioLabel}</span>
                <span className="font-semibold text-slate-900">{formatCurrency(props.scenarios.atMinimum)}</span>
              </div>
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
      </div>
    </section>
  )
}
