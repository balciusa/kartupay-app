'use client'

import { ClipboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { createPoll } from '@/app/project/[id]/actions'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export function CreatePollModal({
  projectId,
  canVote,
  projectCanceled,
}: {
  projectId: string
  canVote: boolean
  projectCanceled?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [optionRows, setOptionRows] = useState<string[]>(['', ''])
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement | null>(null)

  const resetDraft = useCallback(() => {
    setOptionRows(['', ''])
    setOptionsError(null)
    setSubmitError(null)
  }, [])

  const closeModal = useCallback(() => {
    setIsOpen(false)
    resetDraft()
  }, [resetDraft])

  const openModal = useCallback(() => {
    resetDraft()
    setIsOpen(true)
  }, [resetDraft])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal()
        return
      }
      if (event.key !== 'Tab') return
      const container = modalRef.current
      if (!container) return
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable && focusable.length > 0) {
      focusable[0].focus()
    }
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, closeModal])

  const handleSubmit = async (formData: FormData) => {
    const normalizedOptions = optionRows.map(option => option.trim()).filter(Boolean)
    if (normalizedOptions.length === 0) {
      setOptionsError('Add at least one option.')
      return
    }
    setOptionsError(null)
    setSubmitError(null)

    formData.set('options', normalizedOptions.join('\n'))
    try {
      await createPoll(projectId, formData)
      closeModal()
    } catch (error: unknown) {
      const maybeError = error as { message?: string } | null
      setSubmitError(maybeError?.message || 'Failed to create poll')
    }
  }

  const updateOption = (index: number, value: string) => {
    setOptionRows(prev => prev.map((option, idx) => (idx === index ? value : option)))
    if (optionsError) setOptionsError(null)
    if (submitError) setSubmitError(null)
  }

  const addOptionRow = () => {
    setOptionRows(prev => [...prev, ''])
    if (optionsError) setOptionsError(null)
    if (submitError) setSubmitError(null)
  }

  const removeOptionRow = (index: number) => {
    setOptionRows(prev => {
      if (prev.length <= 1) return ['']
      const next = prev.filter((_, idx) => idx !== index)
      return next.length > 0 ? next : ['']
    })
    if (optionsError) setOptionsError(null)
    if (submitError) setSubmitError(null)
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
    if (optionsError) setOptionsError(null)
    if (submitError) setSubmitError(null)
  }

  const isDisabled = !canVote || projectCanceled

  return (
    <>
      <Button
        type="button"
        onClick={openModal}
        disabled={isDisabled}
        className="rounded-full px-5 py-2.5 text-sm flex items-center gap-2"
      >
        <Plus className="h-4 w-4" />
        Create poll
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close create poll modal"
            className="absolute inset-0 bg-black/40"
            onClick={closeModal}
          />
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Create poll"
            className="relative w-full max-w-lg rounded-xl bg-white shadow-xl border flex flex-col max-h-[90vh]"
          >
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="space-y-0.5">
                <h2 className="text-lg font-semibold">Create poll</h2>
                <p className="text-sm text-muted-foreground">
                  Add a new idea for the group to vote on
                </p>
              </div>
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded-lg border hover:bg-slate-50 transition-colors"
                onClick={closeModal}
              >
                Cancel
              </button>
            </div>
            <form action={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
              <div className="space-y-2">
                <label htmlFor="poll_title" className="text-sm font-medium">
                  Poll title <span className="text-red-500">*</span>
                </label>
                <input
                  id="poll_title"
                  name="title"
                  placeholder="What should we decide?"
                  className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                  required
                  disabled={isDisabled}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="poll_description" className="text-sm font-medium">
                  Description <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  id="poll_description"
                  name="description"
                  placeholder="Add more context for voters"
                  className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                  disabled={isDisabled}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="create_extra_cost" className="text-sm font-medium">
                    Extra cost
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
                    <input
                      id="create_extra_cost"
                      name="extra_cost"
                      type="number"
                      min="0"
                      step="0.01"
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
                        disabled={isDisabled}
                        defaultChecked
                      />
                      Extra grand total
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="radio"
                        name="extra_is_per_person"
                        value="true"
                        disabled={isDisabled}
                      />
                      Extra cost per person
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">Optional additional cost if approved</p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="create_required_votes" className="text-sm font-medium">
                    Votes needed
                  </label>
                  <input
                    id="create_required_votes"
                    name="required_votes"
                    type="number"
                    min="1"
                    step="1"
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeModal}
                  className="rounded-full px-5"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isDisabled}
                  className="rounded-full px-5"
                >
                  Create poll
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
