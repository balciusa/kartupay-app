'use client'

import { createProject } from '@/app/project/new/actions'

type NewProjectFormProps = {
  showCancel?: boolean
  onCancel?: () => void
  submitLabel?: string
}

export function NewProjectForm({ showCancel = false, onCancel, submitLabel = 'Create' }: NewProjectFormProps) {
  const timeOptions = [
    '',
    ...Array.from({ length: 48 }, (_, idx) => {
      const hours = Math.floor(idx / 2)
      const minutes = idx % 2 === 0 ? '00' : '30'
      return `${String(hours).padStart(2, '0')}:${minutes}`
    }),
  ]
  const sanitizeAmount = (event: React.FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const raw = input.value
    const cleaned = raw.replace(/[^0-9.,]/g, '')
    const firstSeparatorIndex = cleaned.search(/[.,]/)
    if (firstSeparatorIndex === -1) {
      input.value = cleaned
      return
    }
    const integerPart = cleaned.slice(0, firstSeparatorIndex).replace(/[.,]/g, '')
    const decimalPart = cleaned.slice(firstSeparatorIndex + 1).replace(/[.,]/g, '').slice(0, 2)
    const separator = cleaned[firstSeparatorIndex]
    input.value = `${integerPart}${separator}${decimalPart}`
  }

  return (
    <form action={createProject} className="grid gap-3">
      <input name="title" placeholder="Project title" className="border rounded px-3 py-2" required />
      <textarea name="description" placeholder="Description (optional)" className="border rounded px-3 py-2" />

      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <label className="text-sm block mb-1">Total (EUR)</label>
          <input
            name="totalEur"
            type="text"
            inputMode="decimal"
            placeholder="199.99"
            className="border rounded px-3 py-2 w-full"
            onInput={sanitizeAmount}
            required
          />
        </div>
        <div>
          <label className="text-sm block mb-1">Total type</label>
          <div className="flex flex-col gap-2 border rounded px-3 py-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="total_is_per_person" value="false" defaultChecked />
              Grand total (fixed)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="total_is_per_person" value="true" />
              Per person (fixed)
            </label>
          </div>
        </div>
        <div>
          <label className="text-sm block mb-1">Min participants</label>
          <input
            name="min_participants"
            type="number"
            min={1}
            className="border rounded px-3 py-2 w-full"
            placeholder="e.g. 5 (optional)"
          />
        </div>
        <div>
          <label className="text-sm block mb-1">Max participants (optional)</label>
          <input
            name="max_participants"
            type="number"
            min={1}
            className="border rounded px-3 py-2 w-full"
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="text-sm block mb-1">Event starts (optional)</label>
          <div className="grid grid-cols-2 gap-2">
            <input name="event_start_date" type="date" className="border rounded px-3 py-2 w-full" />
            <select name="event_start_time" className="border rounded px-3 py-2 w-full">
              {timeOptions.map(value => (
                <option key={value || 'blank'} value={value}>
                  {value || 'Time'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm block mb-1">Event ends (optional)</label>
          <div className="grid grid-cols-2 gap-2">
            <input name="event_end_date" type="date" className="border rounded px-3 py-2 w-full" />
            <select name="event_end_time" className="border rounded px-3 py-2 w-full">
              {timeOptions.map(value => (
                <option key={value || 'blank'} value={value}>
                  {value || 'Time'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="px-4 py-2 rounded bg-black text-white" type="submit">
          {submitLabel}
        </button>
        {showCancel && (
          <button
            className="px-4 py-2 rounded border"
            type="button"
            onClick={() => onCancel?.()}
          >
            Cancel
          </button>
        )}
      </div>
      <p className="text-xs opacity-60">
        You will be added as the organizer, and your active payment links from Settings will be copied.
      </p>
    </form>
  )
}
