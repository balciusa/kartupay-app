'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export default function LoginForm() {
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [msgTone, setMsgTone] = useState<'info' | 'success' | 'error'>('info')
  const [loading, setLoading] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    setMsgTone('info')
    setLoading(true)
    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setMsgTone('success')
        setMsg('Signed in!')
        window.location.href = '/'
      } else {
        const redirectUrl = `${origin}/auth/callback`
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true, emailRedirectTo: redirectUrl },
        })

        if (error) throw error
        setMsgTone('success')
        setMsg('Magic link sent. Check your email (including spam folder).')
      }
    } catch (err: unknown) {
      setMsgTone('error')
      setMsg(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Sign-in method</div>
        <div className="inline-flex rounded-full border border-border bg-muted/40 p-1">
          <button
            type="button"
            className={cn(
              'rounded-full px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
              mode === 'password' ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground'
            )}
            onClick={() => setMode('password')}
            aria-pressed={mode === 'password'}
          >
          Password
          </button>
          <button
            type="button"
            className={cn(
              'rounded-full px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
              mode === 'magic' ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground'
            )}
            onClick={() => setMode('magic')}
            aria-pressed={mode === 'magic'}
          >
          Magic link
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="login-email" className="text-sm font-medium">Email</label>
        <Input
          id="login-email"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={event => setEmail(event.target.value)}
        />
      </div>

      {mode === 'password' && (
        <div className="space-y-2">
          <label htmlFor="login-password" className="text-sm font-medium">Password</label>
          <Input
            id="login-password"
            type="password"
            required
            placeholder="Your password"
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
        </div>
      )}

      <Button type="submit" disabled={loading} className="w-full rounded-full">
        {loading ? 'Please wait...' : (mode === 'password' ? 'Sign in' : 'Send magic link')}
      </Button>

      {mode === 'password' && (
        <div className="text-sm">
          <Link href="/auth/forgot" className="text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
      )}

      {msg && (
        <div
          aria-live="polite"
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            msgTone === 'error'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : msgTone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border bg-muted text-muted-foreground'
          )}
        >
          {msg}
        </div>
      )}
    </form>
  )
}
