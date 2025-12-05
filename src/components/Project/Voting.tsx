'use client'
import { castVote } from '@/app/project/[id]/actions'
import { useTransition } from 'react'

export function Voting({ addons, voteCount }: { addons: any[], voteCount: Record<string, number> }) {
  const [pending, start] = useTransition()
  return (
    <section className="border rounded-xl p-4 space-y-3">
      <h2 className="text-lg font-semibold">Add-ons</h2>
      <div className="space-y-2">
        {(addons ?? []).map((a:any) => (
          <div key={a.id} className="rounded border p-3">
            <div className="font-medium">{a.title}</div>
            {a.description && <div className="text-sm opacity-80">{a.description}</div>}
            <div className="text-xs opacity-60 mt-1">+€{(a.extra_cents/100).toFixed(2)}</div>
            <div className="flex items-center justify-between mt-2">
              <div className="text-sm">Votes: {voteCount[a.id] ?? 0} / {a.required_votes}</div>
              <button className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
                disabled={pending}
                onClick={() => start(async () => { await castVote(a.id) })}
              >
                {pending ? 'Voting…' : 'Vote'}
              </button>
            </div>
          </div>
        ))}
        {(!addons || addons.length === 0) && <div className="text-sm opacity-60">No add-ons yet.</div>}
      </div>
    </section>
  )
}
