'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'

type FilterOption = {
  key: string
  value: string
  label: string
  className: string
}

type ProjectsToolbarProps = {
  searchQuery: string
  statusFilter: string
  sortKey: string
  filterOptions: FilterOption[]
  filterBadgeBase: string
}

const sortLabels: Record<string, string> = {
  recent: 'Most recent',
  event: 'Upcoming event',
  budget_desc: 'Budget (high to low)',
  budget_asc: 'Budget (low to high)',
}

const searchDebounceMs = 350

export function ProjectsToolbar({
  searchQuery,
  statusFilter,
  sortKey,
  filterOptions,
  filterBadgeBase,
}: ProjectsToolbarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [query, setQuery] = useState(searchQuery)
  const [sort, setSort] = useState(sortKey)
  const ignoreNextSearch = useRef(false)

  const buildHref = useCallback(
    (params: { q?: string; status?: string; sort?: string }) => {
      const search = new URLSearchParams()
      if (params.q) search.set('q', params.q)
      if (params.status) search.set('status', params.status)
      if (params.sort && params.sort !== 'recent') search.set('sort', params.sort)
      const queryString = search.toString()
      return queryString ? `${pathname}?${queryString}` : pathname
    },
    [pathname]
  )

  useEffect(() => {
    ignoreNextSearch.current = true
    setQuery(searchQuery)
  }, [searchQuery])

  useEffect(() => {
    setSort(sortKey)
  }, [sortKey])

  useEffect(() => {
    if (ignoreNextSearch.current) {
      ignoreNextSearch.current = false
      return
    }
    const trimmed = query.trim()
    if (trimmed === searchQuery) return
    const href = buildHref({
      q: trimmed || undefined,
      status: statusFilter || undefined,
      sort,
    })
    const timer = window.setTimeout(() => {
      router.push(href)
    }, searchDebounceMs)
    return () => window.clearTimeout(timer)
  }, [buildHref, query, router, searchQuery, sort, statusFilter])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = query.trim()
    const href = buildHref({
      q: trimmed || undefined,
      status: statusFilter || undefined,
      sort,
    })
    router.push(href)
  }

  const handleFilter = (value: string) => {
    const trimmed = query.trim()
    const href = buildHref({
      q: trimmed || undefined,
      status: value || undefined,
      sort,
    })
    router.push(href)
  }

  const handleSortChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSort = event.target.value
    setSort(nextSort)
    const trimmed = query.trim()
    const href = buildHref({
      q: trimmed || undefined,
      status: statusFilter || undefined,
      sort: nextSort,
    })
    router.push(href)
  }

  const activeFilter = statusFilter || 'all'

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Search</label>
          <input
            type="search"
            name="q"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search by title"
            className="mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Filter</span>
          {filterOptions.map(option => {
            const isActive = activeFilter === option.key
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => handleFilter(option.value)}
                aria-current={isActive ? 'page' : undefined}
                className={`${filterBadgeBase} ${option.className} ${isActive ? '' : 'opacity-60 hover:opacity-100'}`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Sort</label>
          <select name="sort" value={sort} onChange={handleSortChange} className="rounded-lg border bg-background px-3 py-2 text-sm">
            {Object.entries(sortLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </form>
    </div>
  )
}
