'use client'

import { useMemo, useState } from 'react'
import { formatEventDuration, MAX_EVENT_DURATION_NIGHTS } from '@/lib/projectEventDuration'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'

type EventDurationFieldProps = {
  id: string
  value: number | null
  onChange: (value: number | null) => void
  locale: ProjectDateLocale
  disabled?: boolean
  required?: boolean
  helpText?: string
}

const COMMON_DURATIONS = Array.from({ length: 8 }, (_, value) => value)

export function EventDurationField({
  id,
  value,
  onChange,
  locale,
  disabled = false,
  required = false,
  helpText,
}: EventDurationFieldProps) {
  const isCommon = value !== null && COMMON_DURATIONS.includes(value)
  const [custom, setCustom] = useState(() => value !== null && !isCommon)
  const text = locale === 'lt'
    ? { label: 'Renginio trukmė', select: 'Pasirinkite trukmę', custom: 'Kita trukmė', nights: 'Naktys' }
    : { label: 'Event duration', select: 'Select duration', custom: 'Custom duration', nights: 'Nights' }
  const selectValue = custom ? 'custom' : value === null ? '' : String(value)
  const options = useMemo(() => COMMON_DURATIONS.map(duration => ({
    value: duration,
    label: formatEventDuration(duration, locale),
  })), [locale])

  return (
    <div className="space-y-1.5" data-event-duration-field>
      <label htmlFor={id} className="text-sm font-medium text-slate-900">
        {text.label}{required && <span className="ml-1 text-red-500">*</span>}
      </label>
      <select
        id={id}
        className="control-input min-h-11"
        value={selectValue}
        disabled={disabled}
        required={required}
        onChange={event => {
          if (event.target.value === 'custom') {
            setCustom(true)
            if (value === null || isCommon) onChange(8)
            return
          }
          setCustom(false)
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }}
      >
        <option value="" disabled>{text.select}</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        <option value="custom">{text.custom}</option>
      </select>
      {custom && (
        <label className="block text-xs font-medium text-slate-700">
          {text.nights}
          <input
            className="control-input mt-1 min-h-11"
            type="number"
            min={0}
            max={MAX_EVENT_DURATION_NIGHTS}
            step={1}
            value={value ?? ''}
            disabled={disabled}
            required={required}
            onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value))}
          />
        </label>
      )}
      <input type="hidden" name="event_duration_nights" value={value ?? ''} />
      {helpText && <p className="text-xs text-slate-600">{helpText}</p>}
    </div>
  )
}
