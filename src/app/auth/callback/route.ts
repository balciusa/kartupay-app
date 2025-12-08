import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const token = url.searchParams.get('token')
  const vtype = (url.searchParams.get('type') || 'magiclink') as 'magiclink'|'recovery'|'invite'
  const redirect = url.searchParams.get('redirect') || '/'

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
      // PKCE / modern flow
      await supabase.auth.exchangeCodeForSession(code)
    } else if (token) {
      // Token flow (email magic link). Newer SDKs accept token_hash without email.
      // If your sdk version requires email, this will no-op; but we prefer PKCE anyway.
      // @ts-ignore - accept token_hash param if available in your version
      await supabase.auth.verifyOtp({ token_hash: token, type: vtype })
    }
  } catch (e: any) {
    console.error('[auth/callback] auth exchange error:', e?.message || e)
  }

  return NextResponse.redirect(new URL(redirect, req.url))
}
