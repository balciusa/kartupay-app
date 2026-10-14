'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

type AccessExitContextValue = {
  beginAccessExit: (projectId: string) => string
  cancelAccessExit: (projectId: string, attemptId: string) => Promise<void>
  completeAccessExit: (projectId: string, attemptId: string) => void
}

const AccessExitContext = createContext<AccessExitContextValue | null>(null)
const CHANNEL_NAME = 'kartupay-project-access'
const STORAGE_PREFIX = 'kartupay-project-access:'
const RECORD_TTL_MS = 5 * 60 * 1000

type AccessMessage = {
  type: 'project-access'
  phase: 'started' | 'canceled' | 'revoked'
  projectId: string
  attemptId: string
  recordedAt: number
}

const projectStoragePrefix = (projectId: string) => `${STORAGE_PREFIX}${projectId}:`
const attemptStorageKey = (projectId: string, attemptId: string) =>
  `${projectStoragePrefix(projectId)}attempt:${attemptId}`
const revokedStorageKey = (projectId: string) => `${projectStoragePrefix(projectId)}revoked`

function publish(message: AccessMessage) {
  try {
    const key = message.phase === 'revoked'
      ? revokedStorageKey(message.projectId)
      : attemptStorageKey(message.projectId, message.attemptId)
    window.localStorage.setItem(key, JSON.stringify(message))
    if (message.phase === 'revoked') {
      window.localStorage.setItem(attemptStorageKey(message.projectId, message.attemptId), JSON.stringify(message))
    }
  } catch {
    // BroadcastChannel remains available in browsers that deny storage.
  }
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage(message)
    channel.close()
  } catch {
    // The storage event remains as a compatibility path.
  }
}

function projectIdFromPathname() {
  if (typeof window === 'undefined') return null
  return /^\/project\/([^/?#]+)/.exec(window.location.pathname)?.[1] ?? null
}

function pendingProjectFromStorage() {
  const projectId = projectIdFromPathname()
  if (!projectId) return null
  const prefix = projectStoragePrefix(projectId)
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(prefix) || !key.includes(':attempt:')) continue
      const message = JSON.parse(window.localStorage.getItem(key) ?? '') as AccessMessage
      if (message.phase === 'started' && Date.now() - Number(message.recordedAt ?? 0) <= RECORD_TTL_MS) {
        return projectId
      }
    }
  } catch {
    return null
  }
  return null
}

