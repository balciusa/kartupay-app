'use client'

import { useTransition } from 'react'
import { leaveProjectFromForm } from '@/app/project/[id]/actions'
import { useRouter } from 'next/navigation'

export function LeaveProjectButton({ projectId, isOnlyOrganizer }: { projectId: string; isOnlyOrganizer: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // If user is the only organizer, show disabled "You are in" button
  if (isOnlyOrganizer) {
    return (
      <button className="px-3 py-1.5 rounded bg-black text-white opacity-50" disabled>
        You are in
      </button>
    )
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    if (!confirm('Are you sure you want to leave this project?')) return

    const formData = new FormData(e.currentTarget)
    
    startTransition(async () => {
      try {
        console.log('[LeaveProjectButton] Leaving project...', { projectId })
        await leaveProjectFromForm(formData)
        console.log('[LeaveProjectButton] Left project successfully')
        router.refresh()
      } catch (error: any) {
        // Redirect is expected; surface it without logging as a failure.
        if (error?.message === 'NEXT_REDIRECT' || error?.digest === 'NEXT_REDIRECT') {
          router.refresh()
          return
        }
        console.error('[LeaveProjectButton] Error leaving project:', error)
        alert(error?.message || 'Failed to leave project. Please try again.')
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="hidden" name="projectId" value={projectId} />
      <button
        type="submit"
        disabled={pending}
        className="px-3 py-1.5 rounded border text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? 'Leaving...' : 'Leave Project'}
      </button>
    </form>
  )
}
