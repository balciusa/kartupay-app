'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { supabaseBrowser } from '@/lib/supabaseClient'

type AuthPrivacyContextValue = {
  beginAuthExit: () => string
  cancelAuthExit: (attemptId: string, message: string) => void
  completeAuthExit: (attemptId: string) => void
  authExitError: string | null
}

const AuthPrivacyContext = createContext<AuthPrivacyContextValue | null>(null)
const AUTH_PRIVACY_CHANNEL = 'kartupay-auth-privacy'
const AUTH_PRIVACY_STORAGE_KEY = 'kartupay-auth-exit'
const AUTH_PRIVACY_ATTEMPT_PREFIX = `${AUTH_PRIVACY_STORAGE_KEY}:`
const AUTH_EXIT_RECORD_TTL_MS = 5 * 60 * 1000
type AuthExitPhase = 'started' | 'completed' | 'canceled'
type AuthExitMessage = {
  type: 'auth-exit'
  phase: AuthExitPhase
  attemptId: string
  recordedAt?: number
}

function readPersistedAuthExitRecords() {
  const records = new Map<string, AuthExitMessage>()
  if (typeof window === 'undefined') return records

  const now = Date.now()
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key?.startsWith(AUTH_PRIVACY_ATTEMPT_PREFIX)) continue

    try {
      const message = JSON.parse(window.localStorage.getItem(key) ?? '') as AuthExitMessage
      if (
        message.type !== 'auth-exit' ||
        typeof message.attemptId !== 'string' ||
        !['started', 'completed', 'canceled'].includes(message.phase)
      ) continue

      if (
        typeof message.recordedAt === 'number' &&
        now - message.recordedAt > AUTH_EXIT_RECORD_TTL_MS
      ) {
        window.localStorage.removeItem(key)
        index -= 1
        continue
      }

      records.set(message.attemptId, message)
    } catch {
      // Ignore malformed or obsolete records.
    }
  }

  return records
}

export function notifyOtherTabsOfAuthExit(phase: AuthExitPhase, attemptId: string) {
  if (typeof window === 'undefined') return
  const message: AuthExitMessage = {
    type: 'auth-exit',
    phase,
    attemptId,
    recordedAt: Date.now(),
  }

  try {
    // The attempt-specific record is durable shared state. A tab handling a
    // failed logout can synchronously see another in-flight attempt even when
    // BroadcastChannel or storage events have not been delivered yet.
    window.localStorage.setItem(
      `${AUTH_PRIVACY_ATTEMPT_PREFIX}${attemptId}`,
      JSON.stringify(message),
    )
    // Keep the original key during rolling deployments for older open tabs.
    window.localStorage.setItem(AUTH_PRIVACY_STORAGE_KEY, JSON.stringify(message))
  } catch {
    // BroadcastChannel and Supabase auth events remain available.
  }

  try {
    const channel = new BroadcastChannel(AUTH_PRIVACY_CHANNEL)
    channel.postMessage(message)
    channel.close()
  } catch {
    // The storage events above are the compatibility fallback.
  }
}

const redirectToLogin = () => {
  // Replacing /login with itself deliberately reloads tabs whose content was
  // blocked by another tab's logout. The fresh document is safe to reveal.
  window.location.replace('/login')
}

