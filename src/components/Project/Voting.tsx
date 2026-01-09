import { castPollVote, createPoll, deletePoll, updatePoll } from '@/app/project/[id]/actions'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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

      <Card className="p-4 space-y-3">
        <div>
          <div className="font-medium">Create poll</div>
          <div className="text-sm text-muted-foreground">
            Add a new idea for the group to vote on. Optional extra cost is per person.
          </div>
        </div>
        <form action={createPoll.bind(null, projectId)} className="grid gap-2 md:grid-cols-6">
          <input
            name="title"
            placeholder="Poll title"
            className="border rounded px-2 py-1 md:col-span-2"
            required
            disabled={!canVote || projectCanceled}
          />
          <input
            name="description"
            placeholder="Short description (optional)"
            className="border rounded px-2 py-1 md:col-span-3"
            disabled={!canVote || projectCanceled}
          />
          <input
            name="extra_cost"
            type="number"
            min="0"
            step="0.01"
            placeholder="Extra cost"
            className="border rounded px-2 py-1 md:col-span-1"
            disabled={!canVote || projectCanceled}
          />
          <input
            name="required_votes"
            type="number"
            min="1"
            step="1"
            placeholder="Required votes"
            className="border rounded px-2 py-1 md:col-span-1"
            disabled={!canVote || projectCanceled}
          />
          <textarea
            name="options"
            placeholder="Options (one per line)"
            className="border rounded px-2 py-1 md:col-span-5 min-h-[90px]"
            disabled={!canVote || projectCanceled}
          />
          <div className="md:col-span-6">
            <Button type="submit" disabled={!canVote || projectCanceled}>
              Create poll
            </Button>
          </div>
        </form>
      </Card>

      {polls.length === 0 ? (
        <div className="text-sm text-muted-foreground">No polls yet.</div>
      ) : (
        polls.map((poll, index) => {
          const userOptionId = voteMap[poll.id] ?? null
          const optionsValue = poll.options.map(option => option.label).join('\n')
          return (
            <Card key={poll.id ?? `poll-${index}`} className="p-4 space-y-3">
              <div>
                <div className="font-medium">{poll.title}</div>
                {poll.description ? (
                  <div className="text-sm text-muted-foreground">{poll.description}</div>
                ) : null}
                <div className="text-sm mt-1">
                  +{(poll.extra_cents / 100).toFixed(2)} per person - Required votes: {poll.required_votes}
                </div>
              </div>

              {poll.options.length === 0 ? (
                <div className="text-sm text-muted-foreground">No options yet.</div>
              ) : (
                <div className="space-y-2">
                  {poll.options.map(option => (
                    <div key={option.id} className="flex items-center justify-between gap-3">
                      <div className="text-sm">
                        {option.label}{' '}
                        <span className="text-xs opacity-60">({option.votes} votes)</span>
                      </div>
                      {projectCanceled || !canVote ? (
                        <Button type="button" disabled>
                          Vote
                        </Button>
                      ) : (
                        <form action={castPollVote.bind(null, projectId, poll.id, option.id)}>
                          <Button type="submit" disabled={userOptionId === option.id}>
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
                  <summary className="text-sm cursor-pointer select-none">Edit poll</summary>
                  <div className="mt-3 space-y-3">
                    <form action={updatePoll.bind(null, projectId, poll.id)} className="grid gap-2 md:grid-cols-6">
                      <input
                        name="title"
                        defaultValue={poll.title}
                        placeholder="Poll title"
                        className="border rounded px-2 py-1 md:col-span-2"
                        required
                        disabled={projectCanceled}
                      />
                      <input
                        name="description"
                        defaultValue={poll.description ?? ''}
                        placeholder="Short description (optional)"
                        className="border rounded px-2 py-1 md:col-span-3"
                        disabled={projectCanceled}
                      />
                      <input
                        name="extra_cost"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={(poll.extra_cents / 100).toFixed(2)}
                        placeholder="Extra cost"
                        className="border rounded px-2 py-1 md:col-span-1"
                        disabled={projectCanceled}
                      />
                      <input
                        name="required_votes"
                        type="number"
                        min="1"
                        step="1"
                        defaultValue={poll.required_votes}
                        placeholder="Required votes"
                        className="border rounded px-2 py-1 md:col-span-1"
                        disabled={projectCanceled}
                      />
                      <textarea
                        name="options"
                        defaultValue={optionsValue}
                        placeholder="Options (one per line)"
                        className="border rounded px-2 py-1 md:col-span-5 min-h-[90px]"
                        disabled={projectCanceled}
                      />
                      <div className="md:col-span-6">
                        <Button type="submit" disabled={projectCanceled}>
                          Save changes
                        </Button>
                      </div>
                    </form>

                    <form action={deletePoll.bind(null, projectId, poll.id)}>
                      <Button type="submit" variant="outline" disabled={projectCanceled}>
                        Delete poll
                      </Button>
                    </form>
                  </div>
                </details>
              ) : null}
            </Card>
          )
        })
      )}
    </div>
  )
}
