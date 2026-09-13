'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { recordProjectActivity } from '@/lib/activityLog'
import { normalizeDateOnlyOption } from '@/lib/projectDateSelection'
import { validateBundlePricingConfig } from '@/lib/projectPricing'
import { validateProjectFinanceInput } from '@/lib/projectFinance'
import { getCurrentUserId } from '@/lib/supabaseServer'

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

export type CreateProjectState = {
  error: string | null
}

const isNextRedirectError = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('digest' in error)) return false
  return String((error as { digest?: unknown }).digest ?? '').startsWith('NEXT_REDIRECT')
}

const MAX_INITIAL_DATE_OPTIONS = 20

const schema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(2000).optional().nullable(),
  visibility: z.enum(['private', 'public']),
  finance_mode: z.enum(['none', 'managed']),
  totalEur: z.string().optional().nullable(),
  total_is_per_person: z.enum(['true', 'false']).optional(),
  bundle_size: z.string().optional().nullable(),
  bundle_pay_for: z.string().optional().nullable(),
  min_participants: z.string().optional().nullable(),
  max_participants: z.string().optional().nullable(),
  date_mode: z.enum(['fixed', 'selecting']),
  date_voting_deadline_date: z.string().optional().nullable(),
  event_start_date: z.string().optional().nullable(),
  event_start_time: z.string().optional().nullable(),
  event_end_date: z.string().optional().nullable(),
  event_end_time: z.string().optional().nullable(),
  event_location_label: z.string().optional().nullable(),
  event_location_address: z.string().optional().nullable(),
  event_location_place_id: z.string().optional().nullable(),
  event_location_lat: z.string().optional().nullable(),
  event_location_lng: z.string().optional().nullable(),
})

const parseEventDateTime = (
  dateValue: string | null | undefined,
  timeValue: string | null | undefined,
  defaultTime: string
) => {
  const dateRaw = (dateValue ?? '').trim()
  const timeRaw = (timeValue ?? '').trim()
  if (!dateRaw && !timeRaw) return null
  if (!dateRaw && timeRaw) {
    throw new Error('Event time requires a date')
  }
  const time = timeRaw || defaultTime
  const combined = `${dateRaw}T${time}`
  const parsed = new Date(combined)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid event date or time')
  }
  return parsed.toISOString()
}

