'use client'

import { useAuthPrivacy, notifyOtherTabsOfAuthExit } from '@/components/AuthPrivacyBoundary'
import Link from 'next/link'
import { supabaseBrowser } from '@/lib/supabaseClient'
import { useSupabaseSession } from '@/lib/useSupabaseSession'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export function UserWidget() {
  const { user, loading } = useSupabaseSession()
  const { authExitError, beginAuthExit, cancelAuthExit, completeAuthExit } = useAuthPrivacy()

  const handleLogout = async () => {
    const attemptId = beginAuthExit()
    notifyOtherTabsOfAuthExit('started', attemptId)
    const { error } = await supabaseBrowser.auth.signOut({ scope: 'global' })

    if (error) {
      notifyOtherTabsOfAuthExit('canceled', attemptId)
      cancelAuthExit(attemptId, 'Logout failed. Please try again.')
      return
    }

    notifyOtherTabsOfAuthExit('completed', attemptId)
    completeAuthExit(attemptId)
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Checking auth...</div>
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href="/login">Log in</Link>
        </Button>
      </div>
    )
  }

  const initials = user.email?.slice(0, 2).toUpperCase() ?? 'U'

  return (
    <div className="flex items-center gap-2">
      <Avatar className="h-8 w-8 border">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="max-w-40 text-sm">
        <div className="truncate font-medium leading-none">{user.email}</div>
        <div className="text-xs text-muted-foreground">Signed in</div>
      </div>
      <Button size="sm" variant="outline" onClick={handleLogout}>
        Logout
      </Button>
      {authExitError && <span className="sr-only" role="alert">{authExitError}</span>}
    </div>
  )
}
