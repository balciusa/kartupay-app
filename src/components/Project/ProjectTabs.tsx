'use client'

import { ReactNode, useMemo, useState } from 'react'

type TabKey =
  | 'overview'
  | 'people'
  | 'participants'
  | 'payments'
  | 'activity'
  | 'profile'
  | 'voting'
  | 'extras'
  | 'settings'
  | 'admin'

type TabCounts = {
  participants?: number
  activity?: number
  adminPending?: number
  paymentsPending?: number
}

type TabSectionMap = Partial<Record<TabKey, ReactNode>>
type TabDefinition = {
  key: TabKey
  label: string
  badge?: ReactNode
  badgeStyle?: 'neutral' | 'solid' | 'warning'
  enabled: boolean
}

const badgeClasses = {
  neutral: 'border border-slate-200 bg-slate-100 text-slate-700',
  solid: 'bg-primary text-primary-foreground',
  warning: 'bg-amber-300 text-amber-950',
}

export function ProjectTabs({
  sections,
  counts,
  defaultTab = 'overview',
}: {
  sections: TabSectionMap
  counts?: TabCounts
  defaultTab?: TabKey
}) {
  const [active, setActive] = useState<TabKey>(defaultTab)
  const [peopleSeen, setPeopleSeen] = useState(false)

  const peopleBadge = active === 'people' || peopleSeen ? counts?.participants : (counts?.activity ?? counts?.participants)
  const peopleBadgeStyle = active === 'people' || peopleSeen || !counts?.activity ? 'neutral' : 'solid'
  const tabs = useMemo(() => {
    const baseTabs: TabDefinition[] = [
      { key: 'overview' as const, label: 'Overview', enabled: !!sections.overview },
      {
        key: 'people' as const,
        label: 'Collab',
        badge: peopleBadge,
        badgeStyle: peopleBadgeStyle,
        enabled: !!sections.people,
      },
      {
        key: 'payments' as const,
        label: 'Payments',
        badge: counts?.paymentsPending,
        badgeStyle: 'warning',
        enabled: !!sections.payments,
      },
      { key: 'extras' as const, label: 'Extras', enabled: !!sections.extras },
      { key: 'profile' as const, label: 'Profile', enabled: !!sections.profile },
      { key: 'voting' as const, label: 'Voting', enabled: !!sections.voting },
    ]

    if (sections.settings) {
      baseTabs.push({ key: 'settings' as const, label: 'Settings', enabled: true })
    }

    if (sections.admin) {
      baseTabs.push({
        key: 'admin' as const,
        label: 'Admin',
        badge: counts?.adminPending ? `${counts.adminPending} pending` : null,
        badgeStyle: 'warning',
        enabled: true,
      })
    }

    return baseTabs.filter(tab => tab.enabled)
  }, [counts, peopleBadge, peopleBadgeStyle, sections])

  const resolvedActive = tabs.some(tab => tab.key === active) ? active : (tabs[0]?.key ?? defaultTab)

  return (
    <section className="surface-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 border-b bg-background/90 px-2 py-1" role="tablist">
        {tabs.map(tab => {
          const isActive = resolvedActive === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setActive(tab.key)
                if (tab.key === 'people') {
                  setPeopleSeen(true)
                }
              }}
              className={[
                'flex min-h-9 items-center gap-2 rounded-lg px-3 py-1.5 text-sm',
                'transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                isActive ? 'bg-accent text-foreground' : 'text-slate-600 hover:bg-accent/70 hover:text-foreground',
              ].join(' ')}
            >
              <span>{tab.label}</span>
              {tab.badge ? (
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-[11px] leading-none',
                    badgeClasses[tab.badgeStyle as keyof typeof badgeClasses] || badgeClasses.neutral,
                  ].join(' ')}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="p-4 md:p-5">{sections[resolvedActive]}</div>
    </section>
  )
}
