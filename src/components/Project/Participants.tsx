'use client'
import { useTransition, useState } from 'react'
import {
  markReceived,
  createLateJoinTransfers,
  confirmLateJoinReceipt,
} from '@/app/project/[id]/actions'

type Pref = { label:string|null, value:string, type:string }
type Opt = { label:string|null, value:string, type:string, priority:number }

export function Participants(props: {
  projectId: string
  participants: Array<{ id: string, user_id: string, role: string, short_code: string | null }>
  preferred: Map<string, Pref>
  allOptions: Map<string, Array<Opt>>
  paidSet: Set<string>
  afterDeadlineSet: Set<string>
  transfers: Array<any>
  organizerId: string | null
}) {
  const [pending, start] = useTransition()
  const [newcomerId, setNewcomerId] = useState('')

  const transfersByRecipient = new Map<string, any[]>()
  for (const t of (props.transfers ?? [])) {
    const arr = transfersByRecipient.get(t.to_participant_id) ?? []
    arr.push(t)
    transfersByRecipient.set(t.to_participant_id, arr)
  }

  return (
    <section className="border rounded-xl p-4 space-y-4">
      <h2 className="text-lg font-semibold">Participants</h2>

      {/* Existing Late-Join panel (keep it; visible even if no organizer yet for MVP) */}
      <div className="rounded border p-3 space-y-2">
        <div className="font-medium">Late-Join</div>
        <form onSubmit={(e)=>{e.preventDefault(); if (!newcomerId.trim()) return; start(async ()=>{ await createLateJoinTransfers(props.projectId, newcomerId.trim()); setNewcomerId('') })}}>
          <div className="flex gap-2">
            <input className="border rounded px-2 py-1 flex-1" placeholder="Newcomer participant ID" value={newcomerId} onChange={e=>setNewcomerId(e.target.value)} />
            <button className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50" disabled={pending || !newcomerId.trim()}>
              {pending ? 'Creating...' : 'Start late-join'}
            </button>
          </div>
          <div className="text-xs opacity-60 mt-1">Creates a transfer for each already-paid participant.</div>
        </form>
      </div>

      <div className="grid gap-3">
        {props.participants.map(p => {
          const pref = props.preferred.get(p.id)
          const all = props.allOptions.get(p.id) ?? []
          const paid = props.paidSet.has(p.id)
          const late = props.afterDeadlineSet.has(p.id)
          const myTransfers = transfersByRecipient.get(p.id) ?? []

          return (
            <div key={p.id} className="rounded border p-3 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="font-medium">
                  {p.short_code ? `#${p.short_code}` : p.id.slice(0,6)}
                  <span className="ml-2 text-xs uppercase opacity-50">{p.role}</span>
                </div>
                <div className="flex items-center gap-2">
                  {pref ? (
                    <a className="px-3 py-1.5 rounded border hover:bg-black/5" href={pref.value} target="_blank" rel="noreferrer">
                      Pay ({pref.label ?? pref.type})
                    </a>
                  ) : (
                    <span className="text-xs opacity-60">No payment link</span>
                  )}

                  <details className="px-3 py-1.5 rounded border">
                    <summary className="cursor-pointer text-sm">All options</summary>
                    <div className="mt-2 space-y-1">
                      {all.length === 0 ? (
                        <div className="text-xs opacity-60">No other options</div>
                      ) : all.map((o, idx) => (
                        <a key={idx} className="block text-sm underline" href={o.value} target="_blank" rel="noreferrer">
                          {(o.label ?? o.type)} (p{String(o.priority)})
                        </a>
                      ))}
                    </div>
                  </details>

                  <button className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
                    disabled={pending}
                    onClick={() => start(async () => { await markReceived(p.id) })}
                  >
                    {pending ? 'Saving...' : 'Mark received'}
                  </button>
                </div>
              </div>

              {paid && !late && (
                <div className="text-sm text-green-700">Payment received (counts for threshold)</div>
              )}
              {late && (
                <div className="text-sm bg-yellow-100 border border-yellow-300 rounded p-2">
                  <div className="font-medium">Heads up</div>
                  <div>This receipt was recorded after the deadline. It will not count toward the threshold.</div>
                </div>
              )}

              {myTransfers.length > 0 && (
                <div className="mt-2 rounded border p-2">
                  <div className="text-sm font-medium">Late-Join Transfers to this participant</div>
                  <div className="space-y-1 mt-1">
                    {myTransfers.map(t => (
                      <div key={t.id} className="flex items-center justify-between text-sm">
                        <div>Expected: €{(t.expected_cents/100).toFixed(2)} {t.received_at ? '- Received' : ''}</div>
                        {!t.received_at && (
                          <button className="px-2 py-1 rounded bg-black text-white text-xs"
                            onClick={() => start(async ()=>{ await confirmLateJoinReceipt(t.id) })}
                          >
                            Confirm received
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
