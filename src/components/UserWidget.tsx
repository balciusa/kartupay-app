'use client'

import Link from 'next/link'
import { supabaseBrowser } from '@/lib/supabaseClient'
import { useSupabaseSession } from '@/lib/useSupabaseSession'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export function UserWidget() {
  const { user, loading } = useSupabaseSession()

  const handleLogout = async () => {
    await supabaseBrowser.auth.signOut()
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
    </div>
  )
}
