'use client'

import { useState, FormEvent } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function LoginForm() {
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
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
    setLoading(true)
    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setMsg('Signed in!')
        window.location.href = '/'
      } else {
        const redirectUrl = `${origin}/auth/callback`
        console.log('[LoginForm] Requesting magic link for:', email)
        console.log('[LoginForm] Redirect URL:', redirectUrl)
        
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true, emailRedirectTo: redirectUrl },
        })
        
        if (error) {
          console.error('[LoginForm] Magic link error:', error)
          throw error
        }
        console.log('[LoginForm] Magic link sent successfully')
        setMsg('Magic link sent. Check your email (including spam folder).')
      }
    } catch (err: any) {
      setMsg(err?.message ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex gap-2 text-sm">
        <button type="button" className={mode==='password'?'font-semibold':''} onClick={()=>setMode('password')}>
          Password
        </button>
        <span className="opacity-50">/</span>
        <button type="button" className={mode==='magic'?'font-semibold':''} onClick={()=>setMode('magic')}>
          Magic link
        </button>
      </div>

      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e)=>setEmail(e.target.value)}
        className="border rounded px-3 py-2 w-full"
      />

      {mode === 'password' && (
        <input
          type="password"
          required
          placeholder="Your password"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        />
      )}

      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
      >
        {loading ? 'Please wait...' : (mode === 'password' ? 'Sign in' : 'Send magic link')}
      </button>

      {mode === 'password' && (
        <div className="text-sm">
          <a href="/auth/forgot">Forgot password?</a>
        </div>
      )}

      {msg && <div className="text-sm opacity-80">{msg}</div>}
    </form>
  )
}
