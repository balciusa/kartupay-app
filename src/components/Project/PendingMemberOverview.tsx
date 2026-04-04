import Link from 'next/link'
import { projectStatusUi } from '@/lib/projectStatusUi'

type PendingMemberOverviewProps = {
  projectId: string
  participantsNow: number
  minParticipants: number | null
  maxParticipants: number | null
  viewerIsParticipant: boolean
  viewerHasPaymentMethod: boolean
}

export function PendingMemberOverview({
  projectId,
  participantsNow,
  minParticipants,
  maxParticipants,
  viewerIsParticipant,
  viewerHasPaymentMethod,
}: PendingMemberOverviewProps) {
  const hasParticipantLimits =
    (typeof minParticipants === 'number' && minParticipants > 0) ||
    (typeof maxParticipants === 'number' && maxParticipants > 0)
  const participantsToMinimum =
    typeof minParticipants === 'number' && minParticipants > 0 ? Math.max(0, minParticipants - participantsNow) : 0
  const spotsLeft =
    typeof maxParticipants === 'number' && maxParticipants > 0 ? Math.max(0, maxParticipants - participantsNow) : null
  const nextStepText = !viewerIsParticipant
    ? 'You are not on the participant list yet.'
    : viewerHasPaymentMethod
      ? 'You are ready. Waiting for the collector to open payments.'
      : 'Add your payment details before payments open.'

  return (
    <section className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/70 to-white p-5 shadow-sm md:p-6">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${projectStatusUi.pending.badgeClassName}`}
          >
            Planning
          </span>
          <div className="space-y-0.5">
            <h2 className="text-2xl font-semibold text-slate-900">Project is still in planning</h2>
            <p className="text-sm text-slate-600">
              The collector is still preparing the project before opening payments.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-900">Participants</div>
              <div className="text-sm text-slate-600">
                {participantsNow} participant{participantsNow === 1 ? '' : 's'} joined
              </div>
              {hasParticipantLimits ? (
                <div className="text-xs text-slate-500">
                  {typeof minParticipants === 'number' && minParticipants > 0
                    ? participantsToMinimum > 0
                      ? `${participantsToMinimum} more needed to reach the minimum of ${minParticipants}.`
                      : `Minimum of ${minParticipants} participants reached.`
                    : null}
                  {typeof minParticipants === 'number' && minParticipants > 0 && spotsLeft != null ? ' ' : ''}
                  {spotsLeft != null
                    ? spotsLeft === 0
                      ? `Maximum of ${maxParticipants} participants reached.`
                      : `${spotsLeft} spot(s) left before reaching the maximum of ${maxParticipants}.`
                    : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-900">Your status</div>
              <div className="text-sm text-slate-600">{nextStepText}</div>
            </div>
            {viewerIsParticipant && !viewerHasPaymentMethod ? (
              <Link
                href={`/project/${projectId}?tab=profile`}
                className="inline-flex items-center justify-center rounded-full bg-black px-4 py-2 text-sm text-white"
              >
                Add payment details
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
