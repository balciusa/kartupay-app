'use client'

import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from 'react'

import type { ProjectDateLocale } from '@/lib/projectDateStrings'

export type ProjectSectionKey =
  | 'overview'
  | 'people'
  | 'participants'
  | 'activity'
  | 'profile'
  | 'settings'
  | 'admin'
  | 'dates'
  | 'voting'
  | 'transport'
  | 'extras'
  | 'payments'

type PrimaryTabKey = 'overview' | 'group' | 'plan' | 'finances'

type TabCounts = {
  participants?: number
  activity?: number
  adminPending?: number
  paymentsPending?: number
}
type TabSectionMap = Partial<Record<ProjectSectionKey, ReactNode>>

type PrimaryTabDefinition = {
  key: PrimaryTabKey
  label: string
  sectionKeys: ProjectSectionKey[]
  badge?: ReactNode
  badgeStyle?: keyof typeof badgeClasses
}

type SectionTabDefinition = {
  key: ProjectSectionKey
  label: string
  badge?: ReactNode
  badgeStyle?: keyof typeof badgeClasses
}

const badgeClasses = {
  neutral: 'border border-slate-200 bg-slate-100 text-slate-700',
  solid: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-200 text-amber-950',
}

const sectionGroups: Record<PrimaryTabKey, ProjectSectionKey[]> = {
  overview: ['overview'],
  group: ['people', 'participants', 'activity', 'profile', 'settings', 'admin'],
  plan: ['dates', 'voting', 'transport', 'extras'],
  finances: ['payments'],
}

const copy = {
  en: {
    primary: { overview: 'Overview', group: 'Group', plan: 'Plan', finances: 'Finances' },
    sections: {
      overview: 'Overview', people: 'Group', participants: 'Participants', activity: 'Activity',
      profile: 'Profile', settings: 'Settings', admin: 'Admin', dates: 'Dates', voting: 'Polls',
      transport: 'Transport', extras: 'Extras', payments: 'Finances',
    },
    primaryNavigation: 'Project sections',
    sectionNavigation: 'Section pages',
  },
  lt: {
    primary: { overview: 'Apžvalga', group: 'Grupė', plan: 'Planas', finances: 'Finansai' },
    sections: {
      overview: 'Apžvalga', people: 'Grupė', participants: 'Dalyviai', activity: 'Veikla',
      profile: 'Profilis', settings: 'Nustatymai', admin: 'Valdymas', dates: 'Datos', voting: 'Balsavimai',
      transport: 'Transportas', extras: 'Papildomi pasirinkimai', payments: 'Finansai',
    },
    primaryNavigation: 'Projekto skiltys',
    sectionNavigation: 'Skilties puslapiai',
  },
} satisfies Record<ProjectDateLocale, {
  primary: Record<PrimaryTabKey, string>
  sections: Record<ProjectSectionKey, string>
  primaryNavigation: string
  sectionNavigation: string
}>

const categoryForSection = (section: ProjectSectionKey): PrimaryTabKey => {
  for (const [category, sectionKeys] of Object.entries(sectionGroups) as Array<[PrimaryTabKey, ProjectSectionKey[]]>) {
    if (sectionKeys.includes(section)) return category
  }
  return 'overview'
}

function focusTab(event: KeyboardEvent<HTMLButtonElement>, direction: 'previous' | 'next' | 'first' | 'last') {
  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
  const current = tabs.indexOf(event.currentTarget)
  if (current < 0 || tabs.length < 2) return

  const target = direction === 'first' ? tabs[0]
    : direction === 'last' ? tabs[tabs.length - 1]
    : direction === 'previous' ? tabs[(current - 1 + tabs.length) % tabs.length]
    : tabs[(current + 1) % tabs.length]
  target?.focus()
  target?.click()
}

function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    focusTab(event, 'previous')
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    focusTab(event, 'next')
  } else if (event.key === 'Home') {
    event.preventDefault()
    focusTab(event, 'first')
  } else if (event.key === 'End') {
    event.preventDefault()
    focusTab(event, 'last')
  }
}

