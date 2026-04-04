import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { updateProjectSettings } from '@/app/project/[id]/actions'
import { ProjectSettingsForm } from '@/components/Project/ProjectSettingsForm'

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
  const baseProjectFields =
    'id, title, description, total_cents, total_is_per_person, min_participants, max_participants, event_start_at, event_end_at, event_location_label, event_location_address, event_location_lat, event_location_lng, event_location_place_id'
  const optionalProjectFields = ['is_public', 'bundle_size', 'bundle_pay_for'] as const
  let optionalFields = [...optionalProjectFields]
  const missingFields = new Set<string>()
  let project: {
    id: string
    title: string | null
    description: string | null
    total_cents: number | null
    total_is_per_person: boolean | null
    is_public: boolean | null
    bundle_size: number | null
    bundle_pay_for: number | null
    min_participants: number | null
    max_participants: number | null
    event_start_at: string | null
    event_end_at: string | null
    event_location_label: string | null
    event_location_address: string | null
    event_location_lat: number | null
    event_location_lng: number | null
    event_location_place_id: string | null
  } | null = null
  let projectErr: { message?: string; details?: string | null; hint?: string | null; code?: string } | null = null

  while (true) {
    const selectList = [baseProjectFields, ...optionalFields].join(', ')
    const result = await supabase
      .from('projects')
      .select(selectList)
      .eq('id', projectId)
      .single()

    const missingField = optionalFields.find(field => missingColumn(result.error, field))
    if (missingField) {
      optionalFields = optionalFields.filter(field => field !== missingField)
      missingFields.add(missingField)
      if (optionalFields.length === 0) {
        project = result.data
          ? { ...result.data, is_public: true, bundle_size: null, bundle_pay_for: null }
          : null
        projectErr = result.error
        break
      }
      continue
    }

    project = result.data
      ? {
          ...result.data,
          is_public: 'is_public' in result.data ? result.data.is_public ?? true : true,
          bundle_size: 'bundle_size' in result.data ? result.data.bundle_size ?? null : null,
          bundle_pay_for: 'bundle_pay_for' in result.data ? result.data.bundle_pay_for ?? null : null,
        }
      : null
    projectErr = result.error
    break
  }

  const visibilityAvailable = !missingFields.has('is_public')

  if (projectErr || !project) {
    return <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Project not found.</div>
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
            isPublic: project.is_public === true,
            visibilityAvailable,
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
    </div>
  )
}
