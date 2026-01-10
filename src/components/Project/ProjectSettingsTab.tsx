import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { updateProjectSettings } from '@/app/project/[id]/actions'

const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
const toTimeInput = (iso?: string | null) => (iso ? iso.slice(11, 16) : '')

export async function ProjectSettingsTab({ projectId }: { projectId: string }) {
  const uid = await getCurrentUserId()
  if (!uid) {
    return <div className="text-sm opacity-70">Please sign in to manage project settings.</div>
  }

  const supabase = await getSupabaseServer()
  const { data: project } = await supabase
    .from('projects')
    .select(
      'id, title, description, total_cents, total_is_per_person, min_participants, max_participants, deadline_at'
    )
    .eq('id', projectId)
    .single()

  if (!project) {
    return <div className="text-sm opacity-70">Project not found.</div>
  }

  const totalEur = (Number(project.total_cents ?? 0) / 100).toFixed(2)

  return (
    <div className="space-y-6">
      <section className="border rounded-xl p-5 md:p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Project settings</h2>
          <p className="text-sm text-muted-foreground">
            Update the core project details and how totals are calculated.
          </p>
        </div>
        <form action={updateProjectSettings.bind(null, projectId)} className="grid gap-4">
          <input
            name="project_title"
            defaultValue={project.title ?? ''}
            placeholder="Project title"
            className="border rounded-md px-3 py-2 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
            required
          />
          <textarea
            name="project_description"
            defaultValue={project.description ?? ''}
            placeholder="Description (optional)"
            className="border rounded-md px-3 py-2 bg-white min-h-[120px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
          />

          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-sm block mb-1">Total (EUR)</label>
              <input
                name="totalEur"
                type="text"
                inputMode="decimal"
                defaultValue={totalEur}
                className="border rounded-md px-3 py-2 w-full bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                required
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Total type</label>
              <div className="border rounded-md px-3 py-2 space-y-2 bg-white">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="total_is_per_person"
                    value="false"
                    defaultChecked={!project.total_is_per_person}
                  />
                  Grand total (fixed)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="total_is_per_person"
                    value="true"
                    defaultChecked={!!project.total_is_per_person}
                  />
                  Per person (fixed)
                </label>
              </div>
            </div>
            <div>
              <label className="text-sm block mb-1">Min participants</label>
              <input
                name="min_participants"
                type="number"
                min={1}
                className="border rounded-md px-3 py-2 w-full bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                defaultValue={project.min_participants ?? ''}
                placeholder="e.g. 5 (optional)"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm block mb-1">Max participants (optional)</label>
              <input
                name="max_participants"
                type="number"
                min={1}
                className="border rounded-md px-3 py-2 w-full bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                defaultValue={project.max_participants ?? ''}
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Deadline date (optional)</label>
              <input
                name="deadlineDate"
                type="date"
                className="border rounded-md px-3 py-2 w-full bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                defaultValue={toDateInput(project.deadline_at)}
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Deadline time (optional)</label>
              <input
                name="deadlineTime"
                type="time"
                className="border rounded-md px-3 py-2 w-full bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                defaultValue={toTimeInput(project.deadline_at)}
              />
            </div>
          </div>

          <button className="px-5 py-2 rounded-full bg-black text-white w-fit">Save settings</button>
        </form>
      </section>
    </div>
  )
}
