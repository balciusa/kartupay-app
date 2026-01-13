import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabaseClient'
import { NewProjectModal } from '@/components/Home/NewProjectModal'
import { ProjectsToolbar } from '@/components/Home/ProjectsToolbar'

type SearchParams = {
  q?: string | string[]
  status?: string | string[]
  sort?: string | string[]
}

export default async function Home({
  searchParams,
}: {
  searchParams?: SearchParams | Promise<SearchParams>
}) {
  const supabase = createSupabaseServerClient()
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const getParamValue = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value
  const rawQuery = getParamValue(resolvedSearchParams.q)
  const rawStatus = getParamValue(resolvedSearchParams.status)
  const rawSort = getParamValue(resolvedSearchParams.sort)
  const searchQuery = typeof rawQuery === 'string' ? rawQuery.trim() : ''
  const statusParam = typeof rawStatus === 'string' ? rawStatus : ''
  const sortParam = typeof rawSort === 'string' ? rawSort : ''

  const sortOptions = new Set(['recent', 'event', 'budget_desc', 'budget_asc'])
  const sortKey = sortOptions.has(sortParam) ? sortParam : 'recent'

  const statusFilter = (() => {
    const normalized = statusParam.trim().toLowerCase()
    if (normalized === 'cancelled') return 'canceled'
    if (normalized === 'collecting' || normalized === 'closed' || normalized === 'canceled') {
      return normalized
    }
    return ''
  })()

  let query = supabase
    .from('projects')
    .select('id, title, total_cents, min_participants, status, canceled_at, event_start_at, event_end_at, created_at')

  if (searchQuery) {
    query = query.ilike('title', `%${searchQuery}%`)
  }

  if (statusFilter === 'collecting') {
    query = query.eq('status', 'collecting')
  } else if (statusFilter === 'closed') {
    query = query.eq('status', 'closed')
  } else if (statusFilter === 'canceled') {
    query = query.or('status.eq.canceled,status.eq.cancelled,canceled_at.not.is.null')
  }

  switch (sortKey) {
    case 'event':
      query = query.order('event_start_at', { ascending: true, nullsFirst: false })
      query = query.order('created_at', { ascending: false })
      break
    case 'budget_desc':
      query = query.order('total_cents', { ascending: false, nullsFirst: false })
      query = query.order('created_at', { ascending: false })
      break
    case 'budget_asc':
      query = query.order('total_cents', { ascending: true, nullsFirst: false })
      query = query.order('created_at', { ascending: false })
      break
    default:
      query = query.order('created_at', { ascending: false })
  }

  const { data: projects, error } = await query

  const projectList = projects ?? []

  const formatMoney = (cents: number | null | undefined) =>
    `EUR ${(Number(cents ?? 0) / 100).toFixed(2)}`

  const formatDate = (value: string | null | undefined) => {
    if (!value) return 'Not set'
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatEventRange = (start: string | null | undefined, end: string | null | undefined) => {
    if (!start && !end) return 'No event scheduled'
    if (start && end) return `${formatDate(start)} - ${formatDate(end)}`
    if (start) return `Starts ${formatDate(start)}`
    return `Ends ${formatDate(end)}`
  }

  const statusStyles = {
    collecting: {
      label: 'Collecting',
      className: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    },
    closed: {
      label: 'Closed',
      className: 'border-slate-200 bg-slate-100 text-slate-700',
    },
    canceled: {
      label: 'Canceled',
      className: 'border-destructive/20 bg-destructive/10 text-destructive',
    },
    unknown: {
      label: 'Unknown',
      className: 'border-border bg-muted text-muted-foreground',
    },
  } as const

  const statusBadgeBase = 'rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide'
  const filterBadgeBase = statusBadgeBase

  const getStatusKey = (status: string | null | undefined, canceledAt: string | null | undefined) => {
    const normalized = (status ?? '').toLowerCase()
    if (canceledAt || normalized === 'canceled' || normalized === 'cancelled') return 'canceled'
    if (normalized === 'closed') return 'closed'
    if (normalized === 'collecting') return 'collecting'
    return 'unknown'
  }

  const filterOptions = [
    {
      key: 'all',
      value: '',
      label: 'All',
      className: 'border-foreground/20 bg-foreground/10 text-foreground',
    },
    { key: 'collecting', value: 'collecting', ...statusStyles.collecting },
    { key: 'closed', value: 'closed', ...statusStyles.closed },
    { key: 'canceled', value: 'canceled', ...statusStyles.canceled },
  ]

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Track budgets, status, and upcoming event windows.
          </p>
        </div>
        <NewProjectModal />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          DB error: {error.message}
        </div>
      )}

      <ProjectsToolbar
        searchQuery={searchQuery}
        statusFilter={statusFilter}
        sortKey={sortKey}
        filterOptions={filterOptions}
        filterBadgeBase={filterBadgeBase}
      />

      <div className="grid gap-4">
        {projectList.length === 0 ? (
          <div className="rounded-2xl border bg-card p-6 text-center shadow-sm">
            <div className="text-lg font-semibold">No projects yet</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Click <span className="font-medium">Create demo project</span> to add one automatically.
            </div>
          </div>
        ) : (
          projectList.map(p => {
            const canceledAt = p.canceled_at as string | null | undefined
            const eventStart = p.event_start_at as string | null | undefined
            const eventEnd = p.event_end_at as string | null | undefined
            const createdAt = p.created_at as string | null | undefined
            const rawStatus = (p.status ?? '') as string
            const statusKey = getStatusKey(rawStatus, canceledAt)
            const statusMeta = statusStyles[statusKey]
            const statusLabel = statusKey === 'unknown' && rawStatus ? rawStatus : statusMeta.label
            const statusClass = statusMeta.className
            const isCanceled = statusKey === 'canceled'

            return (
              <Link
                key={p.id}
                href={`/project/${p.id}`}
                className="group rounded-2xl border bg-card p-4 shadow-sm transition hover:border-foreground/20 hover:shadow-md"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold">{p.title}</div>
                      <span className={`${statusBadgeBase} ${statusClass}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatEventRange(eventStart, eventEnd)}
                    </div>
                    {isCanceled && (
                      <div className="text-xs text-destructive">
                        {canceledAt ? `Canceled on ${new Date(canceledAt).toLocaleString()}` : 'Canceled'}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 text-sm md:text-right">
                    <div className="text-lg font-semibold">{formatMoney(p.total_cents)}</div>
                    <div className="text-xs text-muted-foreground">
                      Min participants: {p.min_participants ?? '-'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Created {formatDate(createdAt)}
                    </div>
                  </div>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </main>
  )
}
