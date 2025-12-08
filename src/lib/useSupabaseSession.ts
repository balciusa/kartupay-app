'use client'

import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabaseBrowser } from './supabaseClient'

export function useSupabaseSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    // Initial session check - createBrowserClient reads cookies automatically
    supabaseBrowser.auth.getSession().then(({ data }) => {
      const currentSession = data.session ?? null
      setSession(currentSession)
      setUser((currentSession?.user as User | null) ?? null)
      setLoading(false)
    })

    // Listen for auth state changes
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setUser((newSession?.user as User | null) ?? null)
      setLoading(false)
    })
    
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return {
    session,
    user,
    loading,
  }
}
