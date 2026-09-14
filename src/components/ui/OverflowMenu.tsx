'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

type OverflowAction =
  | { label: string; type?: 'danger' | 'normal'; formAction: () => Promise<void> }
  | { label: string; href: string }

export default function OverflowMenu(props: { items: OverflowAction[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!props.items.length) return null

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-slate-600 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open actions menu"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="surface-card absolute right-0 z-10 mt-2 w-48 overflow-hidden" role="menu">
          {props.items.map((item, idx) =>
            'formAction' in item ? (
              <form key={idx} action={item.formAction}>
                <button
                  type="submit"
                  className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
                    item.type === 'danger' ? 'text-red-600' : 'text-slate-700'
                  }`}
                  onClick={() => setOpen(false)}
                  role="menuitem"
                >
                  {item.label}
                </button>
              </form>
            ) : (
              <a
                key={idx}
                href={item.href}
                className="block px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                onClick={() => setOpen(false)}
                role="menuitem"
              >
                {item.label}
              </a>
            )
          )}
        </div>
      )}
    </div>
  )
}
