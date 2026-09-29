import 'server-only'

import { isProjectCanceled } from './projectInvite'
import {
  type ProjectTransportSnapshot,
  type TransportAssignment,
  type TransportDirection,
  type TransportIntent,
  type TransportOffer,
  type TransportParticipant,
} from './projectTransport'
import { supabaseAdmin } from './supabaseAdmin'

type TransportProjectRow = {
  id: string
  transport_enabled: boolean | null
  date_mode: string | null
  event_start_at: string | null
  event_end_at: string | null
  status: string | null
  canceled_at: string | null
  aborted_at: string | null
  event_location_label: string | null
  event_location_address: string | null
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

const loadTransportProject = async (projectId: string): Promise<TransportProjectRow | null> => {
  const baseFields = [
    'id',
    'transport_enabled',
    'date_mode',
    'event_start_at',
    'event_end_at',
    'status',
    'canceled_at',
  ] as const
  const optionalFields = ['aborted_at', 'event_location_label', 'event_location_address'] as const
  let selectedOptionalFields: Array<(typeof optionalFields)[number]> = [...optionalFields]
  const missingFields = new Set<string>()

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select([...baseFields, ...selectedOptionalFields].join(', '))
      .eq('id', projectId)
      .maybeSingle()

    const missingField = selectedOptionalFields.find(field => missingColumn(error, field))
    if (missingField) {
      missingFields.add(missingField)
      selectedOptionalFields = selectedOptionalFields.filter(field => field !== missingField)
      continue
    }
    if (error) throw error
    if (!data) return null

    const project = data as Partial<TransportProjectRow>
    return {
      ...project,
      aborted_at: missingFields.has('aborted_at') ? null : project.aborted_at ?? null,
      event_location_label: missingFields.has('event_location_label') ? null : project.event_location_label ?? null,
      event_location_address: missingFields.has('event_location_address') ? null : project.event_location_address ?? null,
    } as TransportProjectRow
  }
}

const memberName = (participant: {
  short_code?: string | null
  users?: { display_name?: string | null; email?: string | null } | Array<{ display_name?: string | null; email?: string | null }> | null
}) => {
  const user = Array.isArray(participant.users) ? participant.users[0] : participant.users
  if (user?.display_name?.trim()) return user.display_name.trim()
  if (user?.email) return user.email.split('@')[0]
  return participant.short_code ? `#${participant.short_code}` : 'Member'
}

export async function loadProjectTransport(input: {
  projectId: string
  viewerUserId: string
  locale: 'en' | 'lt'
}): Promise<ProjectTransportSnapshot | null> {
  const [project, { data: viewer, error: viewerError }] = await Promise.all([
    loadTransportProject(input.projectId),
    supabaseAdmin
      .from('participants')
      .select('id')
      .eq('project_id', input.projectId)
      .eq('user_id', input.viewerUserId)
      .is('left_at', null)
      .maybeSingle(),
  ])
  if (viewerError) throw viewerError
  if (!project || !viewer || project.transport_enabled !== true) return null

  const [participantResult, offerResult, assignmentResult, intentResult] = await Promise.all([
    supabaseAdmin
      .from('participants')
      .select('id, short_code, attendance_status, users(display_name, email)')
      .eq('project_id', input.projectId)
      .is('left_at', null),
    supabaseAdmin
      .from('project_transport_offers')
      .select('id, project_id, direction, driver_participant_id, location_text, departure_at, seat_capacity, note, created_at')
      .eq('project_id', input.projectId)
      .is('canceled_at', null)
      .order('departure_at', { ascending: true })
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('project_transport_assignments')
      .select('id, project_id, direction, offer_id, participant_id, joined_at')
      .eq('project_id', input.projectId)
      .is('left_at', null),
    supabaseAdmin
      .from('project_transport_intents')
      .select('participant_id, direction, intent')
      .eq('project_id', input.projectId),
  ])
  const error = participantResult.error || offerResult.error || assignmentResult.error || intentResult.error
  if (error) throw error

  const participants: TransportParticipant[] = (participantResult.data ?? []).map(participant => ({
    id: participant.id,
    name: memberName(participant),
    attendanceStatus: participant.attendance_status ?? null,
  }))
  const assignments: TransportAssignment[] = (assignmentResult.data ?? []).map(assignment => ({
    id: assignment.id,
    projectId: assignment.project_id,
    direction: assignment.direction as TransportDirection,
    offerId: assignment.offer_id,
    participantId: assignment.participant_id,
    joinedAt: assignment.joined_at,
  }))
  const offers: TransportOffer[] = (offerResult.data ?? []).map(offer => ({
    id: offer.id,
    projectId: offer.project_id,
    direction: offer.direction as TransportDirection,
    driverParticipantId: offer.driver_participant_id,
    locationText: offer.location_text,
    departureAt: offer.departure_at,
    seatCapacity: offer.seat_capacity,
    note: offer.note,
    createdAt: offer.created_at,
    assignments: assignments.filter(assignment => assignment.offerId === offer.id),
  }))

  return {
    projectId: input.projectId,
    locale: input.locale,
    enabled: true,
    planningReady: project.date_mode === 'fixed' && !!project.event_start_at,
    projectCanceled: isProjectCanceled(project),
    eventLocation: project.event_location_label || project.event_location_address || null,
    eventStartAt: project.event_start_at,
    eventEndAt: project.event_end_at,
    viewerParticipantId: viewer.id,
    participants,
    offers,
    intents: (intentResult.data ?? []).map(intent => ({
      participantId: intent.participant_id,
      direction: intent.direction as TransportDirection,
      intent: intent.intent as TransportIntent,
    })),
  }
}

/**
 * Idempotent repair hook for authoritative membership/attendance actions.
 * The migration trigger performs the cleanup atomically with the participant
 * change; this explicit call provides a safe repair path for mixed-schema
 * environments and intentionally does not roll back the authoritative change.
 */
export async function cleanupParticipantTransport(projectId: string, participantId: string) {
  const { error } = await supabaseAdmin.rpc('cleanup_project_transport_participant', {
    p_project_id: projectId,
    p_participant_id: participantId,
  })
  if (!error) return true
  const message = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  if (error.code === '42883' || message.includes('cleanup_project_transport_participant')) return false
  throw error
}
