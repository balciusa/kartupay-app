'use client'

import { useMemo, useState } from 'react'
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
  const today = new Date()
  const initial = dateFromKey(value[0] || min || localDateKey(today)) ?? today
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(initial))
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

  const toggle = (day: Date) => {
    const selected = dateKey(day)
    if (value.includes(selected)) {
      onChange(value.filter(candidate => candidate !== selected))
      return
    }
    if (single) {
      onChange([selected])
      return
    }
    if (value.length < max) onChange([...value, selected].sort())
  }

  return (
    <div className="space-y-3" data-event-date-candidate-picker>
      {value.map(start => <input key={start} type="hidden" name={name} value={start} />)}
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label={strings.previousMonth} onClick={() => setVisibleMonth(current => shiftMonth(current, -1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <strong className="text-sm text-slate-900">
            {new Intl.DateTimeFormat(localeName, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(visibleMonth)}
          </strong>
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label={strings.nextMonth} onClick={() => setVisibleMonth(current => shiftMonth(current, 1))}>
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
        {spans.map(span => (
          <div key={span.start} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
            <div>
              <div className="text-sm font-semibold text-indigo-950">{formatSpan(span.start, span.end, locale)}</div>
              <div className="text-xs text-indigo-700">{durationLabel}</div>
            </div>
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full text-indigo-700 hover:bg-indigo-100 focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label={`${strings.removeDate}: ${formatSpan(span.start, span.end, locale)}`} onClick={() => onChange(value.filter(candidate => candidate !== span.start))}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {!single && <p className="text-xs text-slate-600">{value.length}/{max}</p>}
    </div>
  )
}
