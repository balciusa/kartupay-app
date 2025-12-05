'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabaseBrowser } from '@/lib/supabaseClient'
import { useSupabaseSession } from '@/lib/useSupabaseSession'

export default function LoginPage() {
  const { user, session } = useSupabaseSession()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    if (code) {
      setLoading(true)
      supabaseBrowser.auth
        .exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) setStatus(error.message)
          else setStatus('Logged in successfully.')
        })
        .finally(() => setLoading(false))
    }
  }, [])

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus(null)
    setLoading(true)
    const redirectTo = `${window.location.origin}/login`
    const { error } = await supabaseBrowser.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    })
    if (error) setStatus(error.message)
    else setStatus('Check your email for the magic link.')
    setLoading(false)
  }

  const handleLogout = async () => {
    setLoading(true)
    await supabaseBrowser.auth.signOut()
    setLoading(false)
    setStatus('Logged out.')
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Login</h1>
      <p className="text-sm opacity-80">Use your email to receive a one-time login link.</p>
      <form onSubmit={handleSendOtp} className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium">
          Email
          <Input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="mt-1"
          />
        </label>
        <Button type="submit" disabled={loading}>
          {loading ? 'Sending…' : 'Send login link'}
        </Button>
        {status && <div className="text-sm">{status}</div>}
      </form>
      <div className="rounded-xl border bg-white p-4 shadow-sm space-y-2">
        <div className="text-sm font-medium">Session</div>
        {user ? (
          <div className="space-y-2">
            <div className="text-sm">Signed in as {user.email}</div>
            <Button variant="outline" onClick={handleLogout} disabled={loading}>
              Logout
            </Button>
          </div>
        ) : (
          <div className="text-sm opacity-70">Not signed in.</div>
        )}
      </div>
      {session?.access_token && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide opacity-70">Access token</div>
          <code className="break-all text-[11px]">{session.access_token}</code>
        </div>
      )}
    </main>
  )
}
