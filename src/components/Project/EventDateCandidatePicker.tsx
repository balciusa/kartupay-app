'use client'

import { useId, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  CalendarMonth,
  dateFromKey,
  dateKey,
  localDateKey,
  monthStart,
  shiftMonth,
} from '@/components/ui/DateRangePicker'
import { deriveCandidateDateKeys, deriveEndDate, formatEventDuration } from '@/lib/projectEventDuration'
import { getProjectDateStrings, type ProjectDateLocale } from '@/lib/projectDateStrings'

type EventDateCandidatePickerProps = {
  locale: ProjectDateLocale
  durationNights: number
  value: string[]
  onChange: (value: string[]) => void
  name?: string
  max?: number
  single?: boolean
  min?: string
}

const formatSpan = (start: string, end: string, locale: ProjectDateLocale) => {
  const localeName = locale === 'lt' ? 'lt-LT' : 'en-GB'
  const formatter = new Intl.DateTimeFormat(localeName, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const formattedStart = formatter.format(dateFromKey(start)!)
  return start === end ? formattedStart : `${formattedStart} – ${formatter.format(dateFromKey(end)!)}`
}

export function EventDateCandidatePicker({
  locale,
  durationNights,
  value,
  onChange,
  name = 'date_option_start_date',
  max = 20,
  single = false,
  min,
}: EventDateCandidatePickerProps) {
  const strings = getProjectDateStrings(locale)
  const invalidCandidatesId = useId()
  const today = new Date()
  const initial = dateFromKey((min && value.find(candidate => candidate >= min)) || min || value[0] || localDateKey(today)) ?? today
  const [calendarMonthState, setCalendarMonthState] = useState(() => ({ month: monthStart(initial), min }))
  const minimumMonth = min ? dateFromKey(min) : null
  const visibleMonth = calendarMonthState.min === min || !minimumMonth
    ? calendarMonthState.month
    : calendarMonthState.month.getTime() < monthStart(minimumMonth).getTime()
      ? monthStart(minimumMonth)
      : calendarMonthState.month
  const localeName = locale === 'lt' ? 'lt-LT' : 'en-GB'
  const durationLabel = formatEventDuration(durationNights, locale)
  const spans = useMemo(() => value.map(start => ({
    start,
    end: deriveEndDate(start, durationNights),
  })), [durationNights, value])
  const coveredDateKeys = useMemo(() => Array.from(new Set(spans.flatMap(span =>
    deriveCandidateDateKeys(span.start, durationNights).slice(1)
  ))), [durationNights, spans])
  const coverageEndDateKeys = useMemo(() => spans.filter(span => span.end !== span.start).map(span => span.end), [spans])
  const invalidStarts = useMemo(() => min ? value.filter(start => start < min) : [], [min, value])
  const minLabel = min ? formatSpan(min, min, locale) : ''

  const changeVisibleMonth = (amount: number) => {
    setCalendarMonthState({ month: shiftMonth(visibleMonth, amount), min })
  }

  const toggle = (day: Date) => {
    const selected = dateKey(day)
    if (value.includes(selected)) {
      onChange(value.filter(candidate => candidate !== selected))
      return
    }
    if (min && selected < min) return
    if (single) {
      onChange([selected])
      return
    }
    if (value.length < max) onChange([...value, selected].sort())
  }

  return (
    <div
      className="min-w-0 space-y-3"
      data-event-date-candidate-picker
      role="group"
      aria-invalid={invalidStarts.length > 0 || undefined}
      aria-describedby={invalidStarts.length > 0 ? invalidCandidatesId : undefined}
    >
      {value.map(start => <input key={start} type="hidden" name={name} value={start} aria-invalid={min ? start < min : undefined} />)}
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label={strings.previousMonth} onClick={() => changeVisibleMonth(-1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <strong className="text-sm text-slate-900">
            {new Intl.DateTimeFormat(localeName, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(visibleMonth)}
          </strong>
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label={strings.nextMonth} onClick={() => changeVisibleMonth(1)}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <CalendarMonth
          month={visibleMonth}
          locale={locale}
          onSelect={toggle}
          selectedDateKeys={value}
          coveredDateKeys={coveredDateKeys}
          coverageEndDateKeys={coverageEndDateKeys}
          selectedDayLabel={locale === 'lt' ? 'pasirinkta pradžios data' : 'selected start date'}
          isDayDisabled={min ? day => dateKey(day) < min : undefined}
        />
      </div>
      <div className="space-y-2" aria-live="polite">
        {spans.map(span => {
          const invalid = min ? span.start < min : false
          return (
          <div key={span.start} data-invalid-candidate={invalid || undefined} className={`min-w-0 rounded-xl border px-3 py-2 ${invalid ? 'border-red-300 bg-red-50' : 'border-indigo-200 bg-indigo-50'}`}>
            <div className="flex min-h-11 min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <div className={`text-sm font-semibold ${invalid ? 'text-red-950' : 'text-indigo-950'}`}>{formatSpan(span.start, span.end, locale)}</div>
                <div className={`text-xs ${invalid ? 'text-red-700' : 'text-indigo-700'}`}>{durationLabel}</div>
              </div>
              <button type="button" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 ${invalid ? 'text-red-700 hover:bg-red-100 focus-visible:ring-red-400' : 'text-indigo-700 hover:bg-indigo-100 focus-visible:ring-indigo-400'}`} aria-label={`${strings.removeDate}: ${formatSpan(span.start, span.end, locale)}`} onClick={() => onChange(value.filter(candidate => candidate !== span.start))}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {invalid && (
              <p className="mt-1 text-xs font-medium text-red-700" role="alert">
                {locale === 'lt'
                  ? `Renginys prasideda dar nepasibaigus balsavimui. Pasirinkite pradžios datą nuo ${minLabel}.`
                  : `This event starts before voting ends. Choose a start date from ${minLabel} onward.`}
              </p>
            )}
          </div>
        )})}
      </div>
      {invalidStarts.length > 0 && (
        <p id={invalidCandidatesId} className="sr-only">
          {locale === 'lt' ? 'Viena ar daugiau pasirinktų datų yra negalimos.' : 'One or more selected dates are invalid.'}
        </p>
      )}
      {!single && <p className="text-xs text-slate-600">{value.length}/{max}</p>}
    </div>
  )
}
