'use client'

import { useState, useTransition } from 'react'
import { Bell, Check, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  markAllProjectNotificationsRead,
  markProjectNotificationRead,
} from '@/app/project/[id]/actions'
import type { ProjectNotificationItem } from '@/lib/projectNotifications'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'

const strings = {
  en: {
    title: 'Notifications',
    markAll: 'Mark all as read',
    markOne: 'Mark as read',
    empty: 'No notifications yet.',
    close: 'Close notifications',
    open: 'Open notifications',
    unread: 'Unread',
    error: 'Could not update the notification.',
  },
  lt: {
    title: 'Pranešimai',
    markAll: 'Pažymėti visus kaip skaitytus',
    markOne: 'Pažymėti kaip skaitytą',
    empty: 'Pranešimų nėra.',
    close: 'Uždaryti pranešimus',
    open: 'Atidaryti pranešimus',
    unread: 'Neskaityta',
    error: 'Nepavyko atnaujinti pranešimo.',
  },
} as const

export function ProjectNotificationCenter({
  projectId,
  initialItems,
  initialUnreadCount,
  locale,
}: {
  projectId: string
  initialItems: ProjectNotificationItem[]
  initialUnreadCount: number
  locale: ProjectDateLocale
}) {
  const copy = strings[locale]
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(initialItems)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const markOne = (notificationId: string, after?: () => void) => {
    startTransition(async () => {
      setError(null)
      try {
        await markProjectNotificationRead(projectId, notificationId)
        setItems(current => current.map(item => item.id === notificationId && item.unread
          ? { ...item, readAt: new Date().toISOString(), unread: false }
          : item))
        setUnreadCount(current => Math.max(0, current - (items.some(item => item.id === notificationId && item.unread) ? 1 : 0)))
      } catch {
        setError(copy.error)
      } finally {
        after?.()
      }
    })
  }

  const markAll = () => {
    startTransition(async () => {
      setError(null)
      try {
        await markAllProjectNotificationsRead(projectId)
        const readAt = new Date().toISOString()
        setItems(current => current.map(item => item.readAt ? { ...item, unread: false } : { ...item, readAt, unread: false }))
        setUnreadCount(0)
      } catch {
        setError(copy.error)
      }
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={copy.open}
        aria-expanded={open}
        aria-controls="project-notification-panel"
        className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        onClick={() => setOpen(current => !current)}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs font-semibold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          id="project-notification-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="project-notification-title"
          className="fixed inset-x-3 top-20 z-50 flex max-h-[calc(100dvh-6rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[min(24rem,calc(100vw-2rem))]"
        >
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
            <h2 id="project-notification-title" className="mr-auto font-semibold text-slate-900">{copy.title}</h2>
            <div className="ml-auto flex min-w-0 items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="min-h-11 max-w-full rounded-lg px-2 text-right text-sm font-medium leading-tight text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                  disabled={pending}
                  onClick={markAll}
                >
                  {copy.markAll}
                </button>
              )}
              <button
                type="button"
                aria-label={copy.close}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {items.length === 0 ? (
              <p className="px-4 py-5 text-sm text-slate-600">{copy.empty}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map(item => {
                  const unread = item.unread
                  return (
                    <li key={item.id} className={`relative px-4 py-4 ${unread ? 'bg-indigo-50/60' : 'bg-white'}`}>
                      <div className="flex min-w-0 gap-3">
                        <span
                          aria-label={unread ? copy.unread : undefined}
                          className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-indigo-600' : 'bg-transparent'}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className={`break-words text-sm ${unread ? 'font-semibold text-slate-950' : 'font-medium text-slate-700'}`}>{item.title}</div>
                          <p className={`mt-1 break-words text-sm leading-5 ${unread ? 'text-slate-700' : 'text-slate-500'}`}>{item.body}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <time dateTime={item.createdAt}>{item.createdAtLabel}</time>
                            {item.resolvedLabel && <span className="rounded-full bg-slate-100 px-2 py-0.5">{item.resolvedLabel}</span>}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.href && item.actionLabel && (
                              <button
                                type="button"
                                className="min-h-11 max-w-full whitespace-normal rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                                disabled={pending}
                                onClick={() => markOne(item.id, () => router.push(item.href!))}
                              >
                                {item.actionLabel}
                              </button>
                            )}
                            {unread && (
                              <button
                                type="button"
                                className="inline-flex min-h-11 max-w-full items-center whitespace-normal rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                disabled={pending}
                                onClick={() => markOne(item.id)}
                              >
                                <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> {copy.markOne}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
