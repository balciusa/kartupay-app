import Link from 'next/link'
import { CalendarDays, MapPin } from 'lucide-react'
import { JoinButton } from '@/components/Project/JoinButton'
import { Button } from '@/components/ui/button'
import { buildProjectLoginHref, getProjectInviteStrings } from '@/lib/projectInvite'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'

export function PrivateProjectInvite({
  projectId,
  title,
  description,
  eventDate,
  location,
  isAuthenticated,
  requestStatus,
  isCanceled,
  locale,
}: {
  projectId: string
  title: string
  description?: string | null
  eventDate?: string | null
  location?: string | null
  isAuthenticated: boolean
  requestStatus?: string | null
  isCanceled: boolean
  locale: ProjectDateLocale
}) {
  const strings = getProjectInviteStrings(locale)
  const requestPending = requestStatus === 'pending'

  return (
    <section aria-labelledby="private-project-title" className="mx-auto flex min-h-[60vh] max-w-xl items-center py-6">
      <div className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_45%),linear-gradient(to_bottom,#ffffff,#f8fafc)] p-6 shadow-sm sm:p-8">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">
              {strings.privateProject}
            </p>
            <p className="text-sm text-slate-600">{strings.invitedToJoin}</p>
            <h1 id="private-project-title" className="break-words text-3xl font-semibold tracking-tight text-slate-950">
              {title}
            </h1>
            {description && <p className="line-clamp-3 text-sm leading-6 text-slate-600">{description}</p>}
          </div>

          {(eventDate || location) && (
            <dl className="grid gap-3 rounded-2xl border border-slate-200 bg-white/80 p-4 text-sm">
              {eventDate && (
                <div className="flex min-w-0 items-start gap-3">
                  <CalendarDays aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                  <div className="min-w-0">
                    <dt className="font-medium text-slate-900">{strings.date}</dt>
                    <dd className="break-words text-slate-600">{eventDate}</dd>
                  </div>
                </div>
              )}
              {location && (
                <div className="flex min-w-0 items-start gap-3">
                  <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                  <div className="min-w-0">
                    <dt className="font-medium text-slate-900">{strings.location}</dt>
                    <dd className="break-words text-slate-600">{location}</dd>
                  </div>
                </div>
              )}
            </dl>
          )}

          {isCanceled ? (
            <p className="rounded-2xl border border-slate-200 bg-white/80 p-4 text-sm font-medium text-slate-700">
              {strings.inactiveProject}
            </p>
          ) : !isAuthenticated ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">{strings.signInToContinue}</p>
              <Button asChild className="w-full rounded-full sm:w-auto">
                <Link href={buildProjectLoginHref(projectId)}>{strings.signIn}</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {requestPending && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="font-semibold">{strings.waitingForApproval}</p>
                  <p className="mt-1 text-amber-900/80">{strings.waitingForApprovalHelp}</p>
                </div>
              )}
              <JoinButton
                projectId={projectId}
                canJoinNow={false}
                requestStatus={requestStatus}
                locale={locale}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
