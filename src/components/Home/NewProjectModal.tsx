'use client'

import { useEffect, useRef, useState } from 'react'
import { NewProjectForm } from '@/components/Project/NewProjectForm'
import { Button } from '@/components/ui/button'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'

export function NewProjectModal({ locale = 'en' }: { locale?: ProjectDateLocale }) {
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
      <Button type="button" onClick={() => setOpen(true)} className="rounded-full px-5">
        New project
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close new project modal"
            className="modal-backdrop"
            onClick={() => setOpen(false)}
          />
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
            className="modal-panel max-w-2xl flex max-h-[90vh] flex-col"
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div className="space-y-0.5">
                <h2 id="new-project-title" className="text-lg font-semibold">New project</h2>
                <p className="text-sm text-muted-foreground">Set up a project and invite members to join</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <NewProjectForm showCancel onCancel={() => setOpen(false)} submitLabel="Create project" locale={locale} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
