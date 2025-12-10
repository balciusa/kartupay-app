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

  const today = new Date()
  const yyyy = today.getFullYear()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const hh = String(Math.max(9, today.getHours())).padStart(2, '0')
  const mi = String(today.getMinutes()).padStart(2, '0')

  return (
    <main className="p-6 max-w-xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">New project</h1>
      <form action={createProject} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <input name="title" required className="w-full border rounded px-3 py-2" placeholder="Beach House Weekend" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description (optional)</label>
          <textarea name="description" className="w-full border rounded px-3 py-2" rows={3} placeholder="Trip details…" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Total (€)</label>
            <input name="totalEur" required inputMode="decimal" className="w-full border rounded px-3 py-2" placeholder="600" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Min participants</label>
            <input name="minParticipants" required type="number" min={1} className="w-full border rounded px-3 py-2" placeholder="3" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Deadline date</label>
            <input name="deadlineDate" type="date" required className="w-full border rounded px-3 py-2" defaultValue={`${yyyy}-${mm}-${dd}`} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Deadline time</label>
            <input name="deadlineTime" type="time" required className="w-full border rounded px-3 py-2" defaultValue={`${hh}:${mi}`} />
          </div>
        </div>

        <div className="pt-2">
          <button type="submit" className="px-3 py-1.5 rounded bg-black text-white hover:opacity-90">
            Create project
          </button>
        </div>
      </form>
      <p className="text-xs opacity-60">You will be added as the organizer, and your active payment links from Settings will be copied.</p>
    </main>
  )
}
