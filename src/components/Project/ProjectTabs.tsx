'use client'

import { ReactNode, useMemo, useState } from 'react'

type TabKey = 'overview' | 'people' | 'participants' | 'payments' | 'activity' | 'profile' | 'voting' | 'settings' | 'admin'

type TabCounts = {
  participants?: number
  activity?: number
  adminPending?: number
  paymentsPending?: number
}

type TabSectionMap = Partial<Record<TabKey, ReactNode>>

const badgeClasses = {
  neutral: 'bg-slate-100 text-slate-700 border border-slate-200',
  solid: 'bg-black text-white',
  warning: 'bg-amber-400 text-amber-950',
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
    const baseTabs = [
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
    <section className="border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 border-b bg-white px-2" role="tablist">
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
                'flex items-center gap-2 px-3 py-2 text-sm',
                'border-b-2 -mb-px transition-colors',
                isActive ? 'border-black text-black' : 'border-transparent text-slate-500 hover:text-black',
              ].join(' ')}
            >
              <span>{tab.label}</span>
              {tab.badge ? (
                <span
                  className={[
                    'text-[11px] px-2 py-0.5 rounded-full leading-none',
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

      <div className="p-4">{sections[resolvedActive]}</div>
    </section>
  )
}
