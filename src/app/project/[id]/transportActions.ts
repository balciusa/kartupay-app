'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserId } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  isTransportDirection,
  isTransportIntent,
  parseTransportDeparture,
  type TransportDirection,
  type TransportIntent,
} from '@/lib/projectTransport'

export type TransportActionResult = { ok: boolean; error: string | null }

const actionError = (error: unknown): TransportActionResult => ({
  ok: false,
  error: error instanceof Error ? error.message : 'Transport could not be updated',
})

const rpcError = (error: { message?: string | null } | null, fallback: string) => {
  if (error) throw new Error(error.message || fallback)
}

async function requireTransportParticipant(projectId: string) {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')
  const { data: participant, error } = await supabaseAdmin
    .from('participants')
    .select('id, attendance_status')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .is('left_at', null)
    .maybeSingle()
  if (error) throw error
  if (!participant) throw new Error('Only active project participants can manage transport')
  if (participant.attendance_status === 'cannot_attend' || participant.attendance_status === 'observer') {
    throw new Error('Transport is available only to participants attending the event')
  }
  return participant.id as string
}

const parseDirection = (value: unknown): TransportDirection => {
  if (!isTransportDirection(value)) throw new Error('Invalid transport direction')
  return value
}

const parseOfferFields = (formData: FormData) => {
  const locationText = String(formData.get('location_text') ?? '').trim()
  if (!locationText || locationText.length > 300) throw new Error('Location must be between 1 and 300 characters')
  const noteRaw = String(formData.get('note') ?? '').trim()
  if (noteRaw.length > 500) throw new Error('Note must be 500 characters or fewer')
  const seatCapacity = Number(formData.get('seat_capacity'))
  if (!Number.isInteger(seatCapacity) || seatCapacity < 1 || seatCapacity > 20) {
    throw new Error('Available passenger seats must be between 1 and 20')
  }
  const localDeparture = String(formData.get('departure_local') ?? '')
  const timezoneOffset = Number(formData.get('timezone_offset_minutes'))
  const timeZone = String(formData.get('timezone_name') ?? '')
  const departureAt = parseTransportDeparture(localDeparture, timezoneOffset, timeZone)
  return { locationText, note: noteRaw || null, seatCapacity, departureAt }
}

export async function createTransportOffer(
  projectId: string,
  directionValue: TransportDirection,
  formData: FormData
): Promise<TransportActionResult> {
  try {
    const participantId = await requireTransportParticipant(projectId)
    const direction = parseDirection(directionValue)
    const fields = parseOfferFields(formData)
    const { error } = await supabaseAdmin.rpc('create_project_transport_offer', {
      p_project_id: projectId,
      p_driver_participant_id: participantId,
      p_direction: direction,
      p_location_text: fields.locationText,
      p_departure_at: fields.departureAt,
      p_seat_capacity: fields.seatCapacity,
      p_note: fields.note,
    })
    rpcError(error, 'Failed to offer ride')
    revalidatePath(`/project/${projectId}`)
    return { ok: true, error: null }
  } catch (error) {
    return actionError(error)
  }
}

export async function updateTransportOffer(
  projectId: string,
  offerId: string,
  formData: FormData
): Promise<TransportActionResult> {
  try {
    const participantId = await requireTransportParticipant(projectId)
    const fields = parseOfferFields(formData)
    const { error } = await supabaseAdmin.rpc('update_project_transport_offer', {
      p_project_id: projectId,
      p_offer_id: offerId,
      p_driver_participant_id: participantId,
      p_location_text: fields.locationText,
      p_departure_at: fields.departureAt,
      p_seat_capacity: fields.seatCapacity,
      p_note: fields.note,
    })
    rpcError(error, 'Failed to update ride')
    revalidatePath(`/project/${projectId}`)
    return { ok: true, error: null }
  } catch (error) {
    return actionError(error)
  }
}

export async function cancelTransportOffer(projectId: string, offerId: string): Promise<TransportActionResult> {
  try {
    const participantId = await requireTransportParticipant(projectId)
    const { error } = await supabaseAdmin.rpc('cancel_project_transport_offer', {
      p_project_id: projectId,
      p_offer_id: offerId,
      p_driver_participant_id: participantId,
    })
    rpcError(error, 'Failed to cancel ride')
    revalidatePath(`/project/${projectId}`)
    return { ok: true, error: null }
  } catch (error) {
    return actionError(error)
  }
}

export async function joinTransportOffer(projectId: string, offerId: string): Promise<TransportActionResult> {
  try {
    const participantId = await requireTransportParticipant(projectId)
    const { error } = await supabaseAdmin.rpc('join_project_transport_offer', {
      p_project_id: projectId,
      p_offer_id: offerId,
      p_participant_id: participantId,
    })
    rpcError(error, 'Failed to join ride')
    revalidatePath(`/project/${projectId}`)
    return { ok: true, error: null }
  } catch (error) {
    return actionError(error)
  }
}

export async function leaveTransportOffer(
  projectId: string,
  directionValue: TransportDirection
): Promise<TransportActionResult> {
  try {
    const participantId = await requireTransportParticipant(projectId)
    const direction = parseDirection(directionValue)
    const { error } = await supabaseAdmin.rpc('leave_project_transport_offer', {
      p_project_id: projectId,
      p_participant_id: participantId,
      p_direction: direction,
    })
    rpcError(error, 'Failed to leave ride')
    revalidatePath(`/project/${projectId}`)
    return { ok: true, error: null }
  } catch (error) {
    return actionError(error)
  }
}

export async function removeTransportPassenger(
  projectId: string,
  offerId: string,
  passengerParticipantId: string
): Promise<TransportActionResult> {
  try {
    const participantId = await requireTransportParticipant(projectId)
    const { error } = await supabaseAdmin.rpc('remove_project_transport_passenger', {
      p_project_id: projectId,
      p_offer_id: offerId,
      p_driver_participant_id: participantId,
      p_passenger_participant_id: passengerParticipantId,
    })
    rpcError(error, 'Failed to remove passenger')
    revalidatePath(`/project/${projectId}`)
    return { ok: true, error: null }
  } catch (error) {
    return actionError(error)
  }
}

export async function setTransportIntent(
  projectId: string,
  directionValue: TransportDirection,
  intentValue: TransportIntent
): Promise<TransportActionResult> {
  try {
    const participantId = await requireTransportParticipant(projectId)
    const direction = parseDirection(directionValue)
    if (!isTransportIntent(intentValue)) throw new Error('Invalid transport status')
    const { error } = await supabaseAdmin.rpc('set_project_transport_intent', {
      p_project_id: projectId,
      p_participant_id: participantId,
      p_direction: direction,
      p_intent: intentValue,
    })
    rpcError(error, 'Failed to update transport status')
    revalidatePath(`/project/${projectId}`)
    return { ok: true, error: null }
  } catch (error) {
    return actionError(error)
  }
}

export async function clearTransportIntent(
  projectId: string,
  directionValue: TransportDirection
): Promise<TransportActionResult> {
  try {
    const participantId = await requireTransportParticipant(projectId)
    const direction = parseDirection(directionValue)
    const { error } = await supabaseAdmin.rpc('clear_project_transport_intent', {
      p_project_id: projectId,
      p_participant_id: participantId,
      p_direction: direction,
    })
    rpcError(error, 'Failed to clear transport status')
    revalidatePath(`/project/${projectId}`)
    return { ok: true, error: null }
  } catch (error) {
    return actionError(error)
  }
}