export async function createProject(formData: FormData) {
  const uid = await getCurrentUserId()
  if (!uid) {
    throw new Error('You must be signed in')
  }

  const minParticipantsValue = formData.get('min_participants')
  const maxParticipantsValue = formData.get('max_participants')

  const payload = {
    title: formData.get('title') as string,
    description: (formData.get('description') as string) || null,
    visibility: (formData.get('visibility') as string) ?? 'private',
    finance_mode: (formData.get('finance_mode') as string) ?? 'managed',
    totalEur: (formData.get('totalEur') as string) ?? null,
    total_is_per_person: (formData.get('total_is_per_person') as 'true' | 'false' | null) ?? undefined,
    bundle_size: (formData.get('bundle_size') as string) ?? null,
    bundle_pay_for: (formData.get('bundle_pay_for') as string) ?? null,
    min_participants: typeof minParticipantsValue === 'string' ? minParticipantsValue : null,
    max_participants: typeof maxParticipantsValue === 'string' ? maxParticipantsValue : null,
    date_mode: (formData.get('date_mode') as string) ?? 'fixed',
    date_voting_deadline_date: (formData.get('date_voting_deadline_date') as string) ?? null,
    event_start_date: (formData.get('event_start_date') as string) ?? null,
    event_start_time: (formData.get('event_start_time') as string) ?? null,
    event_end_date: (formData.get('event_end_date') as string) ?? null,
    event_end_time: (formData.get('event_end_time') as string) ?? null,
    event_location_label: (formData.get('event_location_label') as string) ?? null,
    event_location_address: (formData.get('event_location_address') as string) ?? null,
    event_location_place_id: (formData.get('event_location_place_id') as string) ?? null,
    event_location_lat: (formData.get('event_location_lat') as string) ?? null,
    event_location_lng: (formData.get('event_location_lng') as string) ?? null,
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid form: ' + JSON.stringify(parsed.error.flatten().fieldErrors))
  }

  const {
    title,
    description,
    visibility,
    finance_mode,
    totalEur,
    total_is_per_person,
    bundle_size,
    bundle_pay_for,
    min_participants,
    max_participants,
    date_mode,
    date_voting_deadline_date,
    event_start_date,
    event_start_time,
    event_end_date,
    event_end_time,
    event_location_label,
    event_location_address,
    event_location_place_id,
    event_location_lat,
    event_location_lng,
  } = parsed.data

  const minRaw = String(min_participants ?? '').trim()
  const maxRaw = String(max_participants ?? '').trim()
  const minParticipants = minRaw === '' ? null : Number(minRaw)
  const maxParticipants = maxRaw === '' ? null : Number(maxRaw)

  if (minParticipants !== null && (!Number.isFinite(minParticipants) || minParticipants < 1)) {
    throw new Error('Min participants must be at least 1')
  }
  if (maxParticipants !== null && (!Number.isFinite(maxParticipants) || maxParticipants < 1)) {
    throw new Error('Max participants must be at least 1')
  }
  if (minParticipants !== null && maxParticipants !== null && maxParticipants < minParticipants) {
    throw new Error('Max participants must be greater than or equal to min participants')
  }

  const financeInput = validateProjectFinanceInput({
    financeMode: finance_mode,
    totalEur,
    totalIsPerPerson: total_is_per_person === 'true',
    bundleSize: bundle_size,
    bundlePayFor: bundle_pay_for,
  })
  const total_cents = financeInput.totalCents
  const totalIsPerPerson = financeInput.totalIsPerPerson
  const isPublic = visibility === 'public'
  const { bundleSize, bundlePayFor } = finance_mode === 'managed'
    ? validateBundlePricingConfig(totalIsPerPerson, bundle_size, bundle_pay_for)
    : { bundleSize: null, bundlePayFor: null }
  const eventStartAt = parseEventDateTime(event_start_date, event_start_time, '09:00')
  const eventEndAt = parseEventDateTime(event_end_date, event_end_time, '17:00')
  if (date_mode === 'fixed' && !eventStartAt) {
    throw new Error('A fixed project needs a confirmed start date and time')
  }
  if (eventStartAt && eventEndAt && new Date(eventEndAt) < new Date(eventStartAt)) {
    throw new Error('Event end must be after event start')
  }
  const votingDeadlineAt = date_mode === 'selecting'
    ? parseEventDateTime(date_voting_deadline_date, null, '23:59')
    : null
  if (date_mode === 'selecting' && !votingDeadlineAt) {
    throw new Error('Choose a date voting deadline')
  }
  if (votingDeadlineAt && new Date(votingDeadlineAt).getTime() <= Date.now() + 24 * 60 * 60 * 1000) {
    throw new Error('Date voting deadline must be more than 24 hours from now')
  }
  const suggestionsCloseAt = votingDeadlineAt
    ? new Date(new Date(votingDeadlineAt).getTime() - 24 * 60 * 60 * 1000).toISOString()
    : null

  const initialDateOptions = date_mode === 'selecting'
    ? formData.getAll('date_option_start_date').map((startValue, index) => {
        const endValue = formData.getAll('date_option_end_date')[index]
        return normalizeDateOnlyOption(
          typeof startValue === 'string' ? startValue : '',
          typeof endValue === 'string' ? endValue : null
        )
      })
    : []
  if (date_mode === 'selecting' && initialDateOptions.length === 0) {
    throw new Error('Add at least one date option')
  }
  if (initialDateOptions.length > MAX_INITIAL_DATE_OPTIONS) {
    throw new Error(`You can add up to ${MAX_INITIAL_DATE_OPTIONS} initial date options`)
  }
  const uniqueInitialDateOptions = new Set(
    initialDateOptions.map(option => `${option.startsAt}:${option.endsAt ?? ''}`)
  )
  if (uniqueInitialDateOptions.size !== initialDateOptions.length) {
    throw new Error('The same date option was added more than once')
  }

  const locationLabel = (event_location_label ?? '').trim() || null
  const locationAddress = (event_location_address ?? '').trim() || null
  const locationPlaceId = (event_location_place_id ?? '').trim() || null
  const locationLatRaw = (event_location_lat ?? '').trim()
  const locationLngRaw = (event_location_lng ?? '').trim()
  const hasLocationLat = locationLatRaw.length > 0
  const hasLocationLng = locationLngRaw.length > 0
  if (hasLocationLat !== hasLocationLng) {
    throw new Error('Location coordinates must include both latitude and longitude')
  }
  const parseCoordinate = (value: string, axis: 'latitude' | 'longitude') => {
    if (!value) return null
    const parsedNumber = Number(value)
    if (!Number.isFinite(parsedNumber)) {
      throw new Error(`Invalid location ${axis}`)
    }
    if (axis === 'latitude' && (parsedNumber < -90 || parsedNumber > 90)) {
      throw new Error('Location latitude must be between -90 and 90')
    }
    if (axis === 'longitude' && (parsedNumber < -180 || parsedNumber > 180)) {
      throw new Error('Location longitude must be between -180 and 180')
    }
    return parsedNumber
  }
  const locationLat = parseCoordinate(locationLatRaw, 'latitude')
  const locationLng = parseCoordinate(locationLngRaw, 'longitude')

  const projectInsert = {
    title,
    description,
    finance_mode,
    total_cents,
    total_is_per_person: totalIsPerPerson,
    bundle_size: bundleSize,
    bundle_pay_for: bundlePayFor,
    min_participants: minParticipants,
    max_participants: maxParticipants,
    event_start_at: date_mode === 'fixed' ? eventStartAt : null,
    event_end_at: date_mode === 'fixed' ? eventEndAt : null,
    date_mode,
    date_voting_deadline_at: votingDeadlineAt,
    date_suggestions_close_at: suggestionsCloseAt,
    date_selection_status: date_mode === 'selecting' ? 'open' : 'confirmed',
    event_location_label: locationLabel,
    event_location_address: locationAddress,
    event_location_place_id: locationPlaceId,
    event_location_lat: locationLat,
    event_location_lng: locationLng,
    is_public: isPublic,
    status: 'pending',
  }

  let projectInsertForAttempt = projectInsert
  let { data: proj, error: pErr } = await supabaseAdmin
    .from('projects')
    .insert(projectInsertForAttempt)
    .select('id')
    .single()

  if (missingColumn(pErr, 'finance_mode')) {
    throw new Error('Shared cost management is unavailable until the latest database migration is applied.')
  }

  const dateColumnsMissing =
    missingColumn(pErr, 'date_mode') ||
    missingColumn(pErr, 'date_voting_deadline_at') ||
    missingColumn(pErr, 'date_suggestions_close_at') ||
    missingColumn(pErr, 'date_selection_status')
  if (dateColumnsMissing) {
    if (date_mode === 'selecting') {
      throw new Error('Date selection is unavailable until the project date database migration is applied.')
    }

    const {
      date_mode: _dateMode,
      date_voting_deadline_at: _dateVotingDeadlineAt,
      date_suggestions_close_at: _dateSuggestionsCloseAt,
      date_selection_status: _dateSelectionStatus,
      ...legacyProjectInsert
    } = projectInsertForAttempt
    void _dateMode
    void _dateVotingDeadlineAt
    void _dateSuggestionsCloseAt
    void _dateSelectionStatus
    projectInsertForAttempt = legacyProjectInsert as typeof projectInsert
    const fallback = await supabaseAdmin
      .from('projects')
      .insert(projectInsertForAttempt)
      .select('id')
      .single()
    proj = fallback.data
    pErr = fallback.error
  }

  const visibilityColumnMissing = missingColumn(pErr, 'is_public')
  if (visibilityColumnMissing) {
    throw new Error('Project visibility is unavailable until the latest database migration is applied')
  }

  const bundleColumnsMissing = missingColumn(pErr, 'bundle_size') || missingColumn(pErr, 'bundle_pay_for')
  if (bundleColumnsMissing) {
    if (bundleSize !== null || bundlePayFor !== null) {
      throw new Error('Bundle pricing is unavailable until the latest database migration is applied')
    }

    const { bundle_size: _bundleSize, bundle_pay_for: _bundlePayFor, ...fallbackInsertBase } = projectInsertForAttempt
    void _bundleSize
    void _bundlePayFor
    const fallback = await supabaseAdmin
      .from('projects')
      .insert(fallbackInsertBase)
      .select('id')
      .single()
    proj = fallback.data
    pErr = fallback.error
  }

  if (pErr || !proj?.id) {
    throw new Error(
      `Failed to create project: ${pErr?.message ?? 'unknown'} (code: ${pErr?.code ?? 'n/a'}, details: ${JSON.stringify(pErr?.details)})`
    )
  }

  const participantInsert = {
    project_id: proj.id,
    user_id: uid,
    role: 'organizer',
    short_code: null,
    attendance_status: date_mode === 'selecting' ? 'pending_date_selection' : 'confirmed',
  }
  let { data: part, error: iErr } = await supabaseAdmin
    .from('participants')
    .insert(participantInsert)
    .select('id')
    .single()

  if (missingColumn(iErr, 'attendance_status') && date_mode === 'fixed') {
    const { attendance_status: _attendanceStatus, ...legacyParticipantInsert } = participantInsert
    void _attendanceStatus
    const fallback = await supabaseAdmin
      .from('participants')
      .insert(legacyParticipantInsert)
      .select('id')
      .single()
    part = fallback.data
    iErr = fallback.error
  }

  if (missingColumn(iErr, 'attendance_status')) {
    throw new Error('Date selection is unavailable until the project date database migration is applied.')
  }

  if (iErr || !part?.id) {
    throw new Error('Failed to add organizer: ' + (iErr?.message ?? 'unknown'))
  }

  const { error: collectorErr } = await supabaseAdmin
    .from('projects')
    .update({ collector_participant_id: part.id })
    .eq('id', proj.id)
  if (collectorErr) {
    throw new Error('Failed to set collector: ' + collectorErr.message)
  }

  let createdDateOptions: Array<{ id: string; starts_at: string; ends_at: string | null }> = []
  if (initialDateOptions.length > 0) {
    const { data: options, error: optionsError } = await supabaseAdmin
      .from('project_date_options')
      .insert(initialDateOptions.map(option => ({
        project_id: proj.id,
        starts_at: option.startsAt,
        ends_at: option.endsAt,
        created_by_user_id: uid,
        source: 'organizer',
      })))
      .select('id, starts_at, ends_at')
    if (optionsError) {
      if (optionsError.code === '23505') throw new Error('The same date option was added more than once')
      throw new Error('Failed to add initial date options: ' + optionsError.message)
    }
    createdDateOptions = options ?? []
  }

  await recordProjectActivity({
    projectId: proj.id,
    entryType: 'project_created',
    actorUserId: uid,
    actorParticipantId: part.id,
    targetUserId: uid,
    targetParticipantId: part.id,
    metadata: {
      title,
      finance_mode,
      total_cents,
      is_public: isPublic,
      total_is_per_person: totalIsPerPerson,
      bundle_size: bundleSize,
      bundle_pay_for: bundlePayFor,
      date_mode,
      date_voting_deadline_at: votingDeadlineAt,
    },
  })

  for (const option of createdDateOptions) {
    await recordProjectActivity({
      projectId: proj.id,
      entryType: 'date_option_suggested',
      actorUserId: uid,
      actorParticipantId: part.id,
      metadata: {
        date_option_id: option.id,
        starts_at: option.starts_at,
        ends_at: option.ends_at,
        via_project_creation: true,
      },
    })
  }

  await recordProjectActivity({
    projectId: proj.id,
    entryType: 'participant_joined',
    actorUserId: uid,
    actorParticipantId: part.id,
    targetUserId: uid,
    targetParticipantId: part.id,
    metadata: {
      role: 'organizer',
      via_project_creation: true,
    },
  })

  if (finance_mode === 'managed') {
    const [{ data: upos, error: uErr }, { data: existingPOs, error: eErr }] = await Promise.all([
    supabaseAdmin.from('user_payment_options')
      .select('type,label,value,priority,is_active')
      .eq('user_id', uid)
      .eq('is_active', true),
    supabaseAdmin.from('payment_options')
      .select('type,value,participant_id')
      .eq('participant_id', part.id),
  ])
    if (uErr) throw new Error('Failed reading user payment links: ' + uErr.message)
    if (eErr) throw new Error('Failed reading project payment options: ' + eErr.message)

    const existingPairs = new Set((existingPOs ?? []).map(po => `${po.type}::${po.value}`))
    const rows = (upos ?? [])
      .filter(x => x.is_active)
      .filter(x => !existingPairs.has(`${x.type}::${x.value}`))
      .map(x => ({
        participant_id: part.id,
        type: x.type as 'revolut'|'swedbank'|'iban',
        label: x.label,
        value: x.value,
        priority: x.priority ?? 1,
        is_active: true,
      }))

    if (rows.length > 0) {
      const { error: poErr } = await supabaseAdmin.from('payment_options').insert(rows)
      if (poErr) throw new Error('Failed cloning payment links: ' + poErr.message)
    }
  }

  revalidatePath('/')
  redirect(`/project/${proj.id}`)
}

export async function createProjectWithState(
  _previousState: CreateProjectState,
  formData: FormData
): Promise<CreateProjectState> {
  try {
    await createProject(formData)
    return { error: null }
  } catch (error) {
    if (isNextRedirectError(error)) throw error
    console.error('[createProject] Project creation failed', error)
    return {
      error: error instanceof Error ? error.message : 'Project could not be created. Please try again.',
    }
  }
}
