import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabaseClient'
import { NewProjectModal } from '@/components/Home/NewProjectModal'
import { ProjectsToolbar } from '@/components/Home/ProjectsToolbar'
import { getProjectStatusUiKey, projectStatusUi } from '@/lib/projectStatusUi'

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
    if (normalized === 'pending' || normalized === 'collecting' || normalized === 'closed' || normalized === 'canceled') {
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

  if (statusFilter === 'pending') {
    query = query.eq('status', 'pending')
  } else if (statusFilter === 'collecting') {
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

  const statusBadgeBase = 'rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide'
  const filterBadgeBase = statusBadgeBase

  const filterOptions = [
    {
      key: 'all',
      value: '',
      label: 'All',
      className: 'border-border bg-muted text-foreground',
    },
    { key: 'pending', value: 'pending', label: projectStatusUi.pending.label, className: projectStatusUi.pending.badgeClassName },
    { key: 'collecting', value: 'collecting', label: projectStatusUi.collecting.label, className: projectStatusUi.collecting.badgeClassName },
    { key: 'closed', value: 'closed', label: 'Locked', className: projectStatusUi.locked.badgeClassName },
    { key: 'canceled', value: 'canceled', label: projectStatusUi.canceled.label, className: projectStatusUi.canceled.badgeClassName },
  ]

  return (
    <main className="space-y-6 md:space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">
            Track budgets, status, and upcoming event windows.
          </p>
        </div>
        <NewProjectModal />
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
          <div className="empty-state text-center">
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
            const statusKey = getProjectStatusUiKey({ status: rawStatus, canceledAt })
            const statusMeta = projectStatusUi[statusKey]
            const statusLabel = statusKey === 'unknown' && rawStatus ? rawStatus : statusMeta.label
            const statusClass = statusMeta.badgeClassName
            const isCanceled = statusKey === 'canceled'

            return (
              <Link
                key={p.id}
                href={`/project/${p.id}`}
                className="surface-card group p-4 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md"
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
