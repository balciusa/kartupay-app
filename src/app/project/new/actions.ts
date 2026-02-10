'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { recordProjectActivity } from '@/lib/activityLog'
import { getCurrentUserId } from '@/lib/supabaseServer'

const schema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(2000).optional().nullable(),
  totalEur: z.string().trim().regex(/^\d+([.,]\d{1,2})?$/),
  total_is_per_person: z.enum(['true', 'false']),
  min_participants: z.string().optional().nullable(),
  max_participants: z.string().optional().nullable(),
  event_start_date: z.string().optional().nullable(),
  event_start_time: z.string().optional().nullable(),
  event_end_date: z.string().optional().nullable(),
  event_end_time: z.string().optional().nullable(),
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

  const payload = {
    title: formData.get('title') as string,
    description: (formData.get('description') as string) || null,
    totalEur: (formData.get('totalEur') as string) ?? '',
    total_is_per_person: (formData.get('total_is_per_person') as string) ?? 'false',
    min_participants: formData.get('min_participants') as any,
    max_participants: formData.get('max_participants') as any,
    event_start_date: (formData.get('event_start_date') as string) ?? null,
    event_start_time: (formData.get('event_start_time') as string) ?? null,
    event_end_date: (formData.get('event_end_date') as string) ?? null,
    event_end_time: (formData.get('event_end_time') as string) ?? null,
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid form: ' + JSON.stringify(parsed.error.flatten().fieldErrors))
  }

  const {
    title,
    description,
    totalEur,
    total_is_per_person,
    min_participants,
    max_participants,
    event_start_date,
    event_start_time,
    event_end_date,
    event_end_time,
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

  const normalizedAmount = totalEur.replace(',', '.').trim()
  const amountFloat = parseFloat(normalizedAmount)
  if (!isFinite(amountFloat) || amountFloat < 0) {
    throw new Error('Invalid total amount')
  }
  const total_cents = Math.round(amountFloat * 100)
  const totalIsPerPerson = total_is_per_person === 'true'
  const eventStartAt = parseEventDateTime(event_start_date, event_start_time, '09:00')
  const eventEndAt = parseEventDateTime(event_end_date, event_end_time, '17:00')
  if (eventStartAt && eventEndAt && new Date(eventEndAt) < new Date(eventStartAt)) {
    throw new Error('Event end must be after event start')
  }

  const { data: proj, error: pErr } = await supabaseAdmin
    .from('projects')
    .insert({
      title,
      description,
      total_cents,
      total_is_per_person: totalIsPerPerson,
      min_participants: minParticipants,
      max_participants: maxParticipants,
      event_start_at: eventStartAt,
      event_end_at: eventEndAt,
      status: 'collecting',
    })
    .select('id')
    .single()

  if (pErr || !proj?.id) {
    throw new Error(
      `Failed to create project: ${pErr?.message ?? 'unknown'} (code: ${pErr?.code ?? 'n/a'}, details: ${JSON.stringify(pErr?.details)})`
    )
  }

  const { data: part, error: iErr } = await supabaseAdmin
    .from('participants')
    .insert({
      project_id: proj.id,
      user_id: uid,
      role: 'organizer',
      short_code: null,
    })
    .select('id')
    .single()

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

  await recordProjectActivity({
    projectId: proj.id,
    entryType: 'project_created',
    actorUserId: uid,
    actorParticipantId: part.id,
    targetUserId: uid,
    targetParticipantId: part.id,
    metadata: {
      title,
      total_cents,
      total_is_per_person: totalIsPerPerson,
    },
  })

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

  revalidatePath('/')
  redirect(`/project/${proj.id}`)
}
