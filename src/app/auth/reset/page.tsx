'use client'

import { useEffect, useMemo, useState, FormEvent } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export default function ResetPage() {
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  const [pwd, setPwd] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [msgTone, setMsgTone] = useState<'info' | 'error' | 'success'>('info')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Check if we have a valid session for password reset
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('[ResetPage] Error getting session:', error)
        setMsgTone('error')
        setMsg('Session error. Please request a new password reset link.')
        return
      }
      
      if (!data.session) {
        console.warn('[ResetPage] No session found')
        setMsgTone('error')
        setMsg('No active session. Please request a new password reset link.')
        return
      }
      
      console.log('[ResetPage] Session found, ready to reset password')
      setReady(true)
    })
  }, [supabase])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    setMsgTone('info')
    const { error } = await supabase.auth.updateUser({ password: pwd })
    if (error) {
      setMsgTone('error')
      setMsg(error.message)
      return
    }
    setMsgTone('success')
    setMsg('Password updated. You can close this tab.')
  }

  return (
    <main className="mx-auto max-w-md py-6 md:py-8">
      <section className="surface-card p-6 md:p-7 space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">Set a secure password to continue using KartuPay.</p>
        </div>
        {!ready ? (
          <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Preparing...</div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="reset-password" className="text-sm font-medium">New password</label>
              <Input
                id="reset-password"
                type="password"
                placeholder="New password"
                value={pwd}
                onChange={event => setPwd(event.target.value)}
                required
              />
            </div>
            <Button className="w-full rounded-full">Save password</Button>
          </form>
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
      </section>
    </main>
  )
}
