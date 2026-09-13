import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const token = url.searchParams.get('token')

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          try {
            if (typeof cookieStore?.get === 'function') {
              return cookieStore.get(name)?.value
            }
          } catch {
            // ignore – read may not be supported in this context
          }
          return undefined
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            if (typeof cookieStore.set === 'function') {
              cookieStore.set({ name, value, ...options })
            }
          } catch {
            // no-op in read-only render
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            if (typeof cookieStore.set === 'function') {
              cookieStore.set({ name, value: '', ...options })
            }
          } catch {
            // no-op in read-only render
          }
        },
      },
    }
  )

  try {
    if (code) {
      // PKCE flow for password reset
      console.log('[reset-callback] Processing password reset PKCE flow')
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        console.error('[reset-callback] PKCE exchange error:', error)
        return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error.message)}`, req.url))
      }
      console.log('[reset-callback] Password reset session established')
    } else if (token) {
      // Legacy token flow
      console.log('[reset-callback] Processing password reset token flow')
      const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'recovery' })
      if (error) {
        console.error('[reset-callback] Token verification error:', error)
        return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error.message)}`, req.url))
      }
      console.log('[reset-callback] Password reset token verified')
    } else {
      console.warn('[reset-callback] No code or token found in URL')
      return NextResponse.redirect(new URL('/?error=invalid_reset_link', req.url))
    }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : error
    console.error('[reset-callback] Unexpected error:', detail)
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(detail ? String(detail) : 'reset_error')}`, req.url))
  }

  // Always redirect to password reset page since this is a dedicated reset callback
  console.log('[reset-callback] Redirecting to /auth/reset')
  return NextResponse.redirect(new URL('/auth/reset', req.url))
}
