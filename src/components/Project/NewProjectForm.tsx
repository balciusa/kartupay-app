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
    <form action={createProject} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="project_title" className="text-sm font-medium">
          Project title <span className="text-red-500">*</span>
        </label>
        <input
          id="project_title"
          name="title"
          placeholder="Weekend trip, team event..."
          className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
          required
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="project_description" className="text-sm font-medium">
          Description <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          id="project_description"
          name="description"
          placeholder="Add context and details for participants"
          className="w-full border rounded-lg px-3 py-2.5 min-h-[96px] bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40 resize-none"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="project_total" className="text-sm font-medium">
            Total (EUR) <span className="text-red-500">*</span>
          </label>
          <input
            id="project_total"
            name="totalEur"
            type="text"
            inputMode="decimal"
            placeholder="199.99"
            className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
            onInput={sanitizeAmount}
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Total type</label>
          <div className="rounded-lg border px-3 py-2.5 space-y-2">
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
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="project_min_participants" className="text-sm font-medium">
            Min participants
          </label>
          <input
            id="project_min_participants"
            name="min_participants"
            type="number"
            min={1}
            className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
            placeholder="e.g. 5 (optional)"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="project_max_participants" className="text-sm font-medium">
            Max participants <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <input
            id="project_max_participants"
            name="max_participants"
            type="number"
            min={1}
            className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Event starts <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              name="event_start_date"
              type="date"
              className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
            />
            <select
              name="event_start_time"
              className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
            >
              {timeOptions.map(value => (
                <option key={value || 'blank'} value={value}>
                  {value || 'Time'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Event ends <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              name="event_end_date"
              type="date"
              className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
            />
            <select
              name="event_end_time"
              className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
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

      <div className="pt-2 flex items-center justify-end gap-3">
        {showCancel && (
          <button
            className="rounded-full px-5 py-2 border text-sm"
            type="button"
            onClick={() => onCancel?.()}
          >
            Cancel
          </button>
        )}
        <button className="rounded-full px-5 py-2 bg-black text-white text-sm hover:opacity-90" type="submit">
          {submitLabel}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        You will be added as the organizer, and your active payment links from Settings will be copied.
      </p>
    </form>
  )
}
