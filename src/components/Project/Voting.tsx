import { castPollVote } from '@/app/project/[id]/actions'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CreatePollModal } from './CreatePollModal'
import { EditPollPanel } from './EditPollPanel'

type PollOption = {
  id: string
  label: string
  votes: number
}

type Poll = {
  id: string
  title: string
  description: string | null
  extra_cents: number
  extra_is_per_person: boolean
  required_votes: number
  options: PollOption[]
  user_option_id?: string | null
  can_edit?: boolean
}

/**
 * Server Component. No "use client".
 * Renders polls and lets participants cast a single-choice vote per poll.
 */
export default function Voting({
  projectId,
  polls,
  projectCanceled,
  canVote = true,
  userVotes,
}: {
  projectId: string
  polls: Poll[]
  projectCanceled?: boolean
  canVote?: boolean
  userVotes?: Record<string, string | null>
}) {
  const voteMap = userVotes ?? {}
  return (
    <div className="space-y-3">
      {projectCanceled && (
        <div className="rounded border border-dashed p-3 text-sm text-red-700 bg-red-50/50">
          Voting disabled (project canceled).
        </div>
      )}

      {!canVote && (
        <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
          Only active participants can vote or create proposals.
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-base font-semibold">Polls</div>
          <div className="text-sm text-muted-foreground">
            Vote on ideas and proposals for the group
          </div>
        </div>
        <CreatePollModal
          projectId={projectId}
          canVote={canVote}
          projectCanceled={projectCanceled}
        />
      </div>

      {polls.length === 0 ? (
        <div className="text-sm text-muted-foreground">No polls yet.</div>
      ) : (
        polls.map((poll, index) => {
          const userOptionId = voteMap[poll.id] ?? null
          return (
            <Card key={poll.id ?? `poll-${index}`} className="p-5 md:p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-lg font-semibold">{poll.title}</div>
                  {poll.description ? (
                    <div className="text-sm text-muted-foreground">{poll.description}</div>
                  ) : null}
                </div>
                <div className="text-xs px-2 py-1 rounded-full border bg-white text-slate-700">
                  +{(poll.extra_cents / 100).toFixed(2)}{' '}
                  {poll.extra_is_per_person ? '/ person' : 'grand total'} | {poll.required_votes} votes
                </div>
              </div>

              {poll.options.length === 0 ? (
                <div className="text-sm text-muted-foreground">No options yet.</div>
              ) : (
                <div className="divide-y border rounded-lg">
                  {poll.options.map(option => (
                    <div key={option.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="text-sm font-medium">
                        {option.label}{' '}
                        <span className="text-xs font-normal text-muted-foreground">({option.votes})</span>
                      </div>
                      {projectCanceled || !canVote ? (
                        <Button type="button" disabled>
                          Vote
                        </Button>
                      ) : (
                        <form action={castPollVote.bind(null, projectId, poll.id, option.id)}>
                          <Button
                            type="submit"
                            disabled={userOptionId === option.id}
                            variant={userOptionId === option.id ? 'secondary' : 'default'}
                            className="rounded-full px-4"
                          >
                            {userOptionId === option.id ? 'Selected' : userOptionId ? 'Switch' : 'Vote'}
                          </Button>
                        </form>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {poll.can_edit ? (
                <details className="border-t pt-3">
                  <summary className="text-sm font-medium cursor-pointer select-none">Edit poll</summary>
                  <EditPollPanel projectId={projectId} poll={poll} projectCanceled={projectCanceled} />
                </details>
              ) : null}
            </Card>
          )
        })
      )}
    </div>
  )
}
