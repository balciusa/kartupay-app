'use client'

import { useState } from 'react'

type OverflowAction =
  | { label: string; type?: 'danger' | 'normal'; formAction: () => Promise<void> }
  | { label: string; href: string }

export default function OverflowMenu(props: { items: OverflowAction[] }) {
  const [open, setOpen] = useState(false)
  if (!props.items.length) return null

  return (
    <div className="relative">
      <button
        type="button"
        className="px-2 py-1 rounded border"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 rounded border bg-white shadow z-10">
          {props.items.map((item, idx) =>
            'formAction' in item ? (
              <form key={idx} action={item.formAction}>
                <button
                  type="submit"
                  className={`block w-full text-left px-3 py-2 hover:bg-black/5 ${
                    item.type === 'danger' ? 'text-red-600' : ''
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </button>
              </form>
            ) : (
              <a
                key={idx}
                href={item.href}
                className="block px-3 py-2 hover:bg-black/5"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ),
          )}
        </div>
      )}
    </div>
  )
}
