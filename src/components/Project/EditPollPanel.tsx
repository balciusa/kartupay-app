'use client'

import { ClipboardEvent, useMemo, useState } from 'react'
import { deletePoll, updatePoll } from '@/app/project/[id]/actions'
import { Button } from '@/components/ui/button'

type PollOption = {
  id: string
  label: string
  votes: number
}

type Poll = {
  id: string
  title: string
  description: string | null
  extra_cents: number
  extra_is_per_person: boolean
  required_votes: number
  options: PollOption[]
}

export function EditPollPanel({
  projectId,
  poll,
  projectCanceled,
}: {
  projectId: string
  poll: Poll
  projectCanceled?: boolean
}) {
  const [optionRows, setOptionRows] = useState<string[]>(
    poll.options.length > 0 ? poll.options.map(option => option.label) : ['', '']
  )
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const isDisabled = !!projectCanceled

  const normalizedOptions = useMemo(
    () => optionRows.map(option => option.trim()).filter(Boolean),
    [optionRows]
  )

  const clearErrors = () => {
    if (optionsError) setOptionsError(null)
    if (submitError) setSubmitError(null)
  }

  const handleSubmit = async (formData: FormData) => {
    if (normalizedOptions.length === 0) {
      setOptionsError('Add at least one option.')
      return
    }
    setOptionsError(null)
    setSubmitError(null)
    formData.set('options', normalizedOptions.join('\n'))
    try {
      await updatePoll(projectId, poll.id, formData)
    } catch (error: unknown) {
      const maybeError = error as { message?: string } | null
      setSubmitError(maybeError?.message || 'Failed to update poll')
    }
  }

  const updateOption = (index: number, value: string) => {
    setOptionRows(prev => prev.map((option, idx) => (idx === index ? value : option)))
    clearErrors()
  }

  const addOptionRow = () => {
    setOptionRows(prev => [...prev, ''])
    clearErrors()
  }

  const removeOptionRow = (index: number) => {
    setOptionRows(prev => {
      if (prev.length <= 1) return ['']
      const next = prev.filter((_, idx) => idx !== index)
      return next.length > 0 ? next : ['']
    })
    clearErrors()
  }

  const handleOptionPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text')
    if (!pasted.includes('\n')) return
    event.preventDefault()
    const lines = pasted
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    setOptionRows(prev => {
      const next = [...prev]
      next[index] = lines[0]
      for (let i = 1; i < lines.length; i += 1) {
        next.splice(index + i, 0, lines[i])
      }
      return next
    })
    clearErrors()
  }

  return (
    <div className="mt-3 space-y-3">
      <form action={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Poll title <span className="text-red-500">*</span>
          </label>
          <input
            name="title"
            defaultValue={poll.title}
            placeholder="What should we decide?"
            className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
            required
            disabled={isDisabled}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Description <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <input
            name="description"
            defaultValue={poll.description ?? ''}
            placeholder="Add more context for voters"
            className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
            disabled={isDisabled}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Extra cost</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
              <input
                name="extra_cost"
                type="number"
                min="0"
                step="0.01"
                defaultValue={(poll.extra_cents / 100).toFixed(2)}
                placeholder="0.00"
                className="w-full border rounded-lg pl-7 pr-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                disabled={isDisabled}
              />
            </div>
            <div className="rounded-lg border px-3 py-2.5 space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="extra_is_per_person"
                  value="false"
                  defaultChecked={!poll.extra_is_per_person}
                  disabled={isDisabled}
                />
                Extra grand total
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="extra_is_per_person"
                  value="true"
                  defaultChecked={poll.extra_is_per_person}
                  disabled={isDisabled}
                />
                Extra cost per person
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Optional additional cost if approved</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Votes needed</label>
            <input
              name="required_votes"
              type="number"
              min="1"
              step="1"
              defaultValue={poll.required_votes}
              placeholder="1"
              className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
              disabled={isDisabled}
            />
            <p className="text-xs text-muted-foreground">Minimum votes to pass</p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Options <span className="text-red-500">*</span>
          </label>
          <div className="space-y-2">
            {optionRows.map((option, index) => (
              <div key={`option-${index}`} className="flex items-center gap-2">
                <span className="w-6 text-center text-xs text-muted-foreground">{index + 1}.</span>
                <input
                  value={option}
                  onChange={event => updateOption(index, event.target.value)}
                  onPaste={event => handleOptionPaste(index, event)}
                  placeholder={`Option ${index + 1}`}
                  className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                  disabled={isDisabled}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="px-3"
                  onClick={() => removeOptionRow(index)}
                  disabled={isDisabled || optionRows.length <= 1}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-full px-4"
              onClick={addOptionRow}
              disabled={isDisabled}
            >
              Add option
            </Button>
            <p className="text-xs text-muted-foreground text-right">
              Tip: paste multiple lines to add several options at once.
            </p>
          </div>
          {optionsError && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {optionsError}
            </div>
          )}
          {submitError && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {submitError}
            </div>
          )}
        </div>

        <div className="pt-2 flex justify-end gap-3">
          <Button type="submit" disabled={isDisabled} className="rounded-full px-5">
            Save changes
          </Button>
        </div>
      </form>

      <form action={deletePoll.bind(null, projectId, poll.id)}>
        <Button type="submit" variant="outline" disabled={isDisabled} className="rounded-full">
          Delete poll
        </Button>
      </form>
    </div>
  )
}
