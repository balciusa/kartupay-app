'use server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function markReceived(participantId: string) {
  const { data: participant, error: e1 } = await supabaseAdmin
    .from('participants').select('id, project_id').eq('id', participantId).single()
  if (e1 || !participant) throw new Error('Participant not found')

  const { data: project, error: e2 } = await supabaseAdmin
    .from('projects').select('deadline_at').eq('id', participant.project_id).single()
  if (e2 || !project) throw new Error('Project not found')

  const isCounted = new Date() <= new Date(project.deadline_at as any)
  const { error: e3 } = await supabaseAdmin.from('payments').insert({
    participant_id: participantId,
    is_counted: isCounted
  })
  if (e3) throw e3
  revalidatePath(`/project/${participant.project_id}`)
}

export async function postMessage(projectId: string, body: string) {
  const text = (body ?? '').trim()
  if (!text) return
  const { error } = await supabaseAdmin.from('messages').insert({ project_id: projectId, body: text })
  if (error) throw error
  revalidatePath(`/project/${projectId}`)
}

export async function castVote(addonId: string) {
  const { error } = await supabaseAdmin.from('addon_votes').insert({ addon_id: addonId })
  if (error) throw error
  revalidatePath('/')
}

export async function createLateJoinTransfers(projectId: string, newcomerParticipantId: string) {
  const [{ data: project }, { data: participants }, { data: payments }] = await Promise.all([
    supabaseAdmin.from('projects').select('id, total_cents').eq('id', projectId).single(),
    supabaseAdmin.from('participants').select('id, project_id, role').eq('project_id', projectId),
    supabaseAdmin.from('payments').select('participant_id, is_counted').eq('is_counted', true)
  ])
  if (!project) throw new Error('Project not found')

  const paidSet = new Set((payments ?? []).filter(p => p.is_counted).map(p => p.participant_id))
  const existingPaidRecipients = (participants ?? []).filter(p => p.id !== newcomerParticipantId && paidSet.has(p.id))
  const perPerson = Math.floor(project.total_cents / ((participants?.length ?? 0) + 1))

  const rows = existingPaidRecipients.map(rec => ({
    project_id: projectId,
    from_participant_id: newcomerParticipantId,
    to_participant_id: rec.id,
    expected_cents: perPerson
  }))

  if (rows.length === 0) return
  const { error } = await supabaseAdmin.from('late_join_transfers').insert(rows)
  if (error) throw error
  revalidatePath(`/project/${projectId}`)
}

export async function confirmLateJoinReceipt(transferId: string) {
  const { data: t, error: e1 } = await supabaseAdmin
    .from('late_join_transfers').select('id, project_id').eq('id', transferId).single()
  if (e1 || !t) throw new Error('Transfer not found')

  const { error } = await supabaseAdmin
    .from('late_join_transfers')
    .update({ received_at: new Date().toISOString() })
    .eq('id', transferId)

  if (error) throw error
  revalidatePath(`/project/${t.project_id}`)
}
