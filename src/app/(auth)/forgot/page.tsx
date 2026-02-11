'use client'

import { useState, FormEvent } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export default function ForgotPage() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [msgTone, setMsgTone] = useState<'info' | 'error' | 'success'>('info')
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
    // Use a dedicated password reset callback URL so we can distinguish it from regular logins
    // This avoids relying on the email template including type=recovery parameter
    const redirectUrl = `${origin}/auth/reset-callback`

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    })

    if (error) {
      // Provide more helpful error messages
      let errorMsg = error.message
      if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
        errorMsg = 'Too many requests. Please wait a few minutes before trying again.'
      } else if (error.message.includes('email') && error.message.includes('not found')) {
        errorMsg = 'If an account exists with this email, a reset link will be sent. Check your spam folder.'
      } else if (error.message.includes('recovery email')) {
        errorMsg = 'Unable to send recovery email. Please check your Supabase email configuration or try again later.'
      }
      setMsgTone('error')
      setMsg(`Error: ${errorMsg}`)
    } else {
      setMsgTone('success')
      setMsg('Check your email for a reset link. Make sure to check your spam folder if you don\'t see it.')
    }
  }

  return (
    <main className="mx-auto max-w-md py-6 md:py-8">
      <section className="surface-card p-6 md:p-7 space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
          <p className="text-sm text-muted-foreground">Enter the email associated with your account.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="forgot-email" className="text-sm font-medium">Email</label>
            <Input
              id="forgot-email"
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={event => setEmail(event.target.value)}
            />
          </div>
          <Button className="w-full rounded-full">Send reset link</Button>
        </form>
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
