'use client'

import { useState, FormEvent } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function SetPasswordForm() {
  const [pwd, setPwd] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd })
      if (error) throw error
      setMsg('Password updated.')
    } catch (err: any) {
      setMsg(err?.message ?? 'Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <h2 className="text-lg font-medium">Set password</h2>
      <input
        type="password"
        placeholder="New password"
        value={pwd}
        onChange={(e)=>setPwd(e.target.value)}
        className="border rounded px-3 py-2 w-full"
      />
      <button className="px-3 py-1.5 rounded bg-black text-white" disabled={loading}>
        {loading ? 'Saving...' : 'Save password'}
      </button>
      {msg && <div className="text-sm opacity-80">{msg}</div>}
    </form>
  )
}
