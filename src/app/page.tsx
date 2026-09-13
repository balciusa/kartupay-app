import Link from 'next/link'
import { NewProjectModal } from '@/components/Home/NewProjectModal'
import { ProjectsToolbar } from '@/components/Home/ProjectsToolbar'
import { getProjectStatusUiKey, projectStatusUi } from '@/lib/projectStatusUi'
import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { headers } from 'next/headers'
import { resolveProjectDateLocale } from '@/lib/projectDateStrings'
import { normalizeProjectFinanceMode, type ProjectFinanceMode } from '@/lib/projectFinance'
import { getProjectFinanceStrings } from '@/lib/projectFinanceStrings'

type SearchParams = {
  q?: string | string[]
  status?: string | string[]
  sort?: string | string[]
}

type ProjectListRow = {
  id: string
  title: string
  total_cents: number | null
  min_participants: number | null
  status: string | null
  canceled_at: string | null
  event_start_at: string | null
  event_end_at: string | null
  created_at: string | null
  is_public?: boolean | null
  finance_mode?: ProjectFinanceMode | null
}

const missingColumn = (
  error: { message?: string; details?: string | null; hint?: string | null; code?: string } | null,
  column: string
) => {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase()
  const columnName = column.toLowerCase()
  if (!haystack.includes(columnName)) return false
  return (
    haystack.includes('does not exist') ||
    haystack.includes('could not find') ||
    haystack.includes('schema cache') ||
    haystack.includes('unknown column') ||
    error?.code === 'PGRST204'
  )
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const supabase = await getSupabaseServer()
  const uid = await getCurrentUserId()
  const requestHeaders = await headers()
  const locale = resolveProjectDateLocale(requestHeaders.get('accept-language'))
  const financeStrings = getProjectFinanceStrings(locale)
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

  const buildProjectsQuery = (selectList: string) => {
    let query = supabase
      .from('projects')
      .select(selectList)

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

    return query
  }

  const baseProjectSelect = 'id, title, total_cents, min_participants, status, canceled_at, event_start_at, event_end_at, created_at'
  const initialProjectsResult = await buildProjectsQuery(`${baseProjectSelect}, is_public, finance_mode`)
  let projects = initialProjectsResult.data as ProjectListRow[] | null
  let error = initialProjectsResult.error
  let visibilityAvailable = true
  if (missingColumn(error, 'finance_mode')) {
    const fallback = await buildProjectsQuery(`${baseProjectSelect}, is_public`)
    const fallbackProjects = fallback.data as ProjectListRow[] | null
    projects = fallbackProjects ? fallbackProjects.map(project => ({ ...project, finance_mode: 'managed' })) : null
    error = fallback.error
  }
  if (missingColumn(error, 'is_public')) {
    visibilityAvailable = false
    const fallback = await buildProjectsQuery(baseProjectSelect)
    const fallbackProjects = fallback.data as ProjectListRow[] | null
    projects = fallbackProjects ? fallbackProjects.map(project => ({ ...project, is_public: true, finance_mode: 'managed' })) : null
    error = fallback.error
  }

  const { data: membershipRows, error: membershipError } = uid
    ? await supabaseAdmin
        .from('participants')
        .select('project_id')
        .eq('user_id', uid)
    : { data: [], error: null }

  const memberProjectIds = new Set((membershipRows ?? []).map(row => row.project_id))
  const projectList = (projects ?? []).filter(project => {
    if (!visibilityAvailable) return true
    return project.is_public === true || memberProjectIds.has(project.id)
  })

  const pageError = error ?? membershipError

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
    { key: 'closed', value: 'closed', label: projectStatusUi.locked.label, className: projectStatusUi.locked.badgeClassName },
    { key: 'canceled', value: 'canceled', label: projectStatusUi.canceled.label, className: projectStatusUi.canceled.badgeClassName },
  ]

  return (
    <main className="space-y-6 md:space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">
            Plan participants, dates, decisions, and shared costs when needed.
          </p>
        </div>
        <NewProjectModal locale={locale} />
      </div>

      {pageError && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          DB error: {pageError.message}
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
            const isPublic = !visibilityAvailable || p.is_public === true
            const financeMode = normalizeProjectFinanceMode(p.finance_mode)
            const visibilityClass = isPublic
              ? 'border-sky-200 bg-sky-100 text-sky-700'
              : 'border-slate-200 bg-slate-100 text-slate-700'

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
                      <span className={`${statusBadgeBase} ${visibilityClass}`}>
                        {isPublic ? 'Public' : 'Private'}
                      </span>
                      {financeMode === 'none' && (
                        <span className={`${statusBadgeBase} border-emerald-200 bg-emerald-50 text-emerald-700`}>
                          {financeStrings.organizeOnly}
                        </span>
                      )}
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
                    {financeMode === 'managed' && <div className="text-lg font-semibold">{formatMoney(p.total_cents)}</div>}
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
