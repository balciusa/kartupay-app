import type { ProjectDateLocale } from './projectDateStrings'

export type ProjectShareResult = 'shared' | 'copied' | 'canceled' | 'failed'

export const projectShareStrings = {
  en: {
    shareProject: 'Share project',
    linkCopied: 'Link copied',
    copyFailed: 'Could not copy link',
  },
  lt: {
    shareProject: 'Dalintis projektu',
    linkCopied: 'Nuoroda nukopijuota',
    copyFailed: 'Nepavyko nukopijuoti nuorodos',
  },
} as const

export function getProjectShareStrings(locale: ProjectDateLocale) {
  return projectShareStrings[locale]
}

export function shouldShowProjectShare({
  isActiveParticipant,
  isCanceled,
  isFinalized,
}: {
  isActiveParticipant: boolean
  isCanceled: boolean
  isFinalized: boolean
}) {
  return isActiveParticipant && !isCanceled && !isFinalized
}

export function buildProjectShareUrl(origin: string, projectId: string) {
  return new URL(`/project/${encodeURIComponent(projectId)}`, origin).toString()
}

export async function performProjectShare({
  projectId,
  projectTitle,
  origin,
  nativeShare,
  writeClipboard,
}: {
  projectId: string
  projectTitle: string
  origin: string
  nativeShare?: (data: ShareData) => Promise<void>
  writeClipboard?: (text: string) => Promise<void>
}): Promise<ProjectShareResult> {
  const url = buildProjectShareUrl(origin, projectId)

  if (nativeShare) {
    try {
      await nativeShare({ title: projectTitle, url })
      return 'shared'
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === 'AbortError') return 'canceled'
    }
  }

  if (!writeClipboard) return 'failed'

  try {
    await writeClipboard(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
