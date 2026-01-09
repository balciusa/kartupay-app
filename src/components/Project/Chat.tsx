'use client'

import { useEffect, useRef, useTransition } from 'react'
import { markChatRead, postMessage } from '@/app/project/[id]/actions'

type Msg = {
  id: string
  user_id?: string
  author_user_id?: string
  body: string
  created_at: string
}

export default function Chat({
  projectId,
  messages,
  userDisplayMap = {},
  canRead = true,
}: {
  projectId: string
  messages: Msg[]
  userDisplayMap?: Record<string, string>
  canRead?: boolean
}) {
  const [pending, start] = useTransition()
  const hasMarked = useRef(false)

  useEffect(() => {
    if (!canRead || hasMarked.current) return
    hasMarked.current = true
    markChatRead(projectId).catch(err => {
      console.error('[Chat] markChatRead failed', err)
    })
  }, [canRead, projectId])

  return (
    <section className="space-y-3">
      <form
        action={formData =>
          start(async () => {
            const body = String(formData.get('body') || '').trim()
            await postMessage(projectId, body)
          })}
        className="space-y-2"
      >
        <textarea
          name="body"
          placeholder="Write a message"
          className="w-full border rounded p-2 min-h-[100px]"
        />
        <div>
          <button className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50" disabled={pending}>
            {pending ? 'Posting...' : 'Post'}
          </button>
        </div>
      </form>

      <ul className="divide-y">
        {(messages ?? []).map(m => (
          <li key={m.id} className="py-2">
            <div className="text-sm opacity-70">
              <strong>
                {(() => {
                  const userId = m.user_id ?? m.author_user_id
                  if (!userId) return '#unknown'
                  return userDisplayMap[userId] ?? `#${userId.slice(0, 6)}`
                })()}
              </strong>
              {' · '}
              <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString()}</time>
            </div>
            <div className="whitespace-pre-wrap">{m.body}</div>
          </li>
        ))}
      </ul>
    </section>
  )
}
