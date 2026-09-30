'use client'

import { useEffect, useState } from 'react'
import {
  changeTime24Part,
  combineTime24,
  getTime24MinuteOptions,
  isPartialTime24,
  splitTime24,
  TIME_HOURS_24,
  type Time24Parts,
} from '@/lib/time24'

type TimePicker24Props = {
  id: string
  value: string
  onChange: (value: string) => void
  name?: string
  label?: string
  locale?: 'en' | 'lt'
  required?: boolean
  disabled?: boolean
  className?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

const labels = {
  en: { time: 'Time', hour: 'Hour', minute: 'Minute' },
  lt: { time: 'Laikas', hour: 'Valanda', minute: 'Minutės' },
} as const

export function TimePicker24({
  id,
  value,
  onChange,
  name,
  label,
  locale = 'en',
  required = false,
  disabled = false,
  className = '',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: TimePicker24Props) {
  const [parts, setParts] = useState<Time24Parts>(() => splitTime24(value))
  const text = labels[locale]
  const groupLabel = label ?? text.time
  const minuteOptions = getTime24MinuteOptions(parts.minute)
  const isPartial = isPartialTime24(parts)
  const selectAriaInvalid = (ariaInvalid || isPartial) ? true : undefined

  useEffect(() => {
    setParts(splitTime24(value))
  }, [value])

  const update = (part: keyof Time24Parts, nextValue: string) => {
    const next = changeTime24Part(parts, part, nextValue)
    setParts(next.parts)
    if (!isPartialTime24(next.parts)) {
      onChange(next.value)
    }
  }

  return (
    <div
      className={`min-w-0 space-y-1.5 ${className}`.trim()}
      role="group"
      aria-labelledby={`${id}-label`}
      data-time-picker-24
    >
      <div id={`${id}-label`} className="text-xs font-medium text-slate-600">
        {groupLabel}{required && <span className="text-red-500" aria-hidden="true"> *</span>}
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
        <label className="min-w-0 space-y-1 text-xs text-slate-600" htmlFor={`${id}-hour`}>
          <span className="block">{text.hour}</span>
          <select
            id={`${id}-hour`}
            className="control-select min-h-11 min-w-0 w-full"
            value={parts.hour}
            onChange={event => update('hour', event.target.value)}
            required={required || isPartial}
            disabled={disabled}
            aria-describedby={ariaDescribedBy}
            aria-invalid={selectAriaInvalid}
            aria-label={`${groupLabel} — ${text.hour}`}
          >
            <option value="">--</option>
            {TIME_HOURS_24.map(hour => <option key={hour} value={hour}>{hour}</option>)}
          </select>
        </label>
        <span className="pb-3 text-lg font-semibold leading-none text-slate-500" aria-hidden="true">:</span>
        <label className="min-w-0 space-y-1 text-xs text-slate-600" htmlFor={`${id}-minute`}>
          <span className="block">{text.minute}</span>
          <select
            id={`${id}-minute`}
            className="control-select min-h-11 min-w-0 w-full"
            value={parts.minute}
            onChange={event => update('minute', event.target.value)}
            required={required || isPartial}
            disabled={disabled}
            aria-describedby={ariaDescribedBy}
            aria-invalid={selectAriaInvalid}
            aria-label={`${groupLabel} — ${text.minute}`}
          >
            <option value="">--</option>
            {minuteOptions.map(minute => <option key={minute} value={minute}>{minute}</option>)}
          </select>
        </label>
      </div>
      {name && (
        <input
          type="hidden"
          name={name}
          value={combineTime24(parts.hour, parts.minute)}
          disabled={disabled}
        />
      )}
    </div>
  )
}
