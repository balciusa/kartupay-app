'use client'

import { useEffect, useRef, useState } from 'react'
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
  const modalRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
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
  }, [isOpen])

  const handleSubmit = async (formData: FormData) => {
    await createPoll(projectId, formData)
    setIsOpen(false)
  }

  const isDisabled = !canVote || projectCanceled

  return (
    <>
      <Button
        type="button"
        onClick={() => setIsOpen(true)}
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
            onClick={() => setIsOpen(false)}
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
                onClick={() => setIsOpen(false)}
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
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
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
                <label htmlFor="poll_options" className="text-sm font-medium">
                  Options <span className="text-muted-foreground font-normal">(one per line)</span>
                </label>
                <textarea
                  id="poll_options"
                  name="options"
                  placeholder="Option 1&#10;Option 2&#10;Option 3"
                  className="w-full border rounded-lg px-3 py-2.5 min-h-[120px] bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40 resize-none"
                  disabled={isDisabled}
                />
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsOpen(false)}
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
