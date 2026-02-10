'use client'

import { useEffect, useState, useTransition } from 'react'
import { cancelJoinRequestFromForm, requestJoinFromForm } from '@/app/project/[id]/actions'
import { useRouter } from 'next/navigation'

export function JoinButton({
  projectId,
  canJoinNow,
  requestStatus,
}: {
  projectId: string
  canJoinNow: boolean
  requestStatus?: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<string | null>(requestStatus ?? null)

  useEffect(() => {
    setStatus(requestStatus ?? null)
  }, [requestStatus])

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
          setStatus('pending')
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
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <button
        type="submit"
        disabled={pending || status === 'pending'}
        className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
      >
        {pending
          ? 'Submitting...'
          : status === 'pending'
            ? 'Request sent'
            : canJoinNow
              ? 'Join project'
              : 'Request to join'}
      </button>
      {status === 'pending' && (
        <button
          type="button"
          className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          disabled={pending}
          onClick={() => {
            const formData = new FormData()
            formData.set('projectId', projectId)
            startTransition(async () => {
              try {
                const result = await cancelJoinRequestFromForm(formData)
                if (result?.ok) {
                  setStatus('canceled')
                } else {
                  alert(`Failed to cancel request: ${result?.error || 'Unknown error'}`)
                }
                router.refresh()
              } catch (error: any) {
                console.error('[JoinButton] Cancel error:', error)
                router.refresh()
              }
            })
          }}
        >
          Cancel request
        </button>
      )}
    </form>
  )
}
