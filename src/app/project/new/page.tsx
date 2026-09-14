import { getCurrentUserId } from '@/lib/supabaseServer'
import { NewProjectForm } from '@/components/Project/NewProjectForm'
import { headers } from 'next/headers'
import { resolveProjectDateLocale } from '@/lib/projectDateStrings'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NewProjectPage() {
  const uid = await getCurrentUserId()
  const requestHeaders = await headers()
  const locale = resolveProjectDateLocale(requestHeaders.get('accept-language'))
  if (!uid) {
    return (
      <main className="mx-auto max-w-2xl py-6 md:py-8">
        <section className="surface-card p-6 md:p-7 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
          <p className="text-sm text-muted-foreground">Please sign in to create a project.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl py-6 md:py-8 space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="text-sm text-muted-foreground">Capture the essentials and invite your group to join.</p>
      </div>
      <section className="surface-card p-5 md:p-6">
        <NewProjectForm locale={locale} />
      </section>
    </main>
  )
}
