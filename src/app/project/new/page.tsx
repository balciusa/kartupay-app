import { getCurrentUserId } from '@/lib/supabaseServer'
import { NewProjectForm } from '@/components/Project/NewProjectForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NewProjectPage() {
  const uid = await getCurrentUserId()
  if (!uid) {
    return (
      <main className="p-6 max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">New project</h1>
        <p className="text-sm opacity-70">Please sign in to create a project.</p>
      </main>
    )
  }

  return (
    <main className="p-6 max-w-xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">New project</h1>
      <NewProjectForm />
    </main>
  )
}
