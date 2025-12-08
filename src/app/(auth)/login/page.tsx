'use client'
import { useState, FormEvent } from 'react'
import { supabaseBrowser } from '@/lib/supabaseClient'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const redirectTo = `${window.location.origin}/auth/callback?redirect=/`
      const { error } = await supabaseBrowser.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo }
      })
      if (error) throw error
      setSent(true)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to send magic link')
    }
  }

  return (
    <main className="p-6 max-w-sm mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {sent ? (
        <div className="text-sm">Magic link sent. Check your email.</div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={e=>setEmail(e.target.value)}
            placeholder="you@example.com"
            className="border rounded px-3 py-2 w-full"
            required
          />
          <button className="px-3 py-2 rounded bg-black text-white w-full">Send magic link</button>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </form>
      )}
    </main>
  )
}
