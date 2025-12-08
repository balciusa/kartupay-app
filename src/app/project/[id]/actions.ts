'use server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getCurrentUserId } from '@/lib/supabaseServer'

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
  const { error } = await supabaseAdmin.from('messages').insert({ project_id: projectId, body })
  if (error) throw error
  revalidatePath(`/project/${projectId}`)
}

export async function castVote(addonId: string) {
  const { error } = await supabaseAdmin.from('addon_votes').insert({ addon_id: addonId })
  if (error) throw error
  revalidatePath('/') // paprasta reval
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

export async function joinProject(projectId: string) {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('You must be signed in')

  // See if already participant
  const { data: existing, error: qErr } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .limit(1)
  if (qErr) throw qErr

  let participantId = existing?.[0]?.id as string | undefined
  if (!participantId) {
    const { data: inserted, error: iErr } = await supabaseAdmin
      .from('participants')
      .insert({ project_id: projectId, user_id: uid, role: 'participant', short_code: null })
      .select('id')
      .single()
    if (iErr) throw iErr
    participantId = inserted.id
  }

  // Clone active user_payment_options -> payment_options (avoid duplicates)
  const [{ data: myUPOs, error: uErr }, { data: existingPOs, error: eErr }] = await Promise.all([
    supabaseAdmin.from('user_payment_options').select('type, label, value, priority, is_active').eq('user_id', uid).eq('is_active', true),
    supabaseAdmin.from('payment_options').select('type, value, participant_id').eq('participant_id', participantId!)
  ])
  if (uErr) throw uErr
  if (eErr) throw eErr

  const existingPairs = new Set((existingPOs ?? []).map(po => `${po.type}::${po.value}`))
  const rows = (myUPOs ?? []).filter(x => x.is_active).filter(x => !existingPairs.has(`${x.type}::${x.value}`)).map(x => ({
    participant_id: participantId!,
    type: x.type,
    label: x.label,
    value: x.value,
    priority: x.priority ?? 1,
    is_active: true
  }))

  if (rows.length > 0) {
    const { error: pErr } = await supabaseAdmin.from('payment_options').insert(rows)
    if (pErr) throw pErr
  }

  revalidatePath(`/project/${projectId}`)
}

export async function addMeAsOrganizerWithPayment(opts: {
  projectId: string
  paymentType: 'revolut' | 'swedbank' | 'iban'
  paymentLabel: string
  paymentValue: string
  priority?: number
}) {
  const { projectId, paymentType, paymentLabel, paymentValue } = opts
  const priority = opts.priority ?? 1

  // Try to get current user, but fall back to creating anonymous user for MVP (no auth required)
  let uid = await getCurrentUserId()
  if (!uid) {
    // MVP: Create an anonymous user
    // The foreign key might reference auth.users or a custom users table
    const anonymousEmail = `anon-${randomUUID()}@temp.local`
    
    // First, create user in auth.users
    const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: anonymousEmail,
      email_confirm: true,
      user_metadata: { is_anonymous: true }
    })
    
    if (authErr) {
      throw new Error(`Failed to create anonymous user in auth: ${authErr.message} (status: ${authErr.status})`)
    }
    
    if (!authUser?.user?.id) {
      throw new Error('Failed to create anonymous user: No user ID returned from auth')
    }
    
    uid = authUser.user.id
    
    // Try to create/update in public.users table if it exists (foreign key might reference it)
    // This is a best-effort attempt - if it fails, we'll still try to proceed
    try {
      const { error: usersErr } = await supabaseAdmin
        .from('users')
        .upsert({ id: uid, email: anonymousEmail }, { onConflict: 'id' })
      
      // If users table doesn't exist, that's fine - foreign key might reference auth.users
      if (usersErr && !usersErr.message.includes('relation') && !usersErr.message.includes('does not exist')) {
        console.warn('Could not upsert to users table:', usersErr.message)
      }
    } catch {
      // Ignore errors - users table might not exist
    }
  }

  // 1) Try to find existing participant for this user in this project
  const { data: existing, error: qErr } = await supabaseAdmin
    .from('participants')
    .select('id, user_id, role')
    .eq('project_id', projectId)
    .eq('user_id', uid)
    .limit(1)

  if (qErr) throw qErr

  let participantId: string | null = existing?.[0]?.id ?? null

  // 2) If none, create a new participant (organizer)
  if (!participantId) {
    const { data: part, error: iErr } = await supabaseAdmin
      .from('participants')
      .insert({ project_id: projectId, user_id: uid, role: 'organizer', short_code: null })
      .select('id')
      .single()
    if (iErr) {
      throw new Error(`Failed to create participant: ${iErr.message} (code: ${iErr.code})`)
    }
    if (!part || !part.id) {
      throw new Error('Failed to create participant: No ID returned')
    }
    participantId = part.id
  }

  // 3) Insert payment option (table name is payment_options, not payment_methods)
  // Try without project_id first (it may be derived from participant_id via foreign key)
  let { error: pErr } = await supabaseAdmin.from('payment_options').insert({
    participant_id: participantId,
    type: paymentType,
    label: paymentLabel?.trim() || null,
    value: paymentValue.trim(),
    priority,
  })
  
  // If that fails with foreign key error, try with project_id
  if (pErr && pErr.code === '23503') {
    const { error: pErr2 } = await supabaseAdmin.from('payment_options').insert({
      project_id: projectId,
      participant_id: participantId,
      type: paymentType,
      label: paymentLabel?.trim() || null,
      value: paymentValue.trim(),
      priority,
    })
    if (pErr2) {
      throw new Error(`Failed to create payment option: ${pErr2.message} (code: ${pErr2.code}, hint: ${pErr2.hint || 'none'}, details: ${JSON.stringify(pErr2.details)})`)
    }
  } else if (pErr) {
    throw new Error(`Failed to create payment option: ${pErr.message} (code: ${pErr.code}, hint: ${pErr.hint || 'none'}, details: ${JSON.stringify(pErr.details)})`)
  }

  revalidatePath(`/project/${projectId}`)
}

export async function addSampleAddon(projectId: string) {
  const { error } = await supabaseAdmin
    .from('addons')
    .insert({
      project_id: projectId,
      title: 'Sauna',
      description: null,
      extra_cents: 3000,
      required_votes: 2
    })

  if (error) throw error
  revalidatePath(`/project/${projectId}`)
}
