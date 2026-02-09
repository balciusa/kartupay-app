'use client'

import { useEffect, useRef, useState } from 'react'
import { NewProjectForm } from '@/components/Project/NewProjectForm'

export function NewProjectModal() {
  const [open, setOpen] = useState(false)
  const modalRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
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
  }, [open])

  return (
    <>
      <button
        type="button"
        className="px-3 py-1.5 rounded bg-black text-white hover:opacity-90"
        onClick={() => setOpen(true)}
      >
        New project
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close new project modal"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="New project"
            className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl border flex flex-col max-h-[90vh]"
          >
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="space-y-0.5">
                <h2 className="text-lg font-semibold">New project</h2>
                <p className="text-sm text-muted-foreground">Set up a project and invite members to join</p>
              </div>
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded-lg border hover:bg-slate-50 transition-colors"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <NewProjectForm showCancel onCancel={() => setOpen(false)} submitLabel="Create project" />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
