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
      <section className="border rounded-xl p-4 space-y-3">
        <h2 className="text-lg font-medium">Project settings</h2>
        <form action={updateProjectSettings.bind(null, projectId)} className="grid gap-3">
          <input
            name="project_title"
            defaultValue={project.title ?? ''}
            placeholder="Project title"
            className="border rounded px-3 py-2"
            required
          />
          <textarea
            name="project_description"
            defaultValue={project.description ?? ''}
            placeholder="Description (optional)"
            className="border rounded px-3 py-2"
          />

          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-sm block mb-1">Total (EUR)</label>
              <input
                name="totalEur"
                type="text"
                inputMode="decimal"
                defaultValue={totalEur}
                className="border rounded px-3 py-2 w-full"
                required
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Total type</label>
              <div className="flex flex-col gap-2 border rounded px-3 py-2">
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
                className="border rounded px-3 py-2 w-full"
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
                className="border rounded px-3 py-2 w-full"
                defaultValue={project.max_participants ?? ''}
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Deadline date (optional)</label>
              <input
                name="deadlineDate"
                type="date"
                className="border rounded px-3 py-2 w-full"
                defaultValue={toDateInput(project.deadline_at)}
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Deadline time (optional)</label>
              <input
                name="deadlineTime"
                type="time"
                className="border rounded px-3 py-2 w-full"
                defaultValue={toTimeInput(project.deadline_at)}
              />
            </div>
          </div>

          <button className="px-4 py-2 rounded bg-black text-white w-fit">Save settings</button>
        </form>
      </section>
    </div>
  )
}
