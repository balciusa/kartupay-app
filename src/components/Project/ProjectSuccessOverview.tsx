import type { ProjectSuccessPath, SuccessAction } from '@/lib/projectSuccessPath'

import type { ProjectDateLocale } from '@/lib/projectDateStrings'
import { getProjectSuccessOverviewStrings } from '@/lib/projectSuccessOverviewStrings'

const destinations: Record<SuccessAction, string> = {
  choose_dates: '?tab=dates#date-availability',
  confirm_attendance: '?tab=dates#project-date-finder',
  review_join_requests: '?tab=admin&adminModal=requests',
  finalize_date_early: '?tab=dates#early-date-finalization',
  resolve_date: '?tab=dates#project-date-finder',
  invite_people: '?tab=people',
  review_finance: '?tab=payments',
  review_payment: '?tab=payments',
}
export function ProjectSuccessOverview({ model, projectId, locale = 'en' }: {
  model: ProjectSuccessPath
  projectId: string
  locale?: ProjectDateLocale
}) {
  const strings = getProjectSuccessOverviewStrings(locale)
  const action = model.nextAction ? {
    ...strings.actions[model.nextAction],
    detail: strings.actions[model.nextAction].detail(model),
    destination: destinations[model.nextAction],
  } : null
  const terminal = model.stage === 'canceled' || model.stage === 'finalized'
  const noActionHeading = model.stage === 'canceled' ? strings.headings.canceled
    : model.stage === 'finalized' ? strings.headings.finalized
    : model.ready ? strings.headings.ready
    : strings.noActionTitle
  const noActionDetail = model.stage === 'canceled' ? strings.details.canceled
    : model.stage === 'finalized' ? strings.details.finalized
    : model.ready ? strings.details.ready
    : strings.details.waiting

  const secondaryItems: Array<{ id: string; text: string }> = []
  const addSecondary = (id: string, text: string) => {
    if (!secondaryItems.some(item => item.text === text)) secondaryItems.push({ id, text })
  }

  if (!terminal) {
    if (model.waitingOn.dates > 0 && model.nextAction !== 'choose_dates') {
      addSecondary('dates', strings.waitingDates(model.waitingOn.dates))
    }
    if (model.waitingOn.attendance > 0 && model.nextAction !== 'confirm_attendance') {
      addSecondary('attendance', strings.waitingAttendance(model.waitingOn.attendance))
    }
    if (model.waitingOn.participants > 0 && model.nextAction !== 'invite_people') {
      addSecondary('participants', strings.waitingParticipants(model.waitingOn.participants))
    }

    const dateBlocker = model.blockers.find(blocker =>
      blocker.type === 'date' || blocker.type === 'date_all_responded' || blocker.type === 'date_tie')
    const dateActionIsPrimary = model.nextAction === 'choose_dates'
      || model.nextAction === 'finalize_date_early'
      || model.nextAction === 'resolve_date'
    if (dateBlocker && !dateActionIsPrimary && model.waitingOn.dates === 0) {
      const dateDetail = dateBlocker.type === 'date_all_responded'
        ? strings.details.date_all_responded
        : dateBlocker.type === 'date_tie'
          ? strings.details.date_tie
          : strings.details.date
      addSecondary(dateBlocker.type, dateDetail)
    }

    const financeIsPrimary = model.nextAction === 'review_finance' || model.nextAction === 'review_payment'
    if (model.blockers.some(blocker => blocker.type === 'finance') && !financeIsPrimary) {
      addSecondary('finance', strings.details.finance)
    }
  }

  return (
    <section aria-labelledby="project-overview-title" lang={locale}>
      <div>
        <h2 id="project-overview-title" className="text-2xl font-bold tracking-tight text-slate-900">
          {strings.title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{strings.intro}</p>
      </div>

      <div
        data-overview-primary
        className="mt-5 rounded-2xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50/60 p-4 shadow-sm sm:p-5"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-800">
          {strings.primaryEyebrow}
        </p>
        <div className="mt-4 flex items-start gap-3">
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-xl font-semibold text-emerald-800"
          >
            {action ? '↗' : '✓'}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-bold leading-tight text-slate-900">
              {action?.title ?? noActionHeading}
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {action?.detail ?? noActionDetail}
            </p>
          </div>
        </div>
        {action ? (
          <a
            data-primary-action={model.nextAction}
            href={`/project/${projectId}${action.destination}`}
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            {action.label}
          </a>
        ) : null}
      </div>

      <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="project-other-items-title">
        <h3 id="project-other-items-title" className="text-base font-bold text-slate-900">{strings.otherTasks}</h3>
        {secondaryItems.length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {secondaryItems.map(item => (
              <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                <span className="text-sm leading-6 text-slate-600">{item.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm leading-6 text-slate-500">{strings.noOtherTasks}</p>
        )}
      </section>

      <nav className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label={strings.otherTasks}>
        <a
          href={`/project/${projectId}?tab=people`}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:border-emerald-200 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          {strings.openGroup}
        </a>
        <a
          href={`/project/${projectId}?tab=plan`}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:border-emerald-200 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          {strings.reviewPlan}
        </a>
      </nav>
    </section>
  )
}
