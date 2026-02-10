'use client'

import { useMemo, useState } from 'react'

type ActivityCategory = 'project' | 'participants' | 'requests' | 'payments' | 'voting' | 'extras' | 'other'

export type ActivityLogItem = {
  id: string
  occurred_at: string
  category: ActivityCategory
  message: string
}

type ActivityFilter = 'all' | ActivityCategory

const FILTER_LABELS: Record<ActivityFilter, string> = {
  all: 'All',
  project: 'Project',
  participants: 'Participants',
  requests: 'Requests',
  payments: 'Payments',
  voting: 'Voting',
  extras: 'Extras',
  other: 'Other',
}

const FILTER_ORDER: ActivityFilter[] = ['all', 'project', 'participants', 'requests', 'payments', 'voting', 'extras', 'other']

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })

export function ActivityLogTab({ items }: { items: ActivityLogItem[] }) {
  const [filter, setFilter] = useState<ActivityFilter>('all')

  const visibleItems = useMemo(
    () => (filter === 'all' ? items : items.filter(item => item.category === filter)),
    [filter, items]
  )

  const grouped = useMemo(() => {
    const map = new Map<string, ActivityLogItem[]>()
    for (const item of visibleItems) {
      const key = formatDate(item.occurred_at)
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return Array.from(map.entries())
  }, [visibleItems])

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold">Activity Log</h2>
        <p className="text-sm text-muted-foreground">Collector-only audit trail for project actions.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTER_ORDER.map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={[
              'rounded-full border px-3 py-1.5 text-xs transition-colors',
              filter === key
                ? 'border-black bg-black text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900',
            ].join(' ')}
          >
            {FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      {visibleItems.length === 0 ? (
        <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
          No activity entries for this filter.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([dateLabel, rows]) => (
            <section key={dateLabel} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{dateLabel}</div>
              <div className="divide-y rounded-lg border bg-white">
                {rows.map(item => (
                  <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="text-slate-800">{item.message}</div>
                    <div className="whitespace-nowrap text-xs text-slate-500">{formatTime(item.occurred_at)}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
