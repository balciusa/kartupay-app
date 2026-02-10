import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { updateProjectSettings } from '@/app/project/[id]/actions'
import { ProjectSettingsForm } from '@/components/Project/ProjectSettingsForm'

const toLocalDateInput = (iso?: string | null) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const toLocalTimeInput = (iso?: string | null) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export async function ProjectSettingsTab({ projectId }: { projectId: string }) {
  const uid = await getCurrentUserId()
  if (!uid) {
    return <div className="text-sm opacity-70">Please sign in to manage project settings.</div>
  }

  const supabase = await getSupabaseServer()
  const { data: project } = await supabase
    .from('projects')
    .select(
      'id, title, description, total_cents, total_is_per_person, min_participants, max_participants, event_start_at, event_end_at'
    )
    .eq('id', projectId)
    .single()

  if (!project) {
    return <div className="text-sm opacity-70">Project not found.</div>
  }

  const totalEur = (Number(project.total_cents ?? 0) / 100).toFixed(2)
  const startTimeValue = toLocalTimeInput(project.event_start_at)
  const endTimeValue = toLocalTimeInput(project.event_end_at)

  return (
    <div className="space-y-6">
      <section className="border rounded-xl p-5 md:p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Project settings</h2>
          <p className="text-sm text-muted-foreground">
            Update the core project details and how totals are calculated.
          </p>
        </div>
        <ProjectSettingsForm
          action={updateProjectSettings.bind(null, projectId)}
          initial={{
            title: project.title ?? '',
            description: project.description ?? '',
            totalEur,
            totalIsPerPerson: !!project.total_is_per_person,
            minParticipants: project.min_participants ?? null,
            maxParticipants: project.max_participants ?? null,
            eventStartDate: toLocalDateInput(project.event_start_at),
            eventStartTime: startTimeValue,
            eventEndDate: toLocalDateInput(project.event_end_at),
            eventEndTime: endTimeValue,
          }}
        />
      </section>
    </div>
  )
}
