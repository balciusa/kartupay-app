'use client'

import { createProject } from '@/app/project/new/actions'

type NewProjectFormProps = {
  showCancel?: boolean
  onCancel?: () => void
  submitLabel?: string
}

export function NewProjectForm({ showCancel = false, onCancel, submitLabel = 'Create' }: NewProjectFormProps) {
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
          <label className="text-sm block mb-1">Deadline date (optional)</label>
          <input name="deadlineDate" type="date" className="border rounded px-3 py-2 w-full" />
        </div>
        <div>
          <label className="text-sm block mb-1">Deadline time (optional)</label>
          <input name="deadlineTime" type="time" className="border rounded px-3 py-2 w-full" />
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
