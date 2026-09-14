'use client'

import { useState, useTransition } from 'react'
import { cancelJoinRequestFromForm, requestJoinFromForm } from '@/app/project/[id]/actions'
import { useRouter } from 'next/navigation'
import { getProjectFinanceStrings } from '@/lib/projectFinanceStrings'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'

export function JoinButton({
  projectId,
  canJoinNow,
  requestStatus,
  locale = 'en',
}: {
  projectId: string
  canJoinNow: boolean
  requestStatus?: string | null
  locale?: ProjectDateLocale
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [localStatus, setLocalStatus] = useState<string | null>(null)
  const status = localStatus ?? requestStatus ?? null
  const strings = getProjectFinanceStrings(locale)

  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
          setLocalStatus('joined' in result && result.joined ? null : 'pending')
        } else {
          const resultError = result && 'error' in result ? result.error : null
          const resultReason = result && 'reason' in result ? result.reason : null
          console.error('[JoinButton] Request failed:', resultError || resultReason)
          alert(`Failed to submit request: ${resultError || resultReason || 'Unknown error'}`)
        }
        
        // Always refresh to show current state
        router.refresh()
      } catch (error: unknown) {
        console.error('[JoinButton] Form submission error:', errorMessage(error))
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
              ? strings.joinProject
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
                  setLocalStatus('canceled')
                } else {
                  alert(`Failed to cancel request: ${result?.error || 'Unknown error'}`)
                }
                router.refresh()
              } catch (error: unknown) {
                console.error('[JoinButton] Cancel error:', errorMessage(error))
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
