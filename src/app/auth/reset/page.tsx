'use client'

import { useEffect, useState, FormEvent } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function ResetPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [pwd, setPwd] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Check if we have a valid session for password reset
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('[ResetPage] Error getting session:', error)
        setMsg('Session error. Please request a new password reset link.')
        return
      }
      
      if (!data.session) {
        console.warn('[ResetPage] No session found')
        setMsg('No active session. Please request a new password reset link.')
        return
      }
      
      console.log('[ResetPage] Session found, ready to reset password')
      setReady(true)
    })
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pwd })
    setMsg(error ? error.message : 'Password updated. You can close this tab.')
  }

  return (
    <main className="p-6 max-w-sm mx-auto space-y-3">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      {!ready ? (
        <div>Preparing...</div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-2">
          <input
            type="password"
            placeholder="New password"
            value={pwd}
            onChange={(e)=>setPwd(e.target.value)}
            className="border rounded px-3 py-2 w-full"
            required
          />
          <button className="px-3 py-1.5 rounded bg-black text-white">Save</button>
        </form>
      )}
      {msg && <div className="text-sm opacity-80">{msg}</div>}
    </main>
  )
}
