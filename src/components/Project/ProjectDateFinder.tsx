'use client'

import { FormEvent, useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronDown, Clock3, Plus, Star, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  chooseTiedProjectDate,
  lateConfirmProjectAttendance,
  removeProjectDateOption,
  respondToDateConfirmation,
  selectProjectDateEarly,
  sendProjectDateReminders,
  setDateConfirmationDeadline,
  setProjectDateResponse,
  setSelectedProjectTimes,
  stayProjectObserver,
  suggestProjectDateOption,
} from '@/app/project/[id]/actions'
import { LeaveProjectButton } from '@/components/Project/LeaveProjectButton'
import { Button } from '@/components/ui/button'
import { DateRangePicker, type DateRangeValue } from '@/components/ui/DateRangePicker'
import {
  deriveProjectDatePresentationState,
  formatDateRangeDuration,
  formatProjectDateRange,
  isDateOnlyTimestamp,
  normalizeDateOnlyOption,
  type DateAvailability,
} from '@/lib/projectDateSelection'
import type { ProjectDateFinderData, ProjectDateFinderOption } from '@/lib/projectDateService'
import { getProjectDateStrings, type ProjectDateLocale } from '@/lib/projectDateStrings'

const statusClasses: Record<DateAvailability, string> = {
  available: 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  maybe: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100',
  unavailable: 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100',
}

const selectedStatusClasses: Record<DateAvailability, string> = {
  available: 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700',
  maybe: 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600',
  unavailable: 'border-red-600 bg-red-600 text-white hover:bg-red-700',
}

const toDateTimeIso = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date and time')
  return date.toISOString()
}

const formatDateOption = (option: Pick<ProjectDateFinderOption, 'starts_at' | 'ends_at'>, locale: ProjectDateLocale) =>
  formatProjectDateRange(option.starts_at, option.ends_at, locale)

function DateOptionHeading({
  option,
  locale,
  className = '',
}: {
  option: Pick<ProjectDateFinderOption, 'starts_at' | 'ends_at'>
  locale: ProjectDateLocale
  className?: string
}) {
  return (
    <span className={className}>
      <span className="block">{formatDateOption(option, locale)}</span>
      <span className="mt-0.5 block text-sm font-medium text-indigo-700">
        {formatDateRangeDuration(option.starts_at, option.ends_at, locale)}
      </span>
    </span>
  )
}

