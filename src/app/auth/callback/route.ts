import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const token = url.searchParams.get('token')
  const vtype = (url.searchParams.get('type') || 'magiclink') as 'magiclink'|'recovery'|'invite'
  const redirect = url.searchParams.get('redirect') || '/'
  
  // Track if this is a password reset flow
  let isPasswordReset = false

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
            if (typeof (cookieStore as any)?.set === 'function') {
              ;(cookieStore as any).set({ name, value, ...options })
            }
          } catch {
            // no-op in read-only render
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            if (typeof (cookieStore as any)?.set === 'function') {
              ;(cookieStore as any).set({ name, value: '', ...options })
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
      // PKCE / modern flow (used for magic link and password reset)
      console.log('[auth/callback] Processing PKCE flow with code')
      console.log('[auth/callback] Full URL:', url.toString())
      console.log('[auth/callback] Type param:', vtype)
      console.log('[auth/callback] All search params:', Object.fromEntries(url.searchParams))
      
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        console.error('[auth/callback] PKCE exchange error:', error)
        return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error.message)}`, req.url))
      }
      console.log('[auth/callback] PKCE exchange successful')
      console.log('[auth/callback] Session data:', { 
        hasSession: !!data?.session, 
        userId: data?.session?.user?.id 
      })
      
      // Check if this is a password reset by looking at the URL type parameter
      // Supabase includes type=recovery in the redirect URL for password resets (PKCE flow)
      // Also check for our custom flag or recovery indicators
      if (vtype === 'recovery' || 
          url.pathname.includes('recovery') || 
          url.searchParams.has('type=recovery') ||
          url.searchParams.get('from') === 'password-reset') {
        isPasswordReset = true
        console.log('[auth/callback] Detected password reset flow')
      } else {
        // For PKCE flow, Supabase may not include type in query params if email template is misconfigured
        // Check the full URL string for recovery indicators
        const urlString = url.toString().toLowerCase()
        if (urlString.includes('recovery') || urlString.includes('reset')) {
          isPasswordReset = true
          console.log('[auth/callback] Detected password reset flow via URL string analysis')
        } else {
          console.log('[auth/callback] No recovery type detected in URL - treating as regular login')
        }
      }
    } else if (token) {
      // Legacy token flow (older magic link format)
      console.log('[auth/callback] Processing legacy token flow, type:', vtype)
      // @ts-ignore - accept token_hash param if available in your version
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type: vtype })
      if (error) {
        console.error('[auth/callback] Token verification error:', error)
        return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error.message)}`, req.url))
      }
      console.log('[auth/callback] Token verification successful')
      if (vtype === 'recovery') {
        isPasswordReset = true
        console.log('[auth/callback] Detected password reset flow (legacy)')
      }
    } else {
      console.warn('[auth/callback] No code or token found in URL')
      return NextResponse.redirect(new URL('/?error=invalid_auth_link', req.url))
    }
  } catch (e: any) {
    console.error('[auth/callback] Unexpected error:', e?.message || e)
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(e?.message || 'auth_error')}`, req.url))
  }

  // Redirect to password reset page if this was a password reset, otherwise use redirect param or go home
  const finalRedirect = isPasswordReset ? '/auth/reset' : redirect
  console.log('[auth/callback] Redirecting to:', finalRedirect)
  return NextResponse.redirect(new URL(finalRedirect, req.url))
}
