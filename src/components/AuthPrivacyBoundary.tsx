'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { supabaseBrowser } from '@/lib/supabaseClient'

type AuthPrivacyContextValue = {
  beginAuthExit: () => void
  cancelAuthExit: (message: string) => void
  authExitError: string | null
}

const AuthPrivacyContext = createContext<AuthPrivacyContextValue | null>(null)
const AUTH_PRIVACY_CHANNEL = 'kartupay-auth-privacy'
const AUTH_PRIVACY_STORAGE_KEY = 'kartupay-auth-exit'
type AuthExitPhase = 'started' | 'completed' | 'canceled'
type AuthExitMessage = { type: 'auth-exit'; phase: AuthExitPhase; nonce: string }

export function notifyOtherTabsOfAuthExit(phase: AuthExitPhase) {
  if (typeof window === 'undefined') return
  const message: AuthExitMessage = { type: 'auth-exit', phase, nonce: crypto.randomUUID() }

  try {
    const channel = new BroadcastChannel(AUTH_PRIVACY_CHANNEL)
    channel.postMessage(message)
    channel.close()
  } catch {
    // The storage event below is the compatibility fallback.
  }

  try {
    window.localStorage.setItem(AUTH_PRIVACY_STORAGE_KEY, JSON.stringify(message))
  } catch {
    // Supabase's SIGNED_OUT event still handles environments without storage.
  }
}

const redirectToLogin = () => {
  if (window.location.pathname !== '/login') {
    window.location.replace('/login')
  }
}

export function AuthPrivacyBoundary({ children }: { children: React.ReactNode }) {
  const [contentBlocked, setContentBlocked] = useState(false)
  const [authExitError, setAuthExitError] = useState<string | null>(null)
  const hadAuthenticatedSession = useRef(false)
  const localAuthExitPending = useRef(false)

  const blockContent = useCallback(() => {
    flushSync(() => setContentBlocked(true))
  }, [])

  const blockAndRedirect = useCallback(() => {
    blockContent()
    redirectToLogin()
  }, [blockContent])

  const beginAuthExit = useCallback(() => {
    localAuthExitPending.current = true
    setAuthExitError(null)
    blockContent()
  }, [blockContent])
  const cancelAuthExit = useCallback((message: string) => {
    localAuthExitPending.current = false
    setAuthExitError(message)
    setContentBlocked(false)
  }, [])

  const verifyRestoredSession = useCallback(async () => {
    const privateContentIsMounted = document.querySelector('[data-private-project-content="true"]') !== null
    if (!hadAuthenticatedSession.current && !privateContentIsMounted) return

    blockContent()
    const { data } = await supabaseBrowser.auth.getSession()
    if (!data.session) {
      blockAndRedirect()
      return
    }

    setContentBlocked(false)
  }, [blockAndRedirect, blockContent])

  useEffect(() => {
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
      if (session) {
        hadAuthenticatedSession.current = true
      }

      if (event === 'SIGNED_OUT') {
        if (!localAuthExitPending.current) {
          blockAndRedirect()
        }
      }
    })

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void verifyRestoredSession()
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void verifyRestoredSession()
      }
    }

    const handleAuthExitMessage = (message: AuthExitMessage) => {
      if (message.type !== 'auth-exit') return
      if (message.phase === 'started') blockContent()
      if (message.phase === 'completed') blockAndRedirect()
      if (message.phase === 'canceled') setContentBlocked(false)
    }

    const handleBroadcastMessage = (event: MessageEvent<AuthExitMessage>) => {
      handleAuthExitMessage(event.data)
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_PRIVACY_STORAGE_KEY || !event.newValue) return
      try {
        handleAuthExitMessage(JSON.parse(event.newValue) as AuthExitMessage)
      } catch {
        // Ignore malformed values written by older application versions.
      }
    }

    let authChannel: BroadcastChannel | null = null
    try {
      authChannel = new BroadcastChannel(AUTH_PRIVACY_CHANNEL)
      authChannel.addEventListener('message', handleBroadcastMessage)
    } catch {
      // The storage and Supabase auth listeners remain active.
    }

    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('storage', handleStorage)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    document.documentElement.dataset.authPrivacyReady = 'true'

    return () => {
      subscription.unsubscribe()
      authChannel?.close()
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('storage', handleStorage)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      delete document.documentElement.dataset.authPrivacyReady
    }
  }, [blockAndRedirect, blockContent, verifyRestoredSession])

  const contextValue = useMemo<AuthPrivacyContextValue>(() => ({
    beginAuthExit,
    cancelAuthExit,
    authExitError,
  }), [authExitError, beginAuthExit, cancelAuthExit])

  return (
    <AuthPrivacyContext.Provider value={contextValue}>
      {contentBlocked ? (
        <div
          className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground"
          data-auth-privacy="blocked"
        >
          <p className="text-sm text-muted-foreground" role="status">Signing out securely...</p>
        </div>
      ) : children}
    </AuthPrivacyContext.Provider>
  )
}

export function useAuthPrivacy() {
  const value = useContext(AuthPrivacyContext)
  if (!value) {
    throw new Error('useAuthPrivacy must be used within AuthPrivacyBoundary')
  }
  return value
}