export function PrivateProjectAccessBoundary({ children }: { children: React.ReactNode }) {
  const [blockedProjectId, setBlockedProjectId] = useState<string | null>(pendingProjectFromStorage)
  const attempts = useRef(new Map<string, Set<string>>())
  const verificationGeneration = useRef(0)

  const block = useCallback((projectId: string) => {
    flushSync(() => setBlockedProjectId(projectId))
  }, [])

  const reconcilePersistedState = useCallback((projectId: string) => {
    const pending = new Set<string>()
    let revoked = false
    const prefix = projectStoragePrefix(projectId)
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index)
        if (!key?.startsWith(prefix)) continue
        try {
          const message = JSON.parse(window.localStorage.getItem(key) ?? '') as AccessMessage
          if (Date.now() - Number(message.recordedAt ?? 0) > RECORD_TTL_MS) {
            window.localStorage.removeItem(key)
            index -= 1
            continue
          }
          if (message.phase === 'started') pending.add(message.attemptId)
          if (message.phase === 'revoked') revoked = true
        } catch {
          window.localStorage.removeItem(key)
          index -= 1
        }
      }
    } catch {
      // In-memory state and BroadcastChannel remain available.
    }
    attempts.current.set(projectId, pending)
    return { pending: pending.size > 0, revoked }
  }, [])

  const clearPersistedState = useCallback((projectId: string) => {
    const prefix = projectStoragePrefix(projectId)
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index)
        if (!key?.startsWith(prefix)) continue
        window.localStorage.removeItem(key)
        index -= 1
      }
    } catch {
      // The fresh server render remains authoritative.
    }
  }, [])

  const verifyMembership = useCallback(async (projectId: string) => {
    const generation = ++verificationGeneration.current
    block(projectId)
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/membership`, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      reconcilePersistedState(projectId)
      if (generation !== verificationGeneration.current || (attempts.current.get(projectId)?.size ?? 0) > 0) {
        return false
      }
      if (!response.ok) {
        window.location.replace(`/project/${projectId}`)
        return false
      }
      clearPersistedState(projectId)
      setBlockedProjectId(current => current === projectId ? null : current)
      return true
    } catch {
      if (generation === verificationGeneration.current) window.location.replace(`/project/${projectId}`)
      return false
    }
  }, [block, clearPersistedState, reconcilePersistedState])

  const register = useCallback((projectId: string, attemptId: string) => {
    verificationGeneration.current += 1
    const projectAttempts = attempts.current.get(projectId) ?? new Set<string>()
    projectAttempts.add(attemptId)
    attempts.current.set(projectId, projectAttempts)
    block(projectId)
  }, [block])

  const beginAccessExit = useCallback((projectId: string) => {
    const attemptId = crypto.randomUUID()
    register(projectId, attemptId)
    publish({ type: 'project-access', phase: 'started', projectId, attemptId, recordedAt: Date.now() })
    return attemptId
  }, [register])

  const cancelAccessExit = useCallback(async (projectId: string, attemptId: string) => {
    attempts.current.get(projectId)?.delete(attemptId)
    publish({ type: 'project-access', phase: 'canceled', projectId, attemptId, recordedAt: Date.now() })
    if ((attempts.current.get(projectId)?.size ?? 0) === 0) await verifyMembership(projectId)
  }, [verifyMembership])

  const completeAccessExit = useCallback((projectId: string, attemptId: string) => {
    register(projectId, attemptId)
    publish({ type: 'project-access', phase: 'revoked', projectId, attemptId, recordedAt: Date.now() })
    window.location.replace(`/project/${projectId}`)
  }, [register])

  useEffect(() => {
    const handleMessage = (message: AccessMessage) => {
      if (message.type !== 'project-access') return
      if (message.phase === 'started' || message.phase === 'revoked') register(message.projectId, message.attemptId)
      if (message.phase === 'revoked') window.location.replace(`/project/${message.projectId}`)
      if (message.phase === 'canceled') {
        attempts.current.get(message.projectId)?.delete(message.attemptId)
        if ((attempts.current.get(message.projectId)?.size ?? 0) === 0) void verifyMembership(message.projectId)
      }
    }
    const handleStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(STORAGE_PREFIX) || !event.newValue) return
      try { handleMessage(JSON.parse(event.newValue) as AccessMessage) } catch { /* Ignore malformed state. */ }
    }
    const verifyRestoredProject = () => {
      const projectId = projectIdFromPathname()
      if (projectId) void verifyMembership(projectId)
    }
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) verifyRestoredProject()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') verifyRestoredProject()
    }

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.addEventListener('message', event => handleMessage(event.data as AccessMessage))
    } catch {
      // The storage event remains available.
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisibility)
    const currentProjectId = projectIdFromPathname()
    if (currentProjectId) {
      const persisted = reconcilePersistedState(currentProjectId)
      const privateContentIsMounted = document.querySelector('[data-private-project-content="true"]') !== null
      if (persisted.pending || (persisted.revoked && privateContentIsMounted)) {
        window.setTimeout(() => void verifyMembership(currentProjectId), 0)
      } else if (persisted.revoked) {
        clearPersistedState(currentProjectId)
      }
    }

    return () => {
      channel?.close()
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [clearPersistedState, reconcilePersistedState, register, verifyMembership])

  const value = useMemo(() => ({ beginAccessExit, cancelAccessExit, completeAccessExit }), [
    beginAccessExit,
    cancelAccessExit,
    completeAccessExit,
  ])

  return (
    <AccessExitContext.Provider value={value}>
      {blockedProjectId ? (
        <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground" data-project-access="blocked">
          <p className="text-sm text-muted-foreground" role="status">Updating private project access...</p>
        </main>
      ) : children}
    </AccessExitContext.Provider>
  )
}

export function usePrivateProjectAccess() {
  const value = useContext(AccessExitContext)
  if (!value) throw new Error('usePrivateProjectAccess must be used within PrivateProjectAccessBoundary')
  return value
}
