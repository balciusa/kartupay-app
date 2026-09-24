'use client'

import { useId, useState } from 'react'
import { Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getProjectShareStrings,
  performProjectShare,
  type ProjectShareResult,
} from '@/lib/projectShare'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'

export function ShareProjectButton({
  projectId,
  projectTitle,
  locale = 'en',
}: {
  projectId: string
  projectTitle: string
  locale?: ProjectDateLocale
}) {
  const strings = getProjectShareStrings(locale)
  const feedbackId = useId()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<ProjectShareResult | null>(null)
  const feedback = result === 'copied'
    ? strings.linkCopied
    : result === 'failed'
      ? strings.copyFailed
      : null

  const handleShare = async () => {
    setPending(true)
    setResult(null)

    const shareResult = await performProjectShare({
      projectId,
      projectTitle,
      origin: window.location.origin,
      nativeShare: typeof navigator.share === 'function' ? navigator.share.bind(navigator) : undefined,
      writeClipboard: navigator.clipboard?.writeText
        ? navigator.clipboard.writeText.bind(navigator.clipboard)
        : undefined,
    })

    setResult(shareResult === 'canceled' || shareResult === 'shared' ? null : shareResult)
    setPending(false)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={handleShare}
        disabled={pending}
        aria-busy={pending}
        aria-label={strings.shareProject}
        aria-describedby={feedback ? feedbackId : undefined}
      >
        <Share2 aria-hidden="true" />
        {strings.shareProject}
      </Button>
      {feedback && (
        <span
          id={feedbackId}
          role={result === 'failed' ? 'alert' : 'status'}
          aria-live="polite"
          className={result === 'failed' ? 'text-xs text-red-600' : 'text-xs text-emerald-700'}
        >
          {feedback}
        </span>
      )}
    </div>
  )
}
