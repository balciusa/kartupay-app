import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { updateProjectSettings } from '@/app/project/[id]/actions'
import { ProjectSettingsForm } from '@/components/Project/ProjectSettingsForm'
import { BaseItineraryEditor } from '@/components/Project/BaseItineraryEditor'

type BaseItineraryItem = {
  id: string
  title: string
  amount_cents: number
  sort_order: number
  created_at: string
}

const missingTable = (
  error: { message?: string; details?: string | null; hint?: string | null; code?: string } | null,
  table: string
) => {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase()
  const tableName = table.toLowerCase()
  if (!haystack.includes(tableName) && error?.code !== '42P01') return false
  return (
    error?.code === '42P01' ||
    haystack.includes('does not exist') ||
    haystack.includes('could not find') ||
    haystack.includes('schema cache') ||
    haystack.includes('unknown table')
  )
}

const missingColumn = (
  error: { message?: string; details?: string | null; hint?: string | null; code?: string } | null,
  column: string
) => {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase()
  const columnName = column.toLowerCase()
  if (!haystack.includes(columnName)) return false
  return (
    haystack.includes('does not exist') ||
    haystack.includes('could not find') ||
    haystack.includes('schema cache') ||
    haystack.includes('unknown column') ||
    error?.code === 'PGRST204'
  )
}

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
    return <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Please sign in to manage project settings.</div>
  }

  const supabase = await getSupabaseServer()
  const projectSelect =
    'id, title, description, total_cents, total_is_per_person, bundle_size, bundle_pay_for, min_participants, max_participants, event_start_at, event_end_at, event_location_label, event_location_address, event_location_lat, event_location_lng, event_location_place_id'
  const projectFallbackSelect =
    'id, title, description, total_cents, total_is_per_person, min_participants, max_participants, event_start_at, event_end_at, event_location_label, event_location_address, event_location_lat, event_location_lng, event_location_place_id'

  let { data: project, error: projectErr } = await supabase
    .from('projects')
    .select(projectSelect)
    .eq('id', projectId)
    .single()

  if (missingColumn(projectErr, 'bundle_size') || missingColumn(projectErr, 'bundle_pay_for')) {
    const fallback = await supabase
      .from('projects')
      .select(projectFallbackSelect)
      .eq('id', projectId)
      .single()
    project = fallback.data ? { ...fallback.data, bundle_size: null, bundle_pay_for: null } : null
    projectErr = fallback.error
  }

  if (projectErr || !project) {
    return <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Project not found.</div>
  }

  let baseItineraryAvailable = true
  let baseItineraryItems: BaseItineraryItem[] = []
  const { data: rawItineraryItems, error: itineraryErr } = await supabase
    .from('project_base_itinerary_items')
    .select('id, title, amount_cents, sort_order, created_at')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (itineraryErr) {
    if (missingTable(itineraryErr, 'project_base_itinerary_items')) {
      baseItineraryAvailable = false
      console.warn('[ProjectSettingsTab] project_base_itinerary_items table missing')
    } else {
      throw itineraryErr
    }
  } else {
    baseItineraryItems = (rawItineraryItems ?? []) as BaseItineraryItem[]
  }

  const totalEur = (Number(project.total_cents ?? 0) / 100).toFixed(2)
  const startTimeValue = toLocalTimeInput(project.event_start_at)
  const endTimeValue = toLocalTimeInput(project.event_end_at)

  return (
    <div className="space-y-6">
      <section className="surface-card p-5 md:p-6 space-y-4">
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
            bundleSize: project.bundle_size ?? null,
            bundlePayFor: project.bundle_pay_for ?? null,
            minParticipants: project.min_participants ?? null,
            maxParticipants: project.max_participants ?? null,
            eventStartDate: toLocalDateInput(project.event_start_at),
            eventStartTime: startTimeValue,
            eventEndDate: toLocalDateInput(project.event_end_at),
            eventEndTime: endTimeValue,
            eventLocationLabel: (project.event_location_label as string | null) ?? '',
            eventLocationAddress: (project.event_location_address as string | null) ?? '',
            eventLocationLat: project.event_location_lat == null ? '' : String(project.event_location_lat),
            eventLocationLng: project.event_location_lng == null ? '' : String(project.event_location_lng),
            eventLocationPlaceId: (project.event_location_place_id as string | null) ?? '',
          }}
        />
      </section>

      <section className="surface-card p-5 md:p-6 space-y-4">
        <BaseItineraryEditor
          projectId={projectId}
          available={baseItineraryAvailable}
          items={baseItineraryItems}
        />
      </section>
    </div>
  )
}
