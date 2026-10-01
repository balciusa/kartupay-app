'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  CalendarMonth,
  dateFromKey,
  dateKey,
  monthStart,
  shiftMonth,
} from '@/components/ui/DateRangePicker'
import { formatDateFieldValue, isIsoDate } from '@/lib/dateField'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'

type DatePickerFieldProps = {
  id: string
  name: string
  value: string
  onChange: (value: string) => void
  label: string
  locale?: ProjectDateLocale
  min?: string
  required?: boolean
  disabled?: boolean
  className?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

const labels = {
  en: {
    selectDate: 'Select date',
    clearDate: 'Clear date',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
  },
  lt: {
    selectDate: 'Pasirinkti datą',
    clearDate: 'Išvalyti datą',
    previousMonth: 'Ankstesnis mėnuo',
    nextMonth: 'Kitas mėnuo',
  },
} as const

type PanelPosition = { left: number; top: number; width: number }

export function DatePickerField({
  id,
  name,
  value,
  onChange,
  label,
  locale = 'en',
  min,
  required = false,
  disabled = false,
  className = '',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: DatePickerFieldProps) {
  const text = labels[locale]
  const canonicalValue = isIsoDate(value) ? value : ''
  const formattedValue = formatDateFieldValue(canonicalValue, locale)
  const [open, setOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(new Date()))
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = `${id}-calendar`
  const labelId = `${id}-label`
  const localeName = locale === 'lt' ? 'lt-LT' : 'en-GB'
  const popupOpen = open && !disabled

  const positionPanel = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const margin = 16
    const width = Math.min(352, window.innerWidth - margin * 2)
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
    const estimatedHeight = Math.min(430, window.innerHeight - margin * 2)
    const top = window.innerHeight - rect.bottom >= estimatedHeight || rect.top < estimatedHeight
      ? Math.min(rect.bottom + 8, window.innerHeight - margin)
      : Math.max(margin, rect.top - estimatedHeight - 8)
    setPanelPosition({ left, top, width })
  }

  const openPicker = () => {
    const selected = canonicalValue ? dateFromKey(canonicalValue) : null
    const today = new Date()
    setVisibleMonth(monthStart(selected ?? new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1))))
    setOpen(true)
  }

  const closePicker = (returnFocus = false) => {
    setOpen(false)
    setPanelPosition(null)
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!popupOpen) return
    positionPanel()
    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) closePicker()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePicker(true)
      }
    }
    const reposition = () => positionPanel()
    document.addEventListener('mousedown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [popupOpen])

  const selectDate = (day: Date) => {
    onChange(dateKey(day))
    closePicker(true)
  }

  return (
    <div
      ref={rootRef}
      className={`relative min-w-0 ${className}`.trim()}
      role="group"
      aria-labelledby={labelId}
      data-date-picker-field
    >
      <input type="hidden" name={name} value={canonicalValue} disabled={disabled} />
      <input
        className="sr-only"
        tabIndex={-1}
        value={canonicalValue}
        onChange={event => {
          if (!event.target.value || isIsoDate(event.target.value)) onChange(event.target.value)
        }}
        required={required}
        disabled={disabled}
        aria-label={label}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        onInvalid={() => {
          openPicker()
          requestAnimationFrame(() => triggerRef.current?.focus())
        }}
      />
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="flex min-h-16 w-full min-w-0 items-center gap-3 rounded-xl border border-input bg-background px-3 py-2.5 text-left text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] hover:border-slate-400 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        aria-expanded={popupOpen}
        aria-controls={panelId}
        aria-haspopup="dialog"
        aria-describedby={ariaDescribedBy}
        onClick={() => popupOpen ? closePicker() : openPicker()}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden="true">
          <CalendarDays className="h-4 w-4" strokeWidth={2} />
        </span>
        <span className="min-w-0">
          <span id={labelId} className="block truncate text-xs font-medium text-slate-600">
            {label}{required && <span className="text-red-500" aria-hidden="true"> *</span>}
          </span>
          <span className={`mt-0.5 block truncate text-sm font-semibold ${formattedValue ? 'text-slate-900' : 'text-slate-500'}`}>
            {formattedValue || text.selectDate}
          </span>
        </span>
      </button>

      {popupOpen && panelPosition && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={labelId}
          className="fixed z-[60] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-xl sm:p-4"
          style={panelPosition}
        >
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label={text.previousMonth}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
              onClick={() => setVisibleMonth(current => shiftMonth(current, -1))}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="font-semibold capitalize text-slate-900">
              {new Intl.DateTimeFormat(localeName, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(visibleMonth)}
            </div>
            <button
              type="button"
              aria-label={text.nextMonth}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
              onClick={() => setVisibleMonth(current => shiftMonth(current, 1))}
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <CalendarMonth
            month={visibleMonth}
            locale={locale}
            selectedStart={canonicalValue}
            onSelect={selectDate}
            startSelectedLabel={label}
            isDayDisabled={day => Boolean(min && dateKey(day) < min)}
          />
          {!required && canonicalValue && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <button
                type="button"
                className="min-h-10 rounded-lg px-3 text-sm font-medium text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400"
                onClick={() => {
                  onChange('')
                  closePicker(true)
                }}
              >
                {text.clearDate}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
