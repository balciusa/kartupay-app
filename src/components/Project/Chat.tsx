'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { markChatRead, postMessage } from '@/app/project/[id]/actions'

type Msg = {
  id: string
  user_id?: string
  author_user_id?: string
  parent_id?: string | null
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
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const hasMarked = useRef(false)
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  useEffect(() => {
    const el = replyTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [replyText, replyOpenId])

  useEffect(() => {
    if (!canRead || hasMarked.current) return
    hasMarked.current = true
    markChatRead(projectId).catch(err => {
      console.error('[Chat] markChatRead failed', err)
    })
  }, [canRead, projectId])

  const authorLabel = (m: Msg) => {
    const userId = m.user_id ?? m.author_user_id
    if (!userId) return '#unknown'
    return userDisplayMap[userId] ?? `#${userId.slice(0, 6)}`
  }

  const topLevel = (messages ?? []).filter(m => !m.parent_id)
  const repliesByParent = new Map<string, Msg[]>()
  for (const msg of messages ?? []) {
    if (!msg.parent_id) continue
    const list = repliesByParent.get(msg.parent_id) ?? []
    list.push(msg)
    repliesByParent.set(msg.parent_id, list)
  }

  return (
    <section className="space-y-3">
      <form
        action={formData =>
          start(async () => {
            const body = String(formData.get('body') || '').trim()
            await postMessage(projectId, body)
            setText('')
          })}
        className="space-y-2"
      >
        <textarea
          name="body"
          placeholder="Write a message"
          ref={textareaRef}
          value={text}
          onChange={event => setText(event.target.value)}
          rows={1}
          className="w-full border rounded-full px-4 py-2 min-h-[44px] max-h-48 resize-none overflow-hidden"
        />
        <div>
          <button className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50" disabled={pending}>
            {pending ? 'Posting...' : 'Post'}
          </button>
        </div>
      </form>

      <ul className="divide-y">
        {topLevel.map(m => (
          <li key={m.id} className="py-2">
            <div className="text-sm opacity-70">
              <strong>{authorLabel(m)}</strong>
              {' · '}
              <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString()}</time>
            </div>
            <div className="whitespace-pre-wrap">{m.body}</div>
            <div className="mt-2">
              <button
                type="button"
                className="text-xs text-slate-600 hover:text-black"
                onClick={() => {
                  setReplyOpenId(replyOpenId === m.id ? null : m.id)
                  setReplyText('')
                }}
              >
                Reply
              </button>
            </div>

            {replyOpenId === m.id ? (
              <form
                className="mt-2 space-y-2"
                action={() =>
                  start(async () => {
                    if (!replyText.trim()) return
                    await postMessage(projectId, replyText, m.id)
                    setReplyText('')
                    setReplyOpenId(null)
                  })}
              >
                <textarea
                  ref={replyTextareaRef}
                  value={replyText}
                  onChange={event => setReplyText(event.target.value)}
                  rows={1}
                  className="w-full border rounded-full px-4 py-2 min-h-[40px] max-h-40 resize-none overflow-hidden"
                  placeholder="Write a reply"
                />
                <div>
                  <button
                    className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
                    disabled={pending || replyText.trim().length === 0}
                  >
                    {pending ? 'Posting...' : 'Reply'}
                  </button>
                </div>
              </form>
            ) : null}

            {(repliesByParent.get(m.id) ?? []).length ? (
              <ul className="mt-3 space-y-3 border-l pl-4">
                {(repliesByParent.get(m.id) ?? []).map(r => (
                  <li key={r.id}>
                    <div className="text-sm opacity-70">
                      <strong>{authorLabel(r)}</strong>
                      {' · '}
                      <time dateTime={r.created_at}>{new Date(r.created_at).toLocaleString()}</time>
                    </div>
                    <div className="whitespace-pre-wrap">{r.body}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
