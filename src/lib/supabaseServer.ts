import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function getSupabaseServer() {
  // In Next 16 the cookies() helper is async.
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          try {
            if (typeof cookieStore?.get === 'function') {
              const cookie = cookieStore.get(name)
              return typeof cookie === 'string' ? cookie : cookie?.value
            }
          } catch {
            // ignore – read may not be supported in this context
          }
          return undefined
        },
        set(name: string, value: string, options: CookieOptions) {
          // In some RSC contexts set/remove can throw — guard them:
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
}

export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user?.id ?? null
}