const timeInputValue = (value: string | null) => {
  if (!value || isDateOnlyTimestamp(value)) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const formatDeadline = (value: string, locale: ProjectDateLocale) =>
  new Intl.DateTimeFormat(locale === 'lt' ? 'lt-LT' : 'en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(value))

function SuggestDateForm({
  projectId,
  locale,
  onDone,
}: {
  projectId: string
  locale: ProjectDateLocale
  onDone: () => void
}) {
  const strings = getProjectDateStrings(locale)
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [dates, setDates] = useState<DateRangeValue>({ startDate: '', endDate: null })

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      setPending(true)
      setError(null)
      const startDate = String(form.get('start_date') ?? '')
      const endDate = String(form.get('end_date') ?? '')
      const normalized = normalizeDateOnlyOption(startDate, endDate || null)
      form.set('starts_at', normalized.startsAt)
      if (normalized.endsAt) form.set('ends_at', normalized.endsAt)
      await suggestProjectDateOption(projectId, form)
      router.refresh()
      onDone()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to suggest date'
      setError(message.includes('already been suggested') ? strings.dateAlreadySuggested : message)
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <DateRangePicker
        value={dates}
        onChange={setDates}
        locale={locale}
        startName="start_date"
        endName="end_date"
        required
      />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={onDone}>{strings.cancel}</Button>
        <Button type="submit" className="min-h-11 rounded-full" disabled={pending}>{strings.addDate}</Button>
      </div>
    </form>
  )
}

export function ProjectDateFinder({
  projectId,
  data,
  viewerUserId,
  viewerIsParticipant,
  canManage,
  locale,
  dateActionShown = false,
}: {
  projectId: string
  data: ProjectDateFinderData
  viewerUserId: string | null
  viewerIsParticipant: boolean
  canManage: boolean
  locale: ProjectDateLocale
  /** True only when the visible Success Path already shows the personal date action. */
  dateActionShown?: boolean
}) {
  const strings = getProjectDateStrings(locale)
  const router = useRouter()
  const [suggesting, setSuggesting] = useState(false)
  const [editingTime, setEditingTime] = useState(false)
  const [selectingEarly, setSelectingEarly] = useState(false)
  const [earlyOptionId, setEarlyOptionId] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const now = Date.now()
  const votingOpen = data.dateMode === 'selecting' && data.selectionStatus === 'open'
  const suggestionsOpen = votingOpen && !!data.suggestionsCloseAt && new Date(data.suggestionsCloseAt).getTime() > now
  const tiedDecision = data.selectionStatus === 'awaiting_organizer_decision'
  const visibleOptions = useMemo(
    () => data.options.filter(option => option.status === 'active' && (!tiedDecision || option.isTied)),
    [data.options, tiedDecision]
  )
  const selectedOption = data.options.find(option => option.id === data.selectedDateOptionId)
  const activeOptions = data.options.filter(option => option.status === 'active')
  const earlyOption = earlyOptionId ? activeOptions.find(option => option.id === earlyOptionId) : null
  const hasAvailabilityResponses = activeOptions.some(option =>
    option.availableCount + option.maybeCount + option.unavailableCount > 0
  )
  const showBestOption = activeOptions.length >= 2 && hasAvailabilityResponses
  const presentationState = deriveProjectDatePresentationState({
    dateMode: data.dateMode,
    selectionStatus: data.selectionStatus,
    selectedDateOptionId: data.selectedDateOptionId,
    respondedCount: data.respondedCount,
    memberCount: data.memberCount,
  })
  const canFinalizeEarly = presentationState === 'all_responded'
    && canManage
    && votingOpen
    && activeOptions.length > 0
  const canRemoveOption = (option: ProjectDateFinderOption) => votingOpen
    && (canManage || (option.created_by_user_id === viewerUserId && option.otherResponseCount === 0))
  const canEditOwnAvailability = votingOpen && viewerIsParticipant && visibleOptions.length > 0
  const canSuggestAnotherDate = suggestionsOpen && viewerIsParticipant
  const canEditAllResponded = canEditOwnAvailability
    || canSuggestAnotherDate
    || visibleOptions.some(canRemoveOption)

  const run = async (key: string, action: () => Promise<unknown>) => {
    setPendingKey(key)
    setError(null)
    try {
      await action()
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save date selection')
    } finally {
      setPendingKey(null)
    }
  }

  const respond = (option: ProjectDateFinderOption, availability: DateAvailability) =>
    run(`response-${option.id}`, () =>
      setProjectDateResponse(
        projectId,
        option.id,
        availability,
        availability === 'available' && option.viewerPreferred
      )
    )

  const renderOptions = ({
    interactive,
    anchor,
    earlyFinalization = false,
  }: {
    interactive: boolean
    anchor: boolean
    earlyFinalization?: boolean
  }) => (
    <div
      id={anchor ? 'date-availability' : undefined}
      role="region"
      aria-label={strings.chooseDatesHelp}
      tabIndex={anchor ? -1 : undefined}
      data-current-result={!interactive ? true : undefined}
      className="space-y-3 scroll-mt-24 rounded-xl target:outline-2 target:outline-offset-4 target:outline-indigo-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400"
    >
      {visibleOptions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">{strings.noDateOptions}</div>
      ) : visibleOptions.map(option => {
        const isBest = showBestOption && option.isCurrentlyBest
        const hasResponses = option.availableCount + option.maybeCount + option.unavailableCount > 0
        return (
          <article key={option.id} className={`rounded-xl p-3 sm:p-4 ${isBest ? 'bg-emerald-50/60' : option.isTied && hasAvailabilityResponses ? 'bg-amber-50/40' : 'bg-slate-50/80'}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900"><DateOptionHeading option={option} locale={locale} /></h3>
                  {isBest && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">{strings.currentlyBest}</span>}
                  {option.isTied && hasAvailabilityResponses && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">{strings.currentlyTied}</span>}
                </div>
                <p className="mt-1 text-xs text-slate-500">{strings.suggestedBy} {option.suggestedBy}</p>
                {hasResponses && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span className="text-emerald-700"><strong>{option.availableCount}</strong> {strings.available.toLowerCase()}</span>
                  <span className="text-amber-700"><strong>{option.maybeCount}</strong> {strings.maybe.toLowerCase()}</span>
                  <span className="text-red-700"><strong>{option.unavailableCount}</strong> {strings.unavailable.toLowerCase()}</span>
                  <span className="text-indigo-700"><strong>{option.preferredCount}</strong> {strings.preferred.toLowerCase()}</span>
                </div>}
              </div>
              {interactive && canRemoveOption(option) && (
                <Button type="button" variant="outline" className="min-h-11 rounded-full text-red-700" disabled={!!pendingKey} onClick={() => {
                  if (window.confirm(`${strings.removeDate}?`)) void run(`remove-${option.id}`, () => removeProjectDateOption(projectId, option.id))
                }}><Trash2 className="mr-2 h-4 w-4" /> {strings.removeDate}</Button>
              )}
            </div>

            {interactive && viewerIsParticipant && votingOpen && (
              <div className="mt-4 flex flex-wrap gap-2">
                {(['available', 'maybe', 'unavailable'] as DateAvailability[]).map(status => (
                  <Button
                    key={status}
                    type="button"
                    variant="outline"
                    disabled={!!pendingKey}
                    aria-pressed={option.viewerAvailability === status}
                    className={`min-h-11 rounded-full ${option.viewerAvailability === status ? selectedStatusClasses[status] : statusClasses[status]}`}
                    onClick={() => void respond(option, status)}
                  >
                    {option.viewerAvailability === status && <Check className="mr-1.5 h-4 w-4" />}
                    {status === 'available' ? strings.available : status === 'maybe' ? strings.maybe : strings.unavailable}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!pendingKey || option.viewerAvailability !== 'available'}
                  aria-pressed={option.viewerPreferred}
                  className={`min-h-11 rounded-full ${option.viewerPreferred ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700' : 'border-indigo-300 text-indigo-700'}`}
                  onClick={() => void run(`preferred-${option.id}`, () => setProjectDateResponse(projectId, option.id, 'available', !option.viewerPreferred))}
                >
                  <Star className={`mr-1.5 h-4 w-4 ${option.viewerPreferred ? 'fill-current' : ''}`} /> {strings.preferred}
                </Button>
              </div>
            )}

            {tiedDecision && canManage && (
              <Button className="mt-4 min-h-11 rounded-full" disabled={!!pendingKey} onClick={() => void run(`select-${option.id}`, () => chooseTiedProjectDate(projectId, option.id))}>{strings.selectDate}</Button>
            )}
            {earlyFinalization && canFinalizeEarly && (
              <Button
                type="button"
                variant={earlyOptionId === option.id ? 'default' : 'outline'}
                className="mt-4 min-h-11 rounded-full"
                disabled={!!pendingKey}
                aria-pressed={earlyOptionId === option.id}
                onClick={() => setEarlyOptionId(option.id)}
              >
                {earlyOptionId === option.id && <Check className="mr-1.5 h-4 w-4" />}
                {strings.chooseFinalDate}
              </Button>
            )}
          </article>
        )
      })}
    </div>
  )

  if (data.dateMode === 'fixed' && !data.selectedDateOptionId) return null

  if (data.dateMode === 'fixed') {
    const shortfall = Math.max(0, Number(data.minParticipants ?? 0) - data.confirmedCount)
    const needsConfirmation = data.viewerAttendanceStatus === 'awaiting_confirmation'
    const canLateJoin = ['cannot_attend', 'unconfirmed', 'observer'].includes(data.viewerAttendanceStatus ?? '')
    const atCapacity = !!data.maxParticipants && data.confirmedCount >= data.maxParticipants
    const confirmedDateOption = {
      starts_at: data.eventStartAt || selectedOption?.starts_at || '',
      ends_at: data.eventEndAt ?? selectedOption?.ends_at ?? null,
    }
    const hasProjectTime = !!data.eventStartAt && !isDateOnlyTimestamp(data.eventStartAt)
    return (
      <section data-date-state={presentationState} className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CalendarDays className="h-4 w-4" /> {strings.projectDate}
            </div>
            <h2 className="text-xl font-semibold text-slate-900">
              {confirmedDateOption.starts_at ? <DateOptionHeading option={confirmedDateOption} locale={locale} /> : ''}
            </h2>
            <p className="text-sm text-slate-600">{strings.confirmedParticipants}: {data.confirmedCount}</p>
            {data.confirmationDeadlineAt && data.awaitingCount > 0 && (
              <p className="text-sm text-slate-600">{strings.confirmationDeadline}: {formatDeadline(data.confirmationDeadlineAt, locale)}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">
              <Check className="h-4 w-4" /> {strings.dateConfirmed}
            </div>
            {data.unreadNotificationCount > 0 && (
              <div className="rounded-full bg-indigo-100 px-3 py-1.5 text-xs font-medium text-indigo-800">
                {strings.notifications}: {data.unreadNotificationCount}
              </div>
            )}
          </div>
        </div>

        <details data-secondary-controls className="group mt-4 rounded-xl border border-slate-200 bg-slate-50/60">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-slate-800">
            {strings.viewDateDetails}
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-slate-200 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-emerald-50 p-3"><div className="text-2xl font-semibold text-emerald-800">{data.confirmedCount}</div><div className="text-xs text-emerald-700">{strings.confirmed}</div></div>
          <div className="rounded-xl bg-amber-50 p-3"><div className="text-2xl font-semibold text-amber-800">{data.awaitingCount}</div><div className="text-xs text-amber-700">{strings.awaitingConfirmation}</div></div>
          <div className="rounded-xl bg-red-50 p-3"><div className="text-2xl font-semibold text-red-800">{data.cannotAttendCount}</div><div className="text-xs text-red-700">{strings.cannotAttend}</div></div>
        </div>

        {data.minParticipants ? (
          <div className="mt-3 text-sm text-slate-700">
            {strings.minimumParticipants}: <span className="font-semibold">{data.minParticipants}</span>
            {shortfall > 0 && <span className="ml-2 text-amber-700">{shortfall} {shortfall === 1 ? strings.moreNeeded : strings.moreNeededPlural}</span>}
          </div>
        ) : null}

        {canManage && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">{strings.projectTime}</h3>
                {!hasProjectTime && <p className="mt-1 text-sm text-slate-600">{strings.timeNotSet}</p>}
              </div>
              {!editingTime && (
                <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={() => setEditingTime(true)}>
                  <Clock3 className="mr-2 h-4 w-4" /> {hasProjectTime ? strings.editTime : strings.addTime}
                </Button>
              )}
            </div>

            {editingTime && (
              <form
                className="mt-4 space-y-3"
                onSubmit={event => {
                  event.preventDefault()
                  const payload = new FormData(event.currentTarget)
                  payload.set('timezone_offset_minutes', String(new Date().getTimezoneOffset()))
                  void run('project-time', async () => {
                    await setSelectedProjectTimes(projectId, payload)
                    setEditingTime(false)
                  })
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    {strings.startTime}
                    <input
                      name="start_time"
                      type="time"
                      required
                      className="control-input min-h-11"
                      defaultValue={timeInputValue(data.eventStartAt)}
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    {strings.endTimeOptional}
                    <input
                      name="end_time"
                      type="time"
                      className="control-input min-h-11"
                      defaultValue={timeInputValue(data.eventEndAt)}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {hasProjectTime && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 rounded-full text-red-700"
                      disabled={!!pendingKey}
                      onClick={() => {
                        const payload = new FormData()
                        payload.set('timezone_offset_minutes', String(new Date().getTimezoneOffset()))
                        void run('project-time-clear', async () => {
                          await setSelectedProjectTimes(projectId, payload)
                          setEditingTime(false)
                        })
                      }}
                    >
                      {strings.clearTime}
                    </Button>
                  )}
                  <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={!!pendingKey} onClick={() => setEditingTime(false)}>
                    {strings.cancel}
                  </Button>
                  <Button type="submit" className="min-h-11 rounded-full" disabled={!!pendingKey}>
                    {strings.saveTime}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
          </div>
        </details>

        {needsConfirmation && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">{strings.priorityTask}</div>
            <h3 className="mt-1 font-semibold text-slate-900">{strings.canYouAttend}</h3>
            <div className="mt-1 text-sm text-slate-700">
              <span>{strings.finalProjectDate}:</span>
              {confirmedDateOption.starts_at ? <DateOptionHeading option={confirmedDateOption} locale={locale} className="mt-1" /> : ''}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button className="min-h-11 rounded-full bg-emerald-600 hover:bg-emerald-700" disabled={!!pendingKey} onClick={() => run('confirm-yes', () => respondToDateConfirmation(projectId, 'yes'))}>{strings.yesAttend}</Button>
              <Button variant="outline" className="min-h-11 rounded-full border-red-300 text-red-700" disabled={!!pendingKey} onClick={() => run('confirm-no', () => respondToDateConfirmation(projectId, 'no'))}>{strings.noAttend}</Button>
              <Button variant="outline" className="min-h-11 rounded-full" disabled={!!pendingKey} onClick={() => run('confirm-maybe', () => respondToDateConfirmation(projectId, 'still_dont_know'))}>{strings.stillDontKnow}</Button>
            </div>
          </div>
        )}

        {canLateJoin && viewerIsParticipant && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">{strings.selectedDateDoesNotWork}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button className="min-h-11 rounded-full" disabled={atCapacity || !!pendingKey} onClick={() => run('late-join', () => lateConfirmProjectAttendance(projectId))}>{strings.joinProject}</Button>
              {data.viewerAttendanceStatus !== 'observer' && <Button variant="outline" className="min-h-11 rounded-full" disabled={!!pendingKey} onClick={() => run('observer', () => stayProjectObserver(projectId))}>{strings.stayObserver}</Button>}
              <LeaveProjectButton projectId={projectId} />
            </div>
            {atCapacity && <p className="mt-2 text-xs text-red-700">{strings.projectFull}</p>}
          </div>
        )}

        {canManage && data.awaitingCount > 0 && (
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">{strings.awaitingNames}: {data.awaitingCount}</h3>
                <p className="mt-1 text-sm text-slate-600">{data.awaitingNames.join(', ')}</p>
              </div>
              <Button variant="outline" className="min-h-11 rounded-full" disabled={!!pendingKey} onClick={() => run('confirmation-reminder', () => sendProjectDateReminders(projectId, 'confirmation'))}>{strings.sendReminder}</Button>
            </div>
            <form
              className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={event => {
                event.preventDefault()
                const value = String(new FormData(event.currentTarget).get('confirmation_deadline') ?? '')
                void run('deadline', () => setDateConfirmationDeadline(projectId, toDateTimeIso(value)))
              }}
            >
              <label className="flex-1 space-y-1 text-sm font-medium text-slate-700">
                {strings.confirmationDeadline}
                <input name="confirmation_deadline" type="datetime-local" required className="control-input min-h-11" />
              </label>
              <Button type="submit" variant="outline" className="min-h-11 rounded-full" disabled={!!pendingKey}>{strings.saveDeadline}</Button>
            </form>
          </div>
        )}
        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      </section>
    )
  }

  return (
    <section data-date-state={presentationState} className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-indigo-700"><CalendarDays className="h-4 w-4" /> {strings.projectDate}</div>
          <h2 className="text-xl font-semibold text-slate-900">
            {presentationState === 'all_responded'
              ? strings.everyoneResponded
              : presentationState === 'organizer_decision_required'
                ? strings.organizerDecision
                : strings.chooseProjectDate}
          </h2>
          {data.unreadNotificationCount > 0 && (
            <span className="inline-flex rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-800">
              {strings.notifications}: {data.unreadNotificationCount}
            </span>
          )}
        </div>
        <div className="space-y-1 text-sm text-slate-600 sm:text-right">
          <div className="font-medium text-slate-900">{data.respondedCount} / {data.memberCount} {strings.responded}</div>
          {data.votingDeadlineAt && <div className="flex items-center gap-1 sm:justify-end"><Clock3 className="h-4 w-4" /> {presentationState === 'all_responded' ? strings.votingCloses : strings.ends} {formatDeadline(data.votingDeadlineAt, locale)}</div>}
        </div>
      </div>

      {presentationState === 'collecting_responses' && !dateActionShown && viewerIsParticipant && !data.viewerTaskComplete && votingOpen && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">{strings.priorityTask}</div>
          <h3 className="mt-1 font-semibold text-slate-900">{strings.chooseDates}</h3>
          <p className="mt-1 text-sm text-slate-700">{strings.projectDateUndecided} {strings.chooseDatesHelp}</p>
          <Button asChild className="mt-3 min-h-11 rounded-full"><a href="#date-availability">{strings.chooseDates}</a></Button>
        </div>
      )}

      {tiedDecision && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="font-semibold text-amber-900">{strings.organizerDecision}</h3>
          <p className="mt-1 text-sm text-amber-800">{canManage ? strings.organizerDecisionHelp : strings.waitingForOrganizerDecision}</p>
        </div>
      )}

      {presentationState === 'all_responded' && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">{strings.currentResult}</h3>
          <div className="mt-3">{renderOptions({ interactive: false, anchor: true, earlyFinalization: selectingEarly })}</div>
          <p className="mt-3 text-sm text-slate-600">
            {activeOptions.some(option => option.isTied) ? strings.tiedUntilDeadlineHelp : strings.allRespondedHelp}
          </p>
          {canFinalizeEarly && (
            <div id="early-date-finalization" className="mt-4 scroll-mt-24 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4">
              <p className="text-sm text-slate-700">{strings.everyoneRespondedOrganizerHelp}</p>
              {!selectingEarly ? (
                <Button type="button" className="mt-3 min-h-11 rounded-full" onClick={() => setSelectingEarly(true)}>
                  {strings.selectFinalDateNow}
                </Button>
              ) : earlyOption ? (
                <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-4" role="group" aria-labelledby="confirm-final-date-title">
                  <h4 id="confirm-final-date-title" className="font-semibold text-slate-900">{strings.confirmFinalDateTitle}</h4>
                  <DateOptionHeading option={earlyOption} locale={locale} className="mt-1 text-sm font-medium text-slate-800" />
                  <p className="mt-1 text-sm text-slate-600">{strings.confirmFinalDateHelp}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 rounded-full"
                      disabled={!!pendingKey}
                      onClick={() => {
                        setEarlyOptionId(null)
                        setSelectingEarly(false)
                      }}
                    >
                      {strings.cancel}
                    </Button>
                    <Button
                      type="button"
                      className="min-h-11 rounded-full"
                      disabled={!!pendingKey}
                      onClick={() => void run(`early-select-${earlyOption.id}`, async () => {
                        try {
                          await selectProjectDateEarly(projectId, earlyOption.id)
                        } finally {
                          router.refresh()
                        }
                      })}
                    >
                      {strings.confirmFinalDate}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-600">{strings.chooseFinalDate}</p>
              )}
              <p className="mt-3 text-xs text-slate-600">{strings.waitForDeadline}</p>
            </div>
          )}
          {!canManage && <p className="mt-3 text-sm text-slate-600">{strings.everyoneRespondedParticipantHelp}</p>}
          {canEditAllResponded && (
            <details data-secondary-controls className="group mt-4 rounded-xl border border-slate-200 bg-slate-50/60">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-slate-800">
                {strings.editResponsesAndOptions}
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-200 p-4">
                {renderOptions({ interactive: true, anchor: false })}
                <p className="mt-3 text-xs text-slate-500">{strings.preferredHelp}</p>
                {suggestionsOpen && viewerIsParticipant && !suggesting && (
                  <Button type="button" variant="outline" className="mt-4 min-h-11 rounded-full" onClick={() => setSuggesting(true)}><Plus className="mr-2 h-4 w-4" /> {strings.suggestAnother}</Button>
                )}
                {suggesting && <div className="mt-4"><SuggestDateForm projectId={projectId} locale={locale} onDone={() => setSuggesting(false)} /></div>}
                {!suggestionsOpen && votingOpen && <p className="mt-4 text-sm text-slate-600">{strings.suggestionsClosed}</p>}
              </div>
            </details>
          )}
        </div>
      )}

      {presentationState !== 'all_responded' && (
        <div className="mt-5">{renderOptions({ interactive: true, anchor: true })}</div>
      )}

      {presentationState !== 'all_responded' && (
        <>
          <p className="mt-3 text-xs text-slate-500">{strings.preferredHelp}</p>
          {suggestionsOpen && viewerIsParticipant && !suggesting && (
            <Button type="button" variant="outline" className="mt-4 min-h-11 rounded-full" onClick={() => setSuggesting(true)}><Plus className="mr-2 h-4 w-4" /> {strings.suggestAnother}</Button>
          )}
          {suggesting && <div className="mt-4"><SuggestDateForm projectId={projectId} locale={locale} onDone={() => setSuggesting(false)} /></div>}
          {!suggestionsOpen && votingOpen && <p className="mt-4 text-sm text-slate-600">{strings.suggestionsClosed}</p>}
        </>
      )}

      {canManage && votingOpen && data.missingResponseNames.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-700">{strings.missingResponses}: {data.missingResponseNames.length}</h3>
              <p className="mt-1 break-words text-sm text-slate-600">{data.missingResponseNames.join(', ')}</p>
            </div>
            {data.missingResponseNames.length > 0 && <Button variant="outline" className="min-h-11 rounded-full" disabled={!!pendingKey} onClick={() => void run('voting-reminder', () => sendProjectDateReminders(projectId, 'voting'))}>{strings.sendReminder}</Button>}
          </div>
        </div>
      )}

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    </section>
  )
}
