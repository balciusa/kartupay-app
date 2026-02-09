'use client'

import { FormEvent, useMemo, useState } from 'react'

type ProjectSettingsFormProps = {
  action: (formData: FormData) => void | Promise<void>
  initial: {
    title: string
    description: string
    totalEur: string
    totalIsPerPerson: boolean
    minParticipants: number | null
    maxParticipants: number | null
    eventStartDate: string
    eventStartTime: string
    eventEndDate: string
    eventEndTime: string
  }
}

const DEFAULT_START_TIME = '09:00'
const DEFAULT_END_TIME = '17:00'

const resolveDateTime = (date: string, time: string, defaultTime: string) => {
  const dateRaw = date.trim()
  const timeRaw = time.trim()
  if (!dateRaw && !timeRaw) return null
  if (!dateRaw && timeRaw) return { error: 'Event time requires a date' as const }
  const normalized = `${dateRaw}T${timeRaw || defaultTime}`
  return { value: normalized }
}

export function ProjectSettingsForm({ action, initial }: ProjectSettingsFormProps) {
  const [startDate, setStartDate] = useState(initial.eventStartDate)
  const [startTime, setStartTime] = useState(initial.eventStartTime)
  const [endDate, setEndDate] = useState(initial.eventEndDate)
  const [endTime, setEndTime] = useState(initial.eventEndTime)
  const [dateError, setDateError] = useState<string | null>(null)

  const timeOptions = useMemo(() => {
    const baseTimes = Array.from({ length: 48 }, (_, idx) => {
      const hours = Math.floor(idx / 2)
      const minutes = idx % 2 === 0 ? '00' : '30'
      return `${String(hours).padStart(2, '0')}:${minutes}`
    })
    const timeSet = new Set(baseTimes)
    if (startTime) timeSet.add(startTime)
    if (endTime) timeSet.add(endTime)
    return ['', ...Array.from(timeSet).sort()]
  }, [startTime, endTime])

  const validateEventRange = () => {
    const start = resolveDateTime(startDate, startTime, DEFAULT_START_TIME)
    if (start && 'error' in start) return start.error

    const end = resolveDateTime(endDate, endTime, DEFAULT_END_TIME)
    if (end && 'error' in end) return end.error

    if (start && end && start.value && end.value && end.value < start.value) {
      return 'Event end must be after event start'
    }
    return null
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const error = validateEventRange()
    if (error) {
      event.preventDefault()
      setDateError(error)
      return
    }
    setDateError(null)
  }

  return (
    <form action={action} className="space-y-5" onSubmit={onSubmit}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Project title</label>
          <input
            name="project_title"
            defaultValue={initial.title}
            placeholder="Project title"
            className="w-full rounded-md border bg-white px-3 py-2 focus-visible:border-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
          <textarea
            name="project_description"
            defaultValue={initial.description}
            placeholder="Description (optional)"
            className="min-h-[120px] w-full rounded-md border bg-white px-3 py-2 focus-visible:border-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(0,1.4fr)]">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Total (EUR)</label>
          <input
            name="totalEur"
            type="text"
            inputMode="decimal"
            defaultValue={initial.totalEur}
            className="w-full rounded-md border bg-white px-3 py-2 focus-visible:border-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Total type</label>
          <div className="rounded-md border bg-white px-3 py-2 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="total_is_per_person"
                value="false"
                defaultChecked={!initial.totalIsPerPerson}
              />
              Grand total
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="total_is_per_person"
                value="true"
                defaultChecked={!!initial.totalIsPerPerson}
              />
              Per person
            </label>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Min participants</label>
          <input
            name="min_participants"
            type="number"
            min={1}
            className="w-full rounded-md border bg-white px-3 py-2 focus-visible:border-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
            defaultValue={initial.minParticipants ?? ''}
            placeholder="No minimum"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Max participants</label>
          <input
            name="max_participants"
            type="number"
            min={1}
            className="w-full rounded-md border bg-white px-3 py-2 focus-visible:border-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
            defaultValue={initial.maxParticipants ?? ''}
            placeholder="No maximum"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Event starts (optional)</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              name="event_start_date"
              type="date"
              className="w-full rounded-md border bg-white px-3 py-2 focus-visible:border-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
              defaultValue={initial.eventStartDate}
              onChange={event => {
                setStartDate(event.target.value)
                setDateError(null)
              }}
            />
            <select
              name="event_start_time"
              className="w-full rounded-md border bg-white px-3 py-2 focus-visible:border-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
              defaultValue={initial.eventStartTime}
              onChange={event => {
                setStartTime(event.target.value)
                setDateError(null)
              }}
            >
              {timeOptions.map(value => (
                <option key={value || 'blank'} value={value}>
                  {value || 'Time'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Event ends (optional)</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              name="event_end_date"
              type="date"
              min={startDate || undefined}
              className="w-full rounded-md border bg-white px-3 py-2 focus-visible:border-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
              defaultValue={initial.eventEndDate}
              onChange={event => {
                setEndDate(event.target.value)
                setDateError(null)
              }}
            />
            <select
              name="event_end_time"
              className="w-full rounded-md border bg-white px-3 py-2 focus-visible:border-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
              defaultValue={initial.eventEndTime}
              onChange={event => {
                setEndTime(event.target.value)
                setDateError(null)
              }}
            >
              {timeOptions.map(value => (
                <option key={value || 'blank'} value={value}>
                  {value || 'Time'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {dateError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {dateError}
        </div>
      )}

      <div className="flex justify-end">
        <button className="rounded-full bg-black px-5 py-2 text-white">Save settings</button>
      </div>
    </form>
  )
}

