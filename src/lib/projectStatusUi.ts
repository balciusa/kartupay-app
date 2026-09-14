export type ProjectStatusUiKey = 'pending' | 'collecting' | 'locked' | 'canceled' | 'unknown'

type ProjectStatusUiMeta = {
  label: string
  badgeClassName: string
  flowCardClassName: string
  flowBadgeClassName: string
}

export const projectStatusUi: Record<ProjectStatusUiKey, ProjectStatusUiMeta> = {
  pending: {
    label: 'Planning',
    badgeClassName: 'border-amber-200 bg-amber-100 text-amber-700',
    flowCardClassName: 'border-amber-200 bg-amber-50',
    flowBadgeClassName: 'border-amber-300 bg-white text-amber-700',
  },
  collecting: {
    label: 'Collecting',
    badgeClassName: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    flowCardClassName: 'border-emerald-200 bg-emerald-50',
    flowBadgeClassName: 'border-emerald-300 bg-white text-emerald-700',
  },
  locked: {
    label: 'Finalized',
    badgeClassName: 'border-slate-200 bg-slate-100 text-slate-700',
    flowCardClassName: 'border-slate-200 bg-slate-100',
    flowBadgeClassName: 'border-slate-200 bg-white text-slate-700',
  },
  canceled: {
    label: 'Canceled',
    badgeClassName: 'border-destructive/20 bg-destructive/10 text-destructive',
    flowCardClassName: 'border-red-200 bg-red-50',
    flowBadgeClassName: 'border-red-300 bg-white text-red-700',
  },
  unknown: {
    label: 'Unknown',
    badgeClassName: 'border-border bg-muted text-muted-foreground',
    flowCardClassName: 'border-slate-200 bg-slate-50/70',
    flowBadgeClassName: 'border-slate-200 bg-white text-slate-600',
  },
}

export function getProjectStatusUiKey(input: {
  status: string | null | undefined
  isCanceled?: boolean
  isFinalized?: boolean
  canceledAt?: string | null | undefined
}): ProjectStatusUiKey {
  const normalized = String(input.status ?? '').trim().toLowerCase()

  if (input.isCanceled || input.canceledAt || normalized === 'canceled' || normalized === 'cancelled') {
    return 'canceled'
  }
  if (input.isFinalized || normalized === 'closed') {
    return 'locked'
  }
  if (normalized === 'collecting') {
    return 'collecting'
  }
  if (normalized === 'pending') {
    return 'pending'
  }
  return 'unknown'
}
