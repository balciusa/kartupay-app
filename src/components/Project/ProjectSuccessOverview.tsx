import type { ProjectSuccessPath, SuccessAction } from '@/lib/projectSuccessPath'

import type { ProjectDateLocale } from '@/lib/projectDateStrings'
import { getProjectSuccessOverviewStrings } from '@/lib/projectSuccessOverviewStrings'

const destinations: Record<SuccessAction, string> = {
  choose_dates: '#date-availability',
  confirm_attendance: '#project-date-finder',
  resolve_date: '#project-date-finder',
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
  const action = model.nextAction ? { ...strings.actions[model.nextAction], destination: destinations[model.nextAction] } : null
  const terminal = model.stage === 'canceled' || model.stage === 'finalized'
  const participantDetail = model.minimum > 0
    ? strings.participantMinimum(model.confirmedParticipants, model.minimum)
    : strings.participantNoMinimum(model.confirmedParticipants)
  const heading = model.stage === 'canceled' ? strings.headings.canceled
    : model.stage === 'finalized' ? strings.headings.finalized
    : model.ready ? strings.headings.ready : strings.headings.waiting
  const details: Record<ProjectSuccessPath['blockers'][number]['type'], string> = {
    date: strings.details.date, date_tie: strings.details.date_tie,
    participants: participantDetail, finance: strings.details.finance,
  }
  // Date progress and the participant count already explain these blockers.
  // Keep specific tie/finance context unless the current action explains it.
  const supportingBlockers = model.blockers.filter(blocker =>
    blocker.type === 'date_tie' ? !!action && model.nextAction !== 'resolve_date'
      : blocker.type === 'finance' && model.nextAction !== 'review_finance' && model.nextAction !== 'review_payment'
  )

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:p-5" aria-label={strings.region} lang={locale}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{strings.projectStatus}</h2>
        <span className="text-sm text-slate-600">{strings.health[model.health]}</span>
      </div>
      {model.visibleStages.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-2" aria-label={strings.relevantStages}>
          {model.visibleStages.map(stage => (
            <li key={stage.id} aria-current={stage.state === 'current' ? 'step' : undefined}
              className="flex items-center gap-1.5 text-sm">
              <span className="font-medium text-slate-900">{strings.stages[stage.id]}</span>
              <span className={`rounded-md px-1.5 py-0.5 text-xs ${stage.state === 'complete' ? 'bg-emerald-100 text-emerald-800' : stage.state === 'current' ? 'bg-indigo-100 text-indigo-800' : 'text-slate-500'}`}>{strings.stageStates[stage.state]}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 border-t border-slate-200/80 pt-4">
        {!action && <h3 className="text-sm font-semibold text-slate-700">{heading}</h3>}
        {action ? (
          <>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">{action.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{action.detail}</p>
            <a href={action.destination.startsWith('#') ? action.destination : `/project/${projectId}${action.destination}`}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
              {action.label}
            </a>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-700">
            {model.stage === 'canceled' ? strings.details.canceled
              : model.stage === 'finalized' ? strings.details.finalized
              : model.ready ? strings.details.ready
              : model.stage === 'date' ? model.blockers.some(blocker => blocker.type === 'date_tie')
                ? strings.details.date_tie
                : strings.details.date
              : model.waitingOn.participants > 0 ? strings.waitingParticipants(model.waitingOn.participants)
              : strings.details.waiting}
          </p>
        )}
        {!terminal && <p className="mt-3 text-sm text-slate-600">{participantDetail}</p>}
        {!terminal && !action && (model.waitingOn.dates > 0 || model.waitingOn.attendance > 0) && (
          <p className="mt-3 text-sm text-slate-600">
            {strings.waitingPeople(model.waitingOn.dates + model.waitingOn.attendance)}
            {model.waitingOn.dates > 0 ? ` ${strings.waitingDates(model.waitingOn.dates)}` : ''}
            {model.waitingOn.attendance > 0 ? ` ${strings.waitingAttendance(model.waitingOn.attendance)}` : ''}
          </p>
        )}
        {supportingBlockers.map(blocker => <p key={blocker.type} className="mt-2 text-sm text-slate-600">{details[blocker.type]}</p>)}
      </div>
    </section>
  )
}
