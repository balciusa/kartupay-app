import type { ProjectSuccessPath, SuccessAction } from '@/lib/projectSuccessPath'

const actions: Record<SuccessAction, { title: string; detail: string; label: string; destination: string }> = {
  choose_dates: { title: 'Choose your available dates', detail: 'Your response helps the group choose a date.', label: 'Choose dates', destination: '#date-availability' },
  confirm_attendance: { title: 'Confirm your attendance', detail: 'The final date is selected. Let the group know if you can attend.', label: 'Confirm attendance', destination: '#project-date-finder' },
  resolve_date: { title: 'Choose the final date', detail: 'Date Finder has an exact tie that needs your decision.', label: 'Choose final date', destination: '#project-date-finder' },
  invite_people: { title: 'Invite more people', detail: 'Share the project link with people you would like to join.', label: 'Review participants', destination: '?tab=people' },
  review_finance: { title: 'Review Finance', detail: 'Review the existing payment controls and outstanding base contributions.', label: 'Review payments', destination: '?tab=payments' },
  review_payment: { title: 'Review your payment', detail: 'Your base contribution is still outstanding.', label: 'Go to payments', destination: '?tab=payments' },
}
const labels = { date: 'Date', participants: 'Participants', finance: 'Finance', ready: 'Ready' }
const healthLabels = { on_track: 'Waiting for progress', needs_attention: 'Needs your attention', blocked: 'Needs attention', ready: 'Ready', canceled: 'Canceled', finalized: 'Finalized' }

export function ProjectSuccessOverview({ model, projectId }: { model: ProjectSuccessPath; projectId: string }) {
  const action = model.nextAction ? actions[model.nextAction] : null
  const terminal = model.stage === 'canceled' || model.stage === 'finalized'
  const participantDetail = model.minimum > 0
    ? `${model.confirmedParticipants} of ${model.minimum} required participants confirmed.`
    : `${model.confirmedParticipants} participants confirmed. No minimum configured.`
  const heading = model.stage === 'canceled' ? 'Project canceled'
    : model.stage === 'finalized' ? 'Project finalized'
    : model.ready ? 'Project ready' : 'Waiting on the group'
  const details: Record<ProjectSuccessPath['blockers'][number]['type'], string> = {
    date: 'Final date not selected.', date_tie: 'Date Finder needs an organizer decision.',
    participants: participantDetail, finance: 'Base contributions are not yet settled.',
  }
  // Date progress and the participant count already explain these blockers.
  // Keep specific tie/finance context unless the current action explains it.
  const supportingBlockers = model.blockers.filter(blocker =>
    blocker.type === 'date_tie' ? !!action && model.nextAction !== 'resolve_date'
      : blocker.type === 'finance' && model.nextAction !== 'review_finance' && model.nextAction !== 'review_payment'
  )

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:p-5" aria-label="Project success path">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Project status</h2>
        <span className="text-sm text-slate-600">{healthLabels[model.health]}</span>
      </div>
      {model.visibleStages.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-2" aria-label="Relevant project stages">
          {model.visibleStages.map(stage => (
            <li key={stage.id} aria-current={stage.state === 'current' ? 'step' : undefined}
              className="flex items-center gap-1.5 text-sm">
              <span className="font-medium text-slate-900">{labels[stage.id]}</span>
              <span className={`rounded-md px-1.5 py-0.5 text-xs ${stage.state === 'complete' ? 'bg-emerald-100 text-emerald-800' : stage.state === 'current' ? 'bg-indigo-100 text-indigo-800' : 'text-slate-500'}`}>{stage.state === 'complete' ? 'Complete' : stage.state === 'current' ? 'Current' : 'Upcoming'}</span>
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
            {model.stage === 'canceled' ? 'This project was canceled. There is no next action.'
              : model.stage === 'finalized' ? 'The participant list is finalized and base contributions are frozen.'
              : model.ready ? 'All relevant project requirements are met.'
              : model.stage === 'date' ? model.blockers.some(blocker => blocker.type === 'date_tie')
                ? 'Waiting for the organizer to choose the final date.'
                : 'Waiting for Date Finder to select the final date.'
              : model.waitingOn.participants > 0 ? `Waiting for ${model.waitingOn.participants} more confirmed participants.`
              : 'You have no required action right now. The group is still working toward readiness.'}
          </p>
        )}
        {!terminal && <p className="mt-3 text-sm text-slate-600">{participantDetail}</p>}
        {!terminal && !action && (model.waitingOn.dates > 0 || model.waitingOn.attendance > 0) && (
          <p className="mt-3 text-sm text-slate-600">
            Waiting on {model.waitingOn.dates + model.waitingOn.attendance} people:
            {model.waitingOn.dates > 0 ? ` ${model.waitingOn.dates} to choose dates.` : ''}
            {model.waitingOn.attendance > 0 ? ` ${model.waitingOn.attendance} to confirm attendance.` : ''}
          </p>
        )}
        {supportingBlockers.map(blocker => <p key={blocker.type} className="mt-2 text-sm text-slate-600">{details[blocker.type]}</p>)}
      </div>
    </section>
  )
}