export function AuthPrivacyBoundary({ children }: { children: React.ReactNode }) {
  const [contentBlocked, setContentBlocked] = useState(false)
  const [authExitError, setAuthExitError] = useState<string | null>(null)
  const hadAuthenticatedSession = useRef(false)
  const activeAuthExits = useRef(new Set<string>())
  const finishedAuthExits = useRef(new Set<string>())
  const localAuthExits = useRef(new Set<string>())
  const sessionVerificationGeneration = useRef(0)

  const blockContent = useCallback(() => {
    flushSync(() => setContentBlocked(true))
  }, [])

  const blockAndRedirect = useCallback(() => {
    blockContent()
    redirectToLogin()
  }, [blockContent])

  const registerAuthExit = useCallback((attemptId: string, isLocal: boolean) => {
    // BroadcastChannel and storage are independent transports. A late duplicate
    // start must not revive an attempt whose terminal phase already arrived.
    if (finishedAuthExits.current.has(attemptId)) return
    sessionVerificationGeneration.current += 1
    activeAuthExits.current.add(attemptId)
    if (isLocal) localAuthExits.current.add(attemptId)
    setAuthExitError(null)
    blockContent()
  }, [blockContent])

  const reconcilePersistedAuthExits = useCallback(() => {
    for (const [attemptId, message] of readPersistedAuthExitRecords()) {
      if (message.phase === 'started' && !finishedAuthExits.current.has(attemptId)) {
        activeAuthExits.current.add(attemptId)
      } else {
        activeAuthExits.current.delete(attemptId)
        finishedAuthExits.current.add(attemptId)
      }
    }
  }, [])

  const beginAuthExit = useCallback(() => {
    const attemptId = crypto.randomUUID()
    registerAuthExit(attemptId, true)
    return attemptId
  }, [registerAuthExit])

  const completeAuthExit = useCallback((attemptId: string) => {
    sessionVerificationGeneration.current += 1
    finishedAuthExits.current.add(attemptId)
    activeAuthExits.current.delete(attemptId)
    localAuthExits.current.delete(attemptId)
    blockAndRedirect()
  }, [blockAndRedirect])

  const verifyRestoredSession = useCallback(async (force = false) => {
    const privateContentIsMounted = document.querySelector('[data-private-project-content="true"]') !== null
    if (!force && !hadAuthenticatedSession.current && !privateContentIsMounted) return

    const verificationGeneration = ++sessionVerificationGeneration.current
    blockContent()
    const { data } = await supabaseBrowser.auth.getSession()
    reconcilePersistedAuthExits()

    // A logout may start while the session lookup is in flight. Never let an
    // earlier lookup override that newer privacy state.
    if (
      verificationGeneration !== sessionVerificationGeneration.current ||
      activeAuthExits.current.size > 0
    ) return

    if (!data.session) {
      blockAndRedirect()
      return
    }

    setContentBlocked(false)
  }, [blockAndRedirect, blockContent, reconcilePersistedAuthExits])

  const cancelAuthExit = useCallback((attemptId: string, message?: string) => {
    sessionVerificationGeneration.current += 1
    finishedAuthExits.current.add(attemptId)
    activeAuthExits.current.delete(attemptId)
    localAuthExits.current.delete(attemptId)
    reconcilePersistedAuthExits()
    if (message) setAuthExitError(message)

    if (activeAuthExits.current.size > 0) {
      blockContent()
      return
    }

    // A SIGNED_OUT event may have raced with the failed request. Revalidate
    // instead of revealing cached content solely because this attempt ended.
    void verifyRestoredSession(true)
  }, [blockContent, reconcilePersistedAuthExits, verifyRestoredSession])

  useEffect(() => {
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
      if (session) {
        hadAuthenticatedSession.current = true
      }

      if (event === 'SIGNED_OUT') {
        if (localAuthExits.current.size === 0) {
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
      if (message.type !== 'auth-exit' || typeof message.attemptId !== 'string') return
      if (message.phase === 'started') registerAuthExit(message.attemptId, false)
      if (message.phase === 'completed') completeAuthExit(message.attemptId)
      if (message.phase === 'canceled') cancelAuthExit(message.attemptId)
    }

    const handleBroadcastMessage = (event: MessageEvent<AuthExitMessage>) => {
      handleAuthExitMessage(event.data)
    }

    const handleStorage = (event: StorageEvent) => {
      if (
        (event.key !== AUTH_PRIVACY_STORAGE_KEY &&
          !event.key?.startsWith(AUTH_PRIVACY_ATTEMPT_PREFIX)) ||
        !event.newValue
      ) return
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
  }, [blockAndRedirect, cancelAuthExit, completeAuthExit, registerAuthExit, verifyRestoredSession])

  const contextValue = useMemo<AuthPrivacyContextValue>(() => ({
    beginAuthExit,
    cancelAuthExit,
    completeAuthExit,
    authExitError,
  }), [authExitError, beginAuthExit, cancelAuthExit, completeAuthExit])

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
