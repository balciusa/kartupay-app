'use client'

import { useId, useState } from 'react'
import {
  formatDateRangeDuration,
  formatProjectDateRange,
  selectDateRangeDay,
  type DateRangeDraft,
} from '@/lib/projectDateSelection'
import { getProjectDateStrings, type ProjectDateLocale } from '@/lib/projectDateStrings'

export type DateRangeValue = {
  startDate: string
  endDate: string | null
}

type DateRangePickerProps = {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  locale: ProjectDateLocale
  startName?: string
  endName?: string
  required?: boolean
}

const DAY_MS = 86_400_000

const dateKey = (date: Date) => date.toISOString().slice(0, 10)

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const dateFromKey = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))

const shiftMonth = (date: Date, amount: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1))

const calendarDays = (month: Date) => {
  const first = monthStart(month)
  const mondayOffset = (first.getUTCDay() + 6) % 7
  const gridStart = new Date(first.getTime() - mondayOffset * DAY_MS)
  return Array.from({ length: 42 }, (_, index) => new Date(gridStart.getTime() + index * DAY_MS))
}

const asIso = (value: string) => `${value}T00:00:00.000Z`

const compactRange = (value: DateRangeValue, locale: ProjectDateLocale) => {
  if (!value.startDate) return null
  return formatProjectDateRange(
    asIso(value.startDate),
    value.endDate ? asIso(value.endDate) : null,
    locale
  )
}

