import { castVote } from '@/app/project/[id]/actions'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type Addon = {
  id: string
  title: string
  description: string | null
  extra_cents: number
  required_votes: number
  current_votes?: number
}

/**
 * Server Component. No "use client".
 * Renders a list of add-ons with a <form action=...> that calls castVote on submit.
 */
export default function Voting({ addons }: { addons: Addon[] }) {
  return (
    <div className="space-y-3">
      {addons.map((a) => (
        <Card key={a.id} className="p-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium">{a.title}</div>
            {a.description ? (
              <div className="text-sm text-muted-foreground">{a.description}</div>
            ) : null}
            <div className="text-sm mt-1">
              +€{(a.extra_cents / 100).toFixed(2)} · Need {a.required_votes}
              {typeof a.current_votes === 'number' ? ` · Have ${a.current_votes}` : null}
            </div>
          </div>

          {/* Server Action via form */}
          <form action={castVote.bind(null, a.id)}>
            <Button type="submit">Vote</Button>
          </form>
        </Card>
      ))}
    </div>
  )
}
