import { Users, CalendarDays } from 'lucide-react'
import { getProjectFinanceStrings } from '@/lib/projectFinanceStrings'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'

export function ProjectParticipationOverview({
  confirmedCount,
  awaitingCount,
  cannotAttendCount,
  minParticipants,
  eventDateLabel,
  locale,
  projectReady,
}: {
  confirmedCount: number
  awaitingCount: number
  cannotAttendCount: number
  minParticipants: number | null
  eventDateLabel: string | null
  locale: ProjectDateLocale
  projectReady: boolean
}) {
  const strings = getProjectFinanceStrings(locale)
  const minimum = Math.max(0, Number(minParticipants ?? 0))
  const remaining = Math.max(0, minimum - confirmedCount)
  const progress = minimum > 0 ? Math.min(100, Math.round((confirmedCount / minimum) * 100)) : 100

  return (
    <section className="surface-card p-5 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-slate-600" />
        <h2 className="text-lg font-semibold text-slate-900">{strings.projectProgress}</h2>
      </div>

      <div>
        <div className="flex items-end justify-between gap-3 text-sm">
          <span className="font-medium text-slate-900">
            {confirmedCount}{minimum > 0 ? ` / ${minimum}` : ''} {strings.confirmedParticipants}
          </span>
          <span className="text-xs text-slate-500">{progress}%</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100" aria-label={`${progress}%`}>
          <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <CalendarDays className="h-4 w-4" /> {strings.date}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-900">{eventDateLabel ?? strings.notSet}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{strings.responses}</div>
          <div className="mt-1 text-sm text-slate-800">{confirmedCount} {strings.confirmed}</div>
          {awaitingCount > 0 && <div className="text-xs text-amber-700">{awaitingCount} {strings.awaitingConfirmation}</div>}
          {cannotAttendCount > 0 && <div className="text-xs text-slate-500">{cannotAttendCount} {strings.cannotAttend}</div>}
        </div>
      </div>

      <div className={`rounded-xl border p-3 ${projectReady ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
        <div className="text-xs font-semibold uppercase tracking-wide">{strings.nextAction}</div>
        <div className="mt-1 text-sm font-medium">
          {!projectReady
            ? `${remaining === 1 ? strings.inviteMore : strings.inviteMorePlural}${remaining > 1 ? ` (${remaining})` : ''}`
            : strings.participationReady}
        </div>
      </div>
    </section>
  )
}
