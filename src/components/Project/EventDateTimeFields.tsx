'use client'

import { useState } from 'react'
import { CalendarDays, Plus, X } from 'lucide-react'
import { DatePickerField } from '@/components/ui/DatePickerField'
import { TimePicker24 } from '@/components/ui/TimePicker24'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'
import { deriveEndDate } from '@/lib/projectEventDuration'
import { formatDateFieldValue } from '@/lib/dateField'

type EventDateTimeFieldsProps = {
  idPrefix: string
  locale: ProjectDateLocale
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  onStartDateChange: (value: string) => void
  onStartTimeChange: (value: string) => void
  onEndDateChange: (value: string) => void
  onEndTimeChange: (value: string) => void
  startRequired?: boolean
  durationBacked?: boolean
  durationNights?: number | null
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

const labels = {
  en: {
    eventStarts: 'Event starts',
    eventEnds: 'Event ends',
    optional: 'optional',
    startDate: 'Start date',
    startTime: 'Start time',
    endDate: 'End date',
    endTime: 'End time',
    addEnd: 'End date and time',
    removeEnd: 'Remove end date and time',
    derivedEnd: 'Derived from the start date and event duration',
  },
  lt: {
    eventStarts: 'Renginio pradžia',
    eventEnds: 'Renginio pabaiga',
    optional: 'nebūtina',
    startDate: 'Pradžios data',
    startTime: 'Pradžios laikas',
    endDate: 'Pabaigos data',
    endTime: 'Pabaigos laikas',
    addEnd: 'Pabaigos data ir laikas',
    removeEnd: 'Pašalinti pabaigos datą ir laiką',
    derivedEnd: 'Apskaičiuota pagal pradžios datą ir renginio trukmę',
  },
} as const

export function EventDateTimeFields({
  idPrefix,
  locale,
  startDate,
  startTime,
  endDate,
  endTime,
  onStartDateChange,
  onStartTimeChange,
  onEndDateChange,
  onEndTimeChange,
  startRequired = false,
  durationBacked = false,
  durationNights = null,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: EventDateTimeFieldsProps) {
  const text = labels[locale]
  const [endExpanded, setEndExpanded] = useState(() => Boolean(endDate || endTime))
  const derivedEndDate = durationBacked && startDate && durationNights !== null
    ? deriveEndDate(startDate, durationNights)
    : ''

  const removeEnd = () => {
    onEndDateChange('')
    onEndTimeChange('')
    setEndExpanded(false)
  }

  return (
    <div className="space-y-4" data-event-date-time-fields>
      <section className="space-y-2" aria-labelledby={`${idPrefix}-start-heading`}>
        <h4 id={`${idPrefix}-start-heading`} className="text-sm font-semibold text-slate-900">
          {text.eventStarts}
          {!startRequired && <span className="ml-1 font-normal text-muted-foreground">({text.optional})</span>}
        </h4>
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <DatePickerField
            id={`${idPrefix}-start-date`}
            name="event_start_date"
            value={startDate}
            onChange={onStartDateChange}
            label={text.startDate}
            locale={locale}
            required={startRequired}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
          />
          <TimePicker24
            id={`${idPrefix}-start-time`}
            name="event_start_time"
            value={startTime}
            onChange={onStartTimeChange}
            label={text.startTime}
            locale={locale}
            stepMinutes={15}
            required={startRequired}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
          />
        </div>
      </section>

      {durationBacked ? (
        <section className="space-y-2" aria-labelledby={`${idPrefix}-end-heading`}>
          <h4 id={`${idPrefix}-end-heading`} className="text-sm font-semibold text-slate-900">
            {text.eventEnds}
            <span className="ml-1 font-normal text-muted-foreground">({text.optional})</span>
          </h4>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex min-h-[68px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5" data-derived-end-date>
              <CalendarDays className="h-5 w-5 shrink-0 text-indigo-600" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-500">{text.endDate}</div>
                <div className="truncate text-sm font-semibold text-slate-900">
                  {derivedEndDate ? formatDateFieldValue(derivedEndDate, locale) : '—'}
                </div>
                <div className="sr-only">{text.derivedEnd}</div>
              </div>
            </div>
            <TimePicker24
              id={`${idPrefix}-end-time`}
              name="event_end_time"
              value={endTime}
              onChange={onEndTimeChange}
              label={text.endTime}
              locale={locale}
              stepMinutes={15}
              aria-describedby={ariaDescribedBy}
              aria-invalid={ariaInvalid}
            />
          </div>
          <input type="hidden" name="event_end_date" value={derivedEndDate} />
          <p className="text-xs text-slate-600">{text.derivedEnd}</p>
        </section>
      ) : endExpanded ? (
        <section className="space-y-2" aria-labelledby={`${idPrefix}-end-heading`}>
          <div className="flex items-center justify-between gap-3">
            <h4 id={`${idPrefix}-end-heading`} className="text-sm font-semibold text-slate-900">
              {text.eventEnds}
              <span className="ml-1 font-normal text-muted-foreground">({text.optional})</span>
            </h4>
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400"
              onClick={removeEnd}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {text.removeEnd}
            </button>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <DatePickerField
              id={`${idPrefix}-end-date`}
              name="event_end_date"
              value={endDate}
              onChange={onEndDateChange}
              label={text.endDate}
              locale={locale}
              min={startDate || undefined}
              aria-describedby={ariaDescribedBy}
              aria-invalid={ariaInvalid}
            />
            <TimePicker24
              id={`${idPrefix}-end-time`}
              name="event_end_time"
              value={endTime}
              onChange={onEndTimeChange}
              label={text.endTime}
              locale={locale}
              stepMinutes={15}
              aria-describedby={ariaDescribedBy}
              aria-invalid={ariaInvalid}
            />
          </div>
        </section>
      ) : (
        <>
          <input type="hidden" name="event_end_date" value="" />
          <input type="hidden" name="event_end_time" value="" />
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3.5 text-sm font-medium text-indigo-700 outline-none transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
            aria-expanded="false"
            onClick={() => setEndExpanded(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {text.addEnd}
          </button>
        </>
      )}
    </div>
  )
}