export function ProjectTabs({
  sections,
  counts,
  defaultTab = 'overview',
  locale = 'en',
}: {
  sections: TabSectionMap
  counts?: TabCounts
  defaultTab?: ProjectSectionKey
  locale?: ProjectDateLocale
}) {
  const strings = copy[locale]
  const [active, setActive] = useState<ProjectSectionKey>(defaultTab)
  const [peopleSeen, setPeopleSeen] = useState(false)

  useEffect(() => {
    setActive(defaultTab)
  }, [defaultTab])

  const peopleBadge = active === 'people' || peopleSeen ? counts?.participants : (counts?.activity ?? counts?.participants)
  const peopleBadgeStyle = active === 'people' || peopleSeen || !counts?.activity ? 'neutral' : 'solid'

  const sectionTabs = useMemo(() => {
    const definitions: SectionTabDefinition[] = [
      { key: 'overview', label: strings.sections.overview },
      { key: 'people', label: strings.sections.people, badge: peopleBadge, badgeStyle: peopleBadgeStyle },
      { key: 'participants', label: strings.sections.participants, badge: counts?.participants, badgeStyle: 'neutral' },
      { key: 'activity', label: strings.sections.activity, badge: counts?.activity, badgeStyle: 'solid' },
      { key: 'profile', label: strings.sections.profile },
      { key: 'settings', label: strings.sections.settings },
      { key: 'admin', label: strings.sections.admin, badge: counts?.adminPending, badgeStyle: 'warning' },
      { key: 'dates', label: strings.sections.dates },
      { key: 'voting', label: strings.sections.voting },
      { key: 'transport', label: strings.sections.transport },
      { key: 'extras', label: strings.sections.extras },
      { key: 'payments', label: strings.sections.payments, badge: counts?.paymentsPending, badgeStyle: 'warning' },
    ]
    return definitions.filter(tab => sections[tab.key] !== undefined && sections[tab.key] !== null)
  }, [counts, peopleBadge, peopleBadgeStyle, sections, strings])

  const primaryTabs = useMemo(() => {
    const definitions: PrimaryTabDefinition[] = [
      { key: 'overview', label: strings.primary.overview, sectionKeys: sectionGroups.overview },
      { key: 'group', label: strings.primary.group, sectionKeys: sectionGroups.group, badge: peopleBadge, badgeStyle: peopleBadgeStyle },
      { key: 'plan', label: strings.primary.plan, sectionKeys: sectionGroups.plan },
      { key: 'finances', label: strings.primary.finances, sectionKeys: sectionGroups.finances, badge: counts?.paymentsPending, badgeStyle: 'warning' },
    ]
    return definitions.filter(tab => tab.sectionKeys.some(key => sectionTabs.some(section => section.key === key)))
  }, [counts?.paymentsPending, peopleBadge, peopleBadgeStyle, sectionTabs, strings])

  const requestedCategory = categoryForSection(active)
  const requestedCategoryFallback = sectionGroups[requestedCategory]
    .find(key => sectionTabs.some(section => section.key === key))
  const resolvedActive = sectionTabs.some(tab => tab.key === active)
    ? active
    : (requestedCategoryFallback ?? sectionTabs[0]?.key ?? defaultTab)
  const activeCategory = categoryForSection(resolvedActive)
  const activePrimary = primaryTabs.some(tab => tab.key === activeCategory)
    ? activeCategory
    : (primaryTabs[0]?.key ?? 'overview')
  const activeSectionTabs = sectionTabs.filter(tab => sectionGroups[activePrimary].includes(tab.key))

  const openPrimaryTab = (tab: PrimaryTabDefinition) => {
    const currentBelongsToTab = tab.sectionKeys.includes(resolvedActive)
    const nextSection = currentBelongsToTab
      ? resolvedActive
      : tab.sectionKeys.find(key => sectionTabs.some(section => section.key === key))
    if (nextSection) {
      setActive(nextSection)
      if (nextSection === 'people') setPeopleSeen(true)
    }
  }

  return (
    <section className="min-w-0" lang={locale}>
      <div
        className="flex min-w-0 gap-5 overflow-x-auto border-b border-slate-200 px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-8"
        role="tablist"
        aria-label={strings.primaryNavigation}
      >
        {primaryTabs.map(tab => {
          const isActive = activePrimary === tab.key
          return (
            <button
              key={tab.key}
              id={`project-primary-tab-${tab.key}`}
              type="button"
              role="tab"
              data-primary-tab={tab.key}
              aria-label={tab.label}
              aria-selected={isActive}
              aria-controls="project-tab-panel"
              tabIndex={isActive ? 0 : -1}
              onKeyDown={handleTabKeyDown}
              onClick={() => openPrimaryTab(tab)}
              className={[
                'relative flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-0.5 py-3 text-sm font-semibold',
                'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2',
                isActive ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-800',
              ].join(' ')}
            >
              <span>{tab.label}</span>
              {tab.badge ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] leading-none ${badgeClasses[tab.badgeStyle ?? 'neutral']}`}>
                  {tab.badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {activeSectionTabs.length > 1 ? (
        <div
          className="mt-4 flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label={strings.sectionNavigation}
        >
          {activeSectionTabs.map(tab => {
            const isActive = resolvedActive === tab.key
            return (
              <button
                key={tab.key}
                id={`project-section-tab-${tab.key}`}
                type="button"
                role="tab"
                data-section-tab={tab.key}
                aria-label={tab.label}
                aria-selected={isActive}
                aria-controls="project-tab-panel"
                tabIndex={isActive ? 0 : -1}
                onKeyDown={handleTabKeyDown}
                onClick={() => {
                  setActive(tab.key)
                  if (tab.key === 'people') setPeopleSeen(true)
                }}
                className={[
                  'flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2',
                  isActive
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                ].join(' ')}
              >
                <span>{tab.label}</span>
                {tab.badge ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] leading-none ${badgeClasses[tab.badgeStyle ?? 'neutral']}`}>
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}

      <div
        id="project-tab-panel"
        role="tabpanel"
        aria-labelledby={
          activeSectionTabs.length > 1
            ? `project-section-tab-${resolvedActive}`
            : `project-primary-tab-${activePrimary}`
        }
        className="min-w-0 py-5 md:py-6"
      >
        {sections[resolvedActive]}
      </div>
    </section>
  )
}
