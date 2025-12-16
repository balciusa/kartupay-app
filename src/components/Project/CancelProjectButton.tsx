'use client'

import { useState } from 'react'

export function CancelProjectButton({ action }: { action: () => Promise<void> }) {
  const [pending, setPending] = useState(false)

  return (
    <form
      action={async () => {
        if (pending) return
        const confirmed = typeof window !== 'undefined'
          ? window.confirm('Are you sure you want to cancel this project?')
          : true
        if (!confirmed) return
        try {
          setPending(true)
          await action()
        } finally {
          setPending(false)
        }
      }}
      className="mt-3"
    >
      <button
        className="px-3 py-1.5 rounded border text-red-700 border-red-300 hover:bg-red-50 disabled:opacity-50"
        type="submit"
        disabled={pending}
      >
        {pending ? 'Canceling…' : 'Cancel project'}
      </button>
    </form>
  )
}
