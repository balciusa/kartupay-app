import { createProject } from './actions'
import { getCurrentUserId } from '@/lib/supabaseServer'

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
      <form action={createProject} className="grid gap-3">
        <input name="title" placeholder="Project title" className="border rounded px-3 py-2" required />
        <textarea name="description" placeholder="Description (optional)" className="border rounded px-3 py-2" />

        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="text-sm block mb-1">Total (EUR)</label>
            <input
              name="totalEur"
              type="text"
              inputMode="decimal"
              placeholder="199.99"
              className="border rounded px-3 py-2 w-full"
              required
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Min participants</label>
            <input
              name="min_participants"
              type="number"
              min={1}
              className="border rounded px-3 py-2 w-full"
              placeholder="e.g. 5 (optional)"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Max participants (optional)</label>
            <input
              name="max_participants"
              type="number"
              min={1}
              className="border rounded px-3 py-2 w-full"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm block mb-1">Deadline date (optional)</label>
            <input name="deadlineDate" type="date" className="border rounded px-3 py-2 w-full" />
          </div>
          <div>
            <label className="text-sm block mb-1">Deadline time (optional)</label>
            <input name="deadlineTime" type="time" className="border rounded px-3 py-2 w-full" />
          </div>
        </div>

        <button className="px-4 py-2 rounded bg-black text-white">Create</button>
      </form>
      <p className="text-xs opacity-60">You will be added as the organizer, and your active payment links from Settings will be copied.</p>
    </main>
  )
}
