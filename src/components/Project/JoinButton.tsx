'use client'

import { useTransition } from 'react'
import { requestJoinFromForm } from '@/app/project/[id]/actions'
import { useRouter } from 'next/navigation'

export function JoinButton({ projectId, canJoinNow }: { projectId: string; canJoinNow: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    
    startTransition(async () => {
      try {
        console.log('[JoinButton] Submitting form...', { projectId })
        const result = await requestJoinFromForm(formData)
        console.log('[JoinButton] Form submitted, result:', result)
        
        console.log('[JoinButton] Result received:', result)
        
        if (result?.ok) {
          console.log('[JoinButton] Success! Request created/updated. Refreshing page...')
        } else {
          console.error('[JoinButton] Request failed:', result?.error || result?.reason)
          alert(`Failed to submit request: ${result?.error || result?.reason || 'Unknown error'}`)
        }
        
        // Always refresh to show current state
        router.refresh()
      } catch (error: any) {
        console.error('[JoinButton] Form submission error:', error)
        // Still refresh to show current state
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
        className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
      >
        {pending ? 'Submitting...' : canJoinNow ? 'Join project' : 'Request to join'}
      </button>
    </form>
  )
}
