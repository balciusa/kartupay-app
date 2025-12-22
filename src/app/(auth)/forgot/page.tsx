'use client'

import { useState, FormEvent } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function ForgotPage() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
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
    // Use a dedicated password reset callback URL so we can distinguish it from regular logins
    // This avoids relying on the email template including type=recovery parameter
    const redirectUrl = `${origin}/auth/reset-callback`
    console.log('[ForgotPassword] Requesting password reset for:', email)
    console.log('[ForgotPassword] Redirect URL:', redirectUrl)
    
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    })
    
    if (error) {
      console.error('[ForgotPassword] Error:', error)
      console.error('[ForgotPassword] Error details:', {
        message: error.message,
        status: error.status,
        name: error.name,
        cause: error.cause
      })
      
      // Provide more helpful error messages
      let errorMsg = error.message
      if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
        errorMsg = 'Too many requests. Please wait a few minutes before trying again.'
      } else if (error.message.includes('email') && error.message.includes('not found')) {
        errorMsg = 'If an account exists with this email, a reset link will be sent. Check your spam folder.'
      } else if (error.message.includes('recovery email')) {
        errorMsg = 'Unable to send recovery email. Please check your Supabase email configuration or try again later.'
      }
      
      setMsg(`Error: ${errorMsg}`)
    } else {
      console.log('[ForgotPassword] Success - email should be sent')
      setMsg('Check your email for a reset link. Make sure to check your spam folder if you don\'t see it.')
    }
  }

  return (
    <main className="p-6 max-w-sm mx-auto space-y-3">
      <h1 className="text-2xl font-semibold">Reset password</h1>
      <form onSubmit={onSubmit} className="space-y-2">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        />
        <button className="px-3 py-1.5 rounded bg-black text-white">Send reset link</button>
      </form>
      {msg && <div className="text-sm opacity-80">{msg}</div>}
    </main>
  )
}
