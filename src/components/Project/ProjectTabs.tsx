'use client'

import { ReactNode, useMemo, useState } from 'react'

type TabKey = 'overview' | 'participants' | 'payments' | 'activity' | 'admin'

type TabCounts = {
  participants?: number
  activity?: number
  adminPending?: number
}

type TabSectionMap = Record<TabKey, ReactNode>

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
  const [chatSeen, setChatSeen] = useState(false)

  const activityBadge = active === 'activity' || chatSeen ? undefined : counts?.activity
  const tabs = useMemo(() => {
    const baseTabs = [
      { key: 'overview' as const, label: 'Overview' },
      { key: 'participants' as const, label: 'Participants', badge: counts?.participants, badgeStyle: 'neutral' },
      { key: 'payments' as const, label: 'Payments' },
      { key: 'activity' as const, label: 'Chat', badge: activityBadge, badgeStyle: 'solid' },
    ]

    if (sections.admin) {
      baseTabs.push({
        key: 'admin' as const,
        label: 'Admin',
        badge: counts?.adminPending ? `${counts.adminPending} pending` : null,
        badgeStyle: 'warning',
      })
    }

    return baseTabs
  }, [counts, activityBadge, sections.admin])

  return (
    <section className="border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 border-b bg-white px-2" role="tablist">
        {tabs.map(tab => {
          const isActive = active === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setActive(tab.key)
                if (tab.key === 'activity') {
                  setChatSeen(true)
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

      <div className="p-4">{sections[active]}</div>
    </section>
  )
}
