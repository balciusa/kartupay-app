'use client'
import { useState, useTransition } from 'react'
import { postMessage } from '@/app/project/[id]/actions'

export function Discussions({ projectId, messages, projectCanceled }: { projectId: string; messages: any[]; projectCanceled?: boolean }) {
  const [body, setBody] = useState('')
  const [pending, start] = useTransition()

  return (
    <section className="border rounded-xl p-4 space-y-4">
      <h2 className="text-lg font-semibold">Discussions</h2>
      {projectCanceled ? (
        <div className="rounded border border-dashed p-3 text-sm text-red-700 bg-red-50/50">
          Posting disabled (project canceled).
        </div>
      ) : (
        <form
          onSubmit={e => {
            e.preventDefault()
            if (!body.trim()) return
            start(async () => {
              await postMessage(projectId, body.trim())
              setBody('')
            })
          }}
          className="space-y-2"
        >
          <textarea
            className="w-full border rounded p-2"
            rows={3}
            placeholder="Write a message"
            value={body}
            onChange={e => setBody(e.target.value)}
          />
          <button
            className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
            disabled={pending || !body.trim()}
          >
            {pending ? 'Posting...' : 'Post'}
          </button>
        </form>
      )}
      <div className="space-y-3">
        {(messages ?? []).map((m: any) => (
          <div key={m.id} className="rounded border p-3">
            <div className="text-sm">{m.body}</div>
            <div className="text-[11px] opacity-60 mt-1">{new Date(m.created_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
