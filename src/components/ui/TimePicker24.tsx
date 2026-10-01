'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { getTime24Options, isTime24 } from '@/lib/time24'

type TimePicker24Props = {
  id: string
  value: string
  onChange: (value: string) => void
  name?: string
  label?: string
  locale?: 'en' | 'lt'
  stepMinutes?: number
  required?: boolean
  disabled?: boolean
  className?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

const labels = {
  en: { time: 'Time', selectTime: 'Select time', clearTime: 'Clear time' },
  lt: { time: 'Laikas', selectTime: 'Pasirinkti laiką', clearTime: 'Išvalyti laiką' },
} as const

export function TimePicker24({
  id,
  value,
  onChange,
  name,
  label,
  locale = 'en',
  stepMinutes = 5,
  required = false,
  disabled = false,
  className = '',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: TimePicker24Props) {
  const text = labels[locale]
  const fieldLabel = label ?? text.time
  const canonicalValue = isTime24(value) ? value : ''
  const options = useMemo(
    () => getTime24Options(stepMinutes, canonicalValue),
    [canonicalValue, stepMinutes]
  )
  const selectedIndex = canonicalValue ? options.indexOf(canonicalValue) : -1
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef(new Map<string, HTMLButtonElement>())
  const listboxId = `${id}-listbox`
  const labelId = `${id}-label`
  const popupOpen = open && !disabled

  const closeAndFocusTrigger = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!popupOpen) return
    const frame = requestAnimationFrame(() => {
      const option = optionRefs.current.get(canonicalValue || options[0])
      option?.scrollIntoView({ block: 'center' })
      option?.focus({ preventScroll: true })
    })
    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndFocusTrigger()
    }
    document.addEventListener('mousedown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [canonicalValue, options, popupOpen])

  const choose = (nextValue: string) => {
    onChange(nextValue)
    closeAndFocusTrigger()
  }

  const moveActive = (nextIndex: number) => {
    const normalizedIndex = Math.max(0, Math.min(options.length - 1, nextIndex))
    setActiveIndex(normalizedIndex)
    const option = optionRefs.current.get(options[normalizedIndex])
    option?.focus()
    option?.scrollIntoView({ block: 'nearest' })
  }

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndFocusTrigger()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(activeIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(activeIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      moveActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      moveActive(options.length - 1)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`relative min-w-0 ${className}`.trim()}
      role="group"
      aria-labelledby={labelId}
      data-time-picker-24
      data-step-minutes={stepMinutes}
    >
      {name && <input type="hidden" name={name} value={canonicalValue} disabled={disabled} />}
      <input
        className="sr-only"
        tabIndex={-1}
        value={value}
        onChange={event => {
          if (!event.target.value || isTime24(event.target.value)) onChange(event.target.value)
        }}
        required={required || Boolean(value && !canonicalValue)}
        pattern="(?:[01]\d|2[0-3]):[0-5]\d"
        disabled={disabled}
        aria-label={fieldLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        onInvalid={() => {
          setOpen(true)
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
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-describedby={ariaDescribedBy}
        onClick={() => {
          setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
          setOpen(current => !current)
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
            setOpen(true)
          }
        }}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden="true">
          <Clock className="h-4 w-4" strokeWidth={2} />
        </span>
        <span className="min-w-0">
          <span id={labelId} className="block truncate text-xs font-medium text-slate-600">
            {fieldLabel}{required && <span className="text-red-500" aria-hidden="true"> *</span>}
          </span>
          <span className={`mt-0.5 block truncate text-sm font-semibold ${canonicalValue ? 'text-slate-900' : 'text-slate-500'}`}>
            {canonicalValue || text.selectTime}
          </span>
        </span>
      </button>

      {popupOpen && (
        <div className="absolute left-0 top-full z-50 mt-2 w-full min-w-32 max-w-48 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div
            id={listboxId}
            role="listbox"
            aria-label={fieldLabel}
            aria-activedescendant={`${id}-option-${options[activeIndex]}`}
            className="max-h-64 overflow-y-auto overscroll-contain p-1.5 touch-pan-y"
            onKeyDown={handleListKeyDown}
          >
            {options.map((option, index) => {
              const selected = option === canonicalValue
              return (
                <button
                  key={option}
                  ref={node => {
                    if (node) optionRefs.current.set(option, node)
                    else optionRefs.current.delete(option)
                  }}
                  id={`${id}-option-${option}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-time-option={option}
                  tabIndex={index === activeIndex ? 0 : -1}
                  className={`flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${
                    selected
                      ? 'bg-indigo-600 font-semibold text-white'
                      : 'text-slate-800 hover:bg-slate-100'
                  }`}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  {option}
                </button>
              )
            })}
          </div>
          {!required && canonicalValue && (
            <div className="border-t border-slate-100 p-1.5">
              <button
                type="button"
                className="min-h-10 w-full rounded-lg px-3 text-left text-sm font-medium text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                onClick={() => choose('')}
              >
                {text.clearTime}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
