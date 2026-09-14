'use client'

import { useState, FormEvent } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export default function SetPasswordForm() {
  const [pwd, setPwd] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [msgTone, setMsgTone] = useState<'info' | 'success' | 'error'>('info')
  const [loading, setLoading] = useState(false)
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    setMsgTone('info')
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd })
      if (error) throw error
      setMsgTone('success')
      setMsg('Password updated.')
    } catch (err: unknown) {
      setMsgTone('error')
      setMsg(err instanceof Error ? err.message : 'Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Set password</h2>
        <p className="text-xs text-muted-foreground">
          Choose a password with at least 8 characters.
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="settings-password" className="text-sm font-medium">New password</label>
        <Input
          id="settings-password"
          type="password"
          placeholder="New password"
          value={pwd}
          onChange={event => setPwd(event.target.value)}
          required
          minLength={8}
        />
      </div>
      <Button className="rounded-full" disabled={loading}>
        {loading ? 'Saving...' : 'Save password'}
      </Button>
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