export function DateRangePicker({
  value,
  onChange,
  locale,
  startName,
  endName,
  required = false,
}: DateRangePickerProps) {
  const strings = getProjectDateStrings(locale)
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState<Date | null>(null)
  const [draft, setDraft] = useState<DateRangeDraft>({ startDate: '', endDate: null, complete: false })

  const localeName = locale === 'lt' ? 'lt-LT' : 'en-GB'
  const month = visibleMonth ?? new Date(Date.UTC(2000, 0, 1))
  const days = open ? calendarDays(month) : []
  const committedSummary = compactRange(value, locale)
  const draftSummary = draft.startDate && draft.complete
    ? compactRange({ startDate: draft.startDate, endDate: draft.endDate }, locale)
    : null
  const draftDuration = draft.startDate && draft.complete
    ? formatDateRangeDuration(draft.startDate, draft.endDate, locale)
    : null

  const openPicker = () => {
    const start = value.startDate ? dateFromKey(value.startDate) : null
    const today = new Date()
    const initialMonth = start ?? new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1))
    setVisibleMonth(monthStart(initialMonth))
    setDraft({
      startDate: value.startDate,
      endDate: value.endDate,
      complete: Boolean(value.startDate),
    })
    setOpen(true)
  }

  const cancel = () => {
    setOpen(false)
    setVisibleMonth(null)
  }

  const commit = (next: DateRangeValue) => {
    onChange(next)
    setOpen(false)
    setVisibleMonth(null)
  }

  const chooseDay = (day: Date) => {
    setDraft(current => selectDateRangeDay(current, dateKey(day)))
  }

  const startTimestamp = draft.startDate ? dateFromKey(draft.startDate)?.getTime() ?? null : null
  const endTimestamp = draft.endDate ? dateFromKey(draft.endDate)?.getTime() ?? null : null
  const todayKey = open ? localDateKey(new Date()) : ''

  return (
    <div className="relative space-y-1.5" data-date-range-picker>
      {startName && (
        <input
          type="hidden"
          name={startName}
          value={value.startDate}
          onChange={event => onChange({ ...value, startDate: event.currentTarget.value })}
        />
      )}
      {endName && (
        <input
          type="hidden"
          name={endName}
          value={value.endDate ?? ''}
          onChange={event => onChange({ ...value, endDate: event.currentTarget.value || null })}
        />
      )}
      <span className="block text-sm font-medium text-slate-700" id={`${panelId}-label`}>
        {strings.dates}{required && <span className="text-red-500"> *</span>}
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-labelledby={`${panelId}-label ${panelId}-summary`}
        className="control-input flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-white text-left"
        onClick={() => open ? cancel() : openPicker()}
      >
        <span id={`${panelId}-summary`} className="min-w-0">
          <span className={`block truncate font-medium ${committedSummary ? 'text-slate-900' : 'text-slate-500'}`}>
            {committedSummary ?? strings.selectDates}
          </span>
          {value.startDate && (
            <span className="mt-0.5 block text-xs text-indigo-700">
              {formatDateRangeDuration(value.startDate, value.endDate, locale)}
            </span>
          )}
        </span>
        <span aria-hidden="true" className="shrink-0 text-slate-500">▾</span>
      </button>

      {open && (
        <div id={panelId} role="dialog" aria-modal="false" aria-labelledby={`${panelId}-label`} className="z-20 w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-xl sm:max-w-sm sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label={strings.previousMonth}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-700 hover:bg-slate-50"
              onClick={() => setVisibleMonth(current => shiftMonth(current ?? month, -1))}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <div className="font-semibold capitalize text-slate-900">
              {new Intl.DateTimeFormat(localeName, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month)}
            </div>
            <button
              type="button"
              aria-label={strings.nextMonth}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-700 hover:bg-slate-50"
              onClick={() => setVisibleMonth(current => shiftMonth(current ?? month, 1))}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 text-center text-xs font-medium text-slate-500" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => {
              const monday = new Date(Date.UTC(2024, 0, 1 + index))
              return <span key={index} className="py-2">{new Intl.DateTimeFormat(localeName, { weekday: 'short', timeZone: 'UTC' }).format(monday)}</span>
            })}
          </div>
          <div
            className="grid grid-cols-7 gap-y-1"
            role="grid"
            aria-label={new Intl.DateTimeFormat(localeName, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month)}
          >
            {days.map(day => {
              const key = dateKey(day)
              const timestamp = day.getTime()
              const isStart = key === draft.startDate
              const isEnd = key === draft.endDate
              const isInRange = startTimestamp !== null && endTimestamp !== null
                && timestamp >= startTimestamp && timestamp <= endTimestamp
              const inCurrentMonth = day.getUTCMonth() === month.getUTCMonth()
              const fullLabel = new Intl.DateTimeFormat(localeName, {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
              }).format(day)
              const selectionLabel = isStart
                ? `, ${strings.startDateSelected}`
                : isEnd ? `, ${strings.endDateSelected}` : ''
              return (
                <span key={key} role="gridcell" aria-selected={isStart || isEnd || isInRange} className="min-w-0">
                  <button
                    type="button"
                    aria-label={`${fullLabel}${selectionLabel}`}
                    aria-current={key === todayKey ? 'date' : undefined}
                    className={`relative flex min-h-11 w-full min-w-0 items-center justify-center text-sm font-medium transition-colors ${
                      isStart || isEnd
                        ? 'z-10 rounded-full bg-indigo-600 text-white ring-2 ring-indigo-200'
                        : isInRange
                          ? 'bg-indigo-100 text-indigo-900'
                          : inCurrentMonth
                            ? 'rounded-full text-slate-800 hover:bg-slate-100'
                            : 'rounded-full text-slate-400 hover:bg-slate-50'
                    } ${key === todayKey && !isStart && !isEnd ? 'underline decoration-2 underline-offset-4' : ''}`}
                    onClick={() => chooseDay(day)}
                  >
                    {day.getUTCDate()}
                  </button>
                </span>
              )
            })}
          </div>

          <div className="mt-3 min-h-16 rounded-xl bg-slate-50 p-3" aria-live="polite">
            {draft.startDate ? (
              draft.complete ? (
                <>
                  <div className="text-sm font-semibold text-slate-900">{draftSummary}</div>
                  <div className="mt-0.5 text-sm text-indigo-700">{draftDuration}</div>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold text-slate-900">
                    {formatProjectDateRange(asIso(draft.startDate), null, locale)}
                  </div>
                  <div className="mt-0.5 text-sm text-slate-600">{strings.chooseEndDate}</div>
                </>
              )
            ) : <div className="text-sm text-slate-600">{strings.selectDates}</div>}
          </div>

          {draft.startDate && !draft.complete && (
            <button
              type="button"
              className="mt-3 min-h-11 w-full rounded-full border border-indigo-300 px-4 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
              onClick={() => commit({ startDate: draft.startDate, endDate: null })}
            >
              {strings.sameDay}
            </button>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              className="min-h-11 rounded-full px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:text-slate-300"
              disabled={!draft.startDate && !value.startDate}
              onClick={() => setDraft({ startDate: '', endDate: null, complete: false })}
            >
              {strings.clearDates}
            </button>
            <div className="flex gap-2">
              <button type="button" className="min-h-11 rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={cancel}>
                {strings.cancel}
              </button>
              <button
                type="button"
                className="min-h-11 rounded-full bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-slate-300"
                disabled={!draft.complete && (Boolean(draft.startDate) || !value.startDate)}
                onClick={() => commit({ startDate: draft.startDate, endDate: draft.endDate })}
              >
                {strings.done}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
