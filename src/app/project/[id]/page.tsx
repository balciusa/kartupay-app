import { SummaryCards } from '@/components/Project/SummaryCards'
import { Participants } from '@/components/Project/Participants'
import Chat from '@/components/Project/Chat'
import Voting from '@/components/Project/Voting'
import { ProjectTabs } from '@/components/Project/ProjectTabs'
import { AdminPanel } from '@/components/Project/AdminPanel'
import { type ActivityLogItem } from '@/components/Project/ActivityLogTab'
import { OutgoingTransfer } from '@/components/Project/OutgoingTransfer'
import { LeaveProjectButton } from '@/components/Project/LeaveProjectButton'
import { JoinButton } from '@/components/Project/JoinButton'
import { ProfileTab } from '@/components/Project/ProfileTab'
import { ProjectSettingsTab } from '@/components/Project/ProjectSettingsTab'
import { LateOutgoingTransfers } from '@/components/Project/LateOutgoingTransfers'
import { ExtrasTab } from '@/components/Project/ExtrasTab'
import { getActivityCategory } from '@/lib/activityLog'
import { buildExtraDueRows, extraDueKey } from '@/lib/extraPayments'
import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { confirmLateJoinReceipt, markExtraReceived, markReceived, selfReportExtraPaid } from './actions'

type LateTransferRow = {
  id: string
  project_id: string
  from_participant_id: string
  to_participant_id: string
  expected_cents: number
  received_at: string | null
  sender_marked_at: string | null
}

type ExtraRow = {
  id: string
  project_id: string
  title: string
  description: string | null
  amount_cents: number
  amount_is_per_person: boolean
  collection_mode: string
  dedicated_collector_participant_id: string | null
  created_by: string
  created_at: string
}

type ExtraMembershipRow = {
  id: string
  extra_id: string
  participant_id: string
  left_at: string | null
}

type ExtraPaymentRow = {
  id: string
  extra_id: string
  payer_participant_id: string
  collector_participant_id: string
  amount_cents: number
  reported_at: string | null
  confirmed_at: string | null
}

type ActivityLogRow = {
  id: string
  project_id: string
  occurred_at: string
  entry_type: string
  actor_user_id: string | null
  actor_participant_id: string | null
  target_user_id: string | null
  target_participant_id: string | null
  payment_id: string | null
  poll_id: string | null
  extra_id: string | null
  join_request_id: string | null
  late_transfer_id: string | null
  metadata: Record<string, unknown> | null
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: { id?: string } | Promise<{ id?: string }>
  searchParams?: { id?: string | string[] } | Promise<{ id?: string | string[] }>
}) {
  const resolvedParams = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const pathId = Array.isArray(resolvedParams?.id) ? resolvedParams?.id?.[0] : resolvedParams?.id
  const queryId = resolvedSearchParams
    ? (Array.isArray(resolvedSearchParams?.id) ? resolvedSearchParams?.id?.[0] : resolvedSearchParams?.id)
    : undefined
  const projectId = pathId || queryId

  if (!projectId) {
    return (
      <main className="p-6 max-w-2xl mx-auto space-y-4">
        <h1 className="text-xl font-semibold">Project not found (missing id)</h1>
        <p className="text-sm opacity-70">
          Expected a URL like <code>/project/&lt;uuid&gt;</code>. Go back to the home list and ensure links use the
          real project <code>id</code>.
        </p>
      </main>
    )
  }

  const supabase = await getSupabaseServer()

  const baseProjectFields =
    'id, title, description, total_cents, total_is_per_person, min_participants, max_participants, status, canceled_at, collector_participant_id, event_start_at, event_end_at'
  const optionalProjectFields = ['closed_at', 'aborted_at', 'finalized_at'] as const
  let optionalFields = [...optionalProjectFields]
  const missingFields = new Set<string>()
  let project: any = null
  let projectError: { message?: string } | null = null

  while (true) {
    const selectList = [baseProjectFields, ...optionalFields].join(', ')
    const { data, error } = await supabase
      .from('projects')
      .select(selectList)
      .eq('id', projectId)
      .single()

    const missingField = optionalFields.find(field => missingColumn(error, field))
    if (missingField) {
      console.warn(`[ProjectPage] ${missingField} column missing, retrying without it`)
      missingFields.add(missingField)
      optionalFields = optionalFields.filter(field => field !== missingField)
      if (optionalFields.length === 0) {
        const fallback = await supabase
          .from('projects')
          .select(baseProjectFields)
          .eq('id', projectId)
          .single()
        project = fallback.data
        projectError = fallback.error
        break
      }
      continue
    }

    project = data
    projectError = error
    break
  }

  if (project && optionalProjectFields.length) {
    for (const field of optionalProjectFields) {
      if (missingFields.has(field) || typeof project[field] === 'undefined') {
        project[field] = null
      }
    }
  }

  if (projectError || !project) {
    return (
      <main className="p-6 max-w-2xl mx-auto space-y-4">
        <h1 className="text-xl font-semibold">Project not found (debug)</h1>
        <pre className="text-xs whitespace-pre-wrap border rounded p-3 bg-muted/30">
          {JSON.stringify({
            projectId,
            projectError: projectError?.message ?? null
          }, null, 2)}
        </pre>
        <p className="text-sm opacity-70">
          Check your home list link href and confirm a row with this id exists in <code>projects</code>.
        </p>
      </main>
    )
  }

  const isCollectingStatus = project.status === 'collecting'
  const isClosedStatus = project.status === 'closed'
  const isCancelledStatus = project.status === 'cancelled' || project.status === 'canceled'
  const isAborted = isCancelledStatus || !!project.aborted_at || !!project.canceled_at
  const statusPill = (() => {
    if (isAborted) {
      return {
        label: 'Canceled',
        className: 'border-red-200 bg-red-50 text-red-700',
      }
    }
    if (isClosedStatus) {
      return {
        label: 'Closed',
        className: 'border-slate-200 bg-slate-100 text-slate-700',
      }
    }
    if (isCollectingStatus) {
      return {
        label: 'Collecting',
        className: 'border-emerald-200 bg-emerald-100 text-emerald-700',
      }
    }
    return {
      label: typeof project.status === 'string' && project.status.trim() ? project.status : 'Unknown',
      className: 'border-border bg-muted text-muted-foreground',
    }
  })()
  const isFinalized = isClosedStatus || !!project.finalized_at || !!project.closed_at
  const abortedAtDisplay = (project.aborted_at as string | null) ?? (project.canceled_at as string | null) ?? null
  const abortedAtLocale = abortedAtDisplay ? new Date(abortedAtDisplay).toLocaleString() : null
  const closedAt = (project.closed_at as string | null) ?? null
  const formatLocal24 = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(undefined, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : null
  const eventStartLocale = formatLocal24(project.event_start_at as string | null)
  const eventEndLocale = formatLocal24(project.event_end_at as string | null)

  const uid = await getCurrentUserId()

  // Fetch all related data in parallel
  const pollsPromise = (async () => {
    const basePollFields = 'id, title, description, extra_cents, required_votes, created_by'
    const withType = await supabase
      .from('polls')
      .select(`${basePollFields}, extra_is_per_person`)
      .eq('project_id', projectId)

    if (!missingColumn(withType.error, 'extra_is_per_person')) return withType

    console.warn('[ProjectPage] extra_is_per_person missing, retrying polls without it')
    const fallback = await supabase
      .from('polls')
      .select(basePollFields)
      .eq('project_id', projectId)

    return {
      data: (fallback.data ?? []).map(poll => ({ ...poll, extra_is_per_person: false })),
      error: fallback.error,
    }
  })()

  const extrasPromise = (async (): Promise<ExtraRow[]> => {
    const { data, error } = await supabase
      .from('extras')
      .select(
        'id, project_id, title, description, amount_cents, amount_is_per_person, collection_mode, dedicated_collector_participant_id, created_by, created_at'
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      if (missingTable(error, 'extras')) {
        console.warn('[ProjectPage] extras table missing, skipping extras section')
        return []
      }
      console.error('[ProjectPage] extras fetch error', error)
      return []
    }
    return (data ?? []) as ExtraRow[]
  })()

  const [
    { data: participants },
    { data: messages },
    { data: polls },
    { data: allPayments },
    { data: myJoinRequest }
  ] = await Promise.all([
    supabase
      .from('participants')
      .select('id, user_id, role, short_code, joined_at, users(email, display_name)')
      .eq('project_id', projectId)
      .is('left_at', null)
      .order('joined_at', { ascending: true }),
    supabase
      .from('messages')
      .select('id, project_id, user_id, author_user_id, parent_id, body, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    pollsPromise,
    supabase.from('payments').select('participant_id, is_counted, created_at'),
    supabase
      .from('join_requests')
      .select('status')
      .eq('project_id', projectId)
      .eq('requester_user_id', uid ?? '')
      .maybeSingle()
  ])
  const pollIds = (polls ?? []).map(poll => poll.id)
  const { data: pollOptions } = pollIds.length
    ? await supabase
        .from('poll_options')
        .select('id, poll_id, label')
        .in('poll_id', pollIds)
    : { data: [] as Array<{ id: string; poll_id: string; label: string }> }
  const { data: pollVotes } = pollIds.length
    ? await supabase
        .from('poll_votes')
        .select('poll_id, option_id, user_id')
        .in('poll_id', pollIds)
    : { data: [] as Array<{ poll_id: string; option_id: string; user_id: string }> }
  const extrasRaw = await extrasPromise
  const extraIds = extrasRaw.map(extra => extra.id)
  const { data: extraMembershipRows, error: extraMembershipsErr } = extraIds.length
    ? await supabase
        .from('extra_memberships')
        .select('id, extra_id, participant_id, left_at')
        .in('extra_id', extraIds)
    : { data: [] as ExtraMembershipRow[], error: null as { message?: string; code?: string } | null }
  if (extraMembershipsErr) {
    if (missingTable(extraMembershipsErr, 'extra_memberships')) {
      console.warn('[ProjectPage] extra_memberships table missing, skipping extras memberships')
    } else {
      console.error('[ProjectPage] extra memberships fetch error', extraMembershipsErr)
    }
  }
  let extraPaymentsAvailable = true
  let extraPaymentRows: ExtraPaymentRow[] = []
  if (extraIds.length) {
    const { data: rawExtraPayments, error: extraPaymentsErr } = await supabaseAdmin
      .from('extra_payments')
      .select(
        'id, extra_id, payer_participant_id, collector_participant_id, amount_cents, reported_at, confirmed_at'
      )
      .in('extra_id', extraIds)
    if (extraPaymentsErr) {
      if (missingTable(extraPaymentsErr, 'extra_payments')) {
        extraPaymentsAvailable = false
        console.warn('[ProjectPage] extra_payments table missing, skipping extra payment statuses')
      } else {
        console.error('[ProjectPage] extra payments fetch error', extraPaymentsErr)
      }
    } else {
      extraPaymentRows = (rawExtraPayments ?? []) as ExtraPaymentRow[]
    }
  }
  const messageAuthorIds = Array.from(
    new Set((messages ?? []).map(m => m.user_id ?? m.author_user_id).filter(Boolean))
  )
  let userDisplayMap: Record<string, string> = {}
  if (messageAuthorIds.length) {
    const { data: messageUsers, error: usersErr } = await supabase
      .from('users')
      .select('id, display_name, email')
      .in('id', messageAuthorIds)
    if (usersErr) {
      console.error('[ProjectPage] users fetch error', usersErr)
    } else {
      userDisplayMap = (messageUsers ?? []).reduce<Record<string, string>>((acc, user) => {
        const displayName = user.display_name?.trim()
        const fallback = user.email ? user.email.split('@')[0] : `#${user.id.slice(0, 6)}`
        acc[user.id] = displayName || fallback
        return acc
      }, {})
    }
  }

  const lateTransfersResult = await supabase
    .from('late_join_transfers')
    .select('id, project_id, from_participant_id, to_participant_id, expected_cents, received_at, sender_marked_at')
    .eq('project_id', projectId)
  let lateTransfers: LateTransferRow[] = (lateTransfersResult.data as LateTransferRow[]) ?? []
  if (lateTransfersResult.error) {
    if (missingColumn(lateTransfersResult.error, 'sender_marked_at')) {
      console.warn('[ProjectPage] sender_marked_at missing, retrying late transfers without it')
      const fallback = await supabase
        .from('late_join_transfers')
        .select('id, project_id, from_participant_id, to_participant_id, expected_cents, received_at')
        .eq('project_id', projectId)
      lateTransfers =
        (fallback.data ?? []).map(row => ({
          ...row,
          sender_marked_at: null,
        })) as LateTransferRow[]
    } else {
      console.error('[ProjectPage] late transfers fetch error', lateTransfersResult.error)
      lateTransfers = []
    }
  }

  // Collect participant IDs for this project
  const participantIdsArr = (participants ?? []).map(p => p.id)
  // Fetch payment options that belong to these participant IDs
  const { data: paymentOptions, error: pmErr } = participantIdsArr.length
    ? await supabase
        .from('payment_options')
        .select('*')
        .in('participant_id', participantIdsArr)
    : { data: [], error: null as any }
  if (pmErr) throw pmErr

  let pendingSignalsSet = new Set<string>()
  if (participantIdsArr.length) {
    const { data: pendingSignals, error: sigErr } = await supabaseAdmin
      .from('payment_signals')
      .select('participant_id, cleared_at')
      .in('participant_id', participantIdsArr)
      .is('cleared_at', null)

    if (sigErr) {
      const code = (sigErr as any)?.code
      const isMissingTable =
        code === '42P01' ||
        sigErr.message?.toLowerCase()?.includes('payment_signals')
      if (!isMissingTable) throw sigErr
      console.warn('[ProjectPage] skipping payment_signals fetch', { reason: 'missing_table' })
    } else {
      pendingSignalsSet = new Set<string>((pendingSignals ?? []).map(signal => signal.participant_id))
    }
  }

  // Process participants and payment methods
  const rawParticipants = participants ?? []
  let isMeParticipant = false
  let myParticipantId: string | null = null
  let myParticipantRole: string | null = null
  if (uid) {
    const { data: mine, error: mineErr } = await supabase
      .from('participants')
      .select('id, role, left_at')
      .eq('project_id', projectId)
      .eq('user_id', uid)
      .is('left_at', null)
      .limit(1)
    if (mineErr) {
      console.error('[ProjectPage] Error fetching my participant:', mineErr)
    }
    isMeParticipant = !!(mine && mine.length > 0)
    myParticipantId = mine?.[0]?.id ?? null
    myParticipantRole = mine?.[0]?.role ?? null
    console.log('[ProjectPage] My participant status:', { 
      uid, 
      isMeParticipant, 
      myParticipantId, 
      myParticipantRole,
      participantData: mine 
    })
  }

  const participantsClean = rawParticipants
  const maskEmail = (email?: string | null) => {
    if (!email) return null
    const [name, domain] = email.split('@')
    if (!domain) return email
    const head = name.slice(0, 2)
    return `${head}***@${domain}`
  }
  const resolveUserProfile = (
    users?: { email?: string | null; display_name?: string | null } | Array<{ email?: string | null; display_name?: string | null }> | null
  ) => {
    if (!users) return null
    return Array.isArray(users) ? users[0] ?? null : users
  }
  const participantName = (p: { users?: { email?: string | null; display_name?: string | null } | Array<{ email?: string | null; display_name?: string | null }> | null; short_code?: string | null }) => {
    const profile = resolveUserProfile(p.users)
    const displayName = profile?.display_name ?? null
    if (displayName) return displayName
    const masked = maskEmail(profile?.email ?? null)
    if (masked) return masked
    if (p.short_code) return `#${p.short_code}`
    return 'Member'
  }
  const participantsCount = participantsClean.length
  const minParticipants = project.min_participants as number | null
  const maxParticipants = project.max_participants as number | null
  const finalizedAt = (project.finalized_at as string | null) ?? (project.closed_at as string | null) ?? null
  const finalizedAtDate = finalizedAt ? new Date(finalizedAt) : null
  const baseParticipants = finalizedAtDate
    ? participantsClean.filter(p => !p.joined_at || new Date(p.joined_at) <= finalizedAtDate)
    : participantsClean
  const baseParticipantIds = new Set(baseParticipants.map(p => p.id))
  const baseParticipantsCount = baseParticipants.length
  const minParticipantsReached = !minParticipants || participantsCount >= minParticipants
  const canJoinNow =
    isCollectingStatus &&
    !isAborted &&
    (!maxParticipants || participantsCount < maxParticipants)
  const myJoinRequestStatus =
    (myJoinRequest as { status?: string } | null)?.status ?? null
  const participantIds = new Set(participantsClean.map(p => p.id))
  const paymentMethodsList = (paymentOptions ?? []).filter(pm => pm.is_active !== false)
  
  // Filter payments to only those for participants in this project
  const payments = (allPayments ?? []).filter(p => participantIds.has(p.participant_id))
  
  // Build preferred payment methods map (as Map for component)
  const preferred = new Map<string, { label: string | null, value: string, type: string }>()
  const allOptions = new Map<string, Array<{ label: string | null, value: string, type: string, priority: number, is_active?: boolean }>>()
  
  for (const p of participantsClean) {
    const methods = paymentMethodsList.filter(pm => pm.participant_id === p.id)
    if (methods.length > 0) {
      // Sort by priority, find preferred (lowest priority number)
      const sorted = methods.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      preferred.set(p.id, {
        label: sorted[0].label,
        value: sorted[0].value,
        type: sorted[0].type
      })
      allOptions.set(p.id, sorted.map(m => ({
        label: m.label,
        value: m.value,
        type: m.type,
        priority: m.priority ?? 999,
        is_active: m.is_active !== false,
      })))
    }
  }
  const preferredEntries = Array.from(preferred.entries())
  const allOptionsEntries = Array.from(allOptions.entries())
  const lateTransferRows = lateTransfers ?? []

  // Process payments (as Sets for component)
  // paidSet includes ALL payments for UI display (whether counted or not)
  const allPaidIds = payments.map(p => p.participant_id)
  const paidSet = new Set(allPaidIds)
  
  // Only counted payments for threshold calculations
  const countedPayments = payments.filter(p => p.is_counted === true)
  const paidIds = countedPayments.map(p => p.participant_id)
  
  // Calculate scenarios
  const totalIsPerPerson = !!project.total_is_per_person
  const storedTotalCents = Number(project.total_cents ?? 0)
  const perPersonCents = totalIsPerPerson
    ? storedTotalCents
    : Math.floor(storedTotalCents / Math.max(1, participantsCount))
  const perPersonCentsAtFinalize = totalIsPerPerson
    ? storedTotalCents
    : Math.floor(storedTotalCents / Math.max(1, baseParticipantsCount))
  const totalCents = totalIsPerPerson
    ? perPersonCents * Math.max(1, participantsCount)
    : storedTotalCents
  const participantsNow = participantsCount
  const showPaymentsTab = participantsCount > 1
  const viewerPaid = !!(myParticipantId && paidSet.has(myParticipantId))
  const viewerHasPendingSignal = !!(myParticipantId && pendingSignalsSet.has(myParticipantId))
  const viewerPaidCents = viewerPaid ? perPersonCents : 0
  const formatEuro = (cents: number) => `€${(cents / 100).toFixed(2)}`
  const scenarios = totalIsPerPerson
    ? {
        now: perPersonCents,
        plus1: perPersonCents,
        plus2: perPersonCents
      }
    : {
        now: Math.floor(totalCents / Math.max(1, participantsNow)),
        plus1: Math.floor(totalCents / Math.max(1, participantsNow + 1)),
        plus2: Math.floor(totalCents / Math.max(1, participantsNow + 2))
      }

  const optionVoteCounts = new Map<string, number>()
  for (const vote of pollVotes ?? []) {
    optionVoteCounts.set(vote.option_id, (optionVoteCounts.get(vote.option_id) ?? 0) + 1)
  }
  const optionsByPoll = new Map<string, Array<{ id: string; label: string; votes: number }>>()
  for (const option of pollOptions ?? []) {
    const list = optionsByPoll.get(option.poll_id) ?? []
    list.push({
      id: option.id,
      label: option.label,
      votes: optionVoteCounts.get(option.id) ?? 0,
    })
    optionsByPoll.set(option.poll_id, list)
  }
  const pollsForVotingBase = (polls ?? [])
    .filter(poll => (poll.title ?? '').trim().length > 0)
    .map(poll => ({
      id: poll.id,
      title: poll.title,
      description: poll.description ?? null,
      extra_cents: Number(poll.extra_cents ?? 0),
      extra_is_per_person: poll.extra_is_per_person === true,
      required_votes: Number(poll.required_votes ?? 1),
      options: optionsByPoll.get(poll.id) ?? [],
      created_by: poll.created_by ?? null,
    }))

  // Find organizer
  const organizer = participantsClean.find(p => p.role === 'organizer')
  const organizerId = myParticipantRole === 'organizer' ? myParticipantId : organizer?.id ?? null
  const collectorId = (project.collector_participant_id as string | null) ?? organizerId
  const collectorParticipant = collectorId ? participantsClean.find(p => p.id === collectorId) : null
  const collectorLabel = collectorParticipant ? participantName(collectorParticipant) : 'Member'
  const collectorName = collectorLabel
  const viewerIsCollector = !!(myParticipantId && collectorId && myParticipantId === collectorId)
  const shouldLoadPendingRequests = viewerIsCollector
  const { data: pendingForOrganizer, error: pendingErr } = shouldLoadPendingRequests
    ? await supabaseAdmin
        .from('join_requests')
        .select('id, requester_user_id, created_at, status')
        .eq('project_id', projectId)
        .eq('status', 'pending')
    : { data: [] as Array<{ id: string; requester_user_id: string; created_at: string; status: string }>, error: null }
  
  if (pendingErr) {
    console.error('[ProjectPage] Error fetching pending requests:', pendingErr)
  }
  console.log('[ProjectPage] Pending requests for collector:', { count: pendingForOrganizer?.length ?? 0, requests: pendingForOrganizer })
  const effectivePaidIds = new Set(paidIds)
  if (collectorId) effectivePaidIds.add(collectorId)
  const basePaidIds = countedPayments
    .filter(p => baseParticipantIds.has(p.participant_id))
    .map(p => p.participant_id)
  const basePaidSet = new Set(basePaidIds)
  if (collectorId && baseParticipantIds.has(collectorId)) basePaidSet.add(collectorId)
  const collectedCentsDisplay = Math.min(perPersonCentsAtFinalize * basePaidSet.size, totalCents)
  const lateJoinerIds = new Set(
    finalizedAtDate
      ? participantsClean
          .filter(p => p.joined_at && new Date(p.joined_at) > finalizedAtDate)
          .map(p => p.id)
      : []
  )
  const lateJoinerPendingIds = new Set(
    lateTransfers.filter(t => !t.received_at).map(t => t.from_participant_id)
  )
  const lateJoinersCount = lateJoinerIds.size
  const lateTransfersPendingCount = lateTransfers.filter(t => !t.received_at).length
  const lateTransfersPendingCents = lateTransfers
    .filter(t => !t.received_at)
    .reduce((sum, t) => sum + t.expected_cents, 0)
  const settledIds = new Set<string>(basePaidSet)
  for (const id of lateJoinerIds) {
    if (!lateJoinerPendingIds.has(id)) settledIds.add(id)
  }
  const effectivePaidCount = Math.min(settledIds.size, participantsCount)
  const lateIncomingPendingCents = myParticipantId
    ? lateTransfers
        .filter(t => t.to_participant_id === myParticipantId && !t.received_at)
        .reduce((sum, t) => sum + t.expected_cents, 0)
    : 0
  const lateOutgoingPendingCents = myParticipantId
    ? lateTransfers
        .filter(t => t.from_participant_id === myParticipantId && !t.received_at)
        .reduce((sum, t) => sum + t.expected_cents, 0)
    : 0
  const lateOutgoingTransfers = myParticipantId
    ? lateTransfers.filter(t => t.from_participant_id === myParticipantId)
    : []
  const pendingSignalCount = viewerIsCollector ? pendingSignalsSet.size : 0
  const pendingLateConfirmations = myParticipantId
    ? lateTransfers.filter(t => t.to_participant_id === myParticipantId && t.sender_marked_at && !t.received_at).length
    : 0
  const outgoingPayAvailable =
    !viewerIsCollector &&
    !isAborted &&
    minParticipantsReached &&
    !!myParticipantId &&
    !!collectorId &&
    !viewerPaid &&
    !viewerHasPendingSignal
  const lateOutgoingDueCount = lateOutgoingTransfers.length
  const outgoingPaymentsDueCount = isFinalized
    ? lateOutgoingDueCount
    : outgoingPayAvailable
      ? 1
      : 0
  const pendingPaymentsCount =
    pendingSignalCount + pendingLateConfirmations + outgoingPaymentsDueCount

  const pollsForVoting = pollsForVotingBase.map(poll => ({
    id: poll.id,
    title: poll.title,
    description: poll.description,
    extra_cents: poll.extra_cents,
    extra_is_per_person: poll.extra_is_per_person,
    required_votes: poll.required_votes,
    options: poll.options,
    can_edit: !!uid && (poll.created_by === uid || viewerIsCollector),
  }))
  const extraCollectorOptions = participantsClean.map(p => ({
    participant_id: p.id,
    label: participantName(p),
  }))
  const participantsById = new Map(participantsClean.map(p => [p.id, p]))
  const participantsByUserId = new Map(participantsClean.map(p => [p.user_id, p]))
  const activeExtraMemberships = ((extraMembershipRows as ExtraMembershipRow[] | null) ?? []).filter(row => !row.left_at)
  const activeMembershipIdsByExtra = new Map<string, string[]>()
  for (const membership of activeExtraMemberships) {
    const list = activeMembershipIdsByExtra.get(membership.extra_id) ?? []
    list.push(membership.participant_id)
    activeMembershipIdsByExtra.set(membership.extra_id, list)
  }
  const extrasForTab = extrasRaw.map(extra => {
    const memberIds = activeMembershipIdsByExtra.get(extra.id) ?? []
    const membersCount = memberIds.length
    const viewerJoined = !!(myParticipantId && memberIds.includes(myParticipantId))
    const memberLabels = memberIds
      .flatMap(memberId => {
        const member = participantsById.get(memberId)
        return member ? [participantName(member)] : []
      })
      .sort((a, b) => a.localeCompare(b))
    const perMemberShare = extra.amount_is_per_person
      ? Number(extra.amount_cents ?? 0)
      : Math.floor(Number(extra.amount_cents ?? 0) / Math.max(1, membersCount))

    const requestedDedicatedCollector =
      extra.collection_mode === 'dedicated_collector' && extra.dedicated_collector_participant_id
        ? participantsById.get(extra.dedicated_collector_participant_id)
        : null
    const hasDedicatedCollector = !!requestedDedicatedCollector
    const resolvedCollectionMode = hasDedicatedCollector ? 'dedicated_collector' : 'project_collector'
    const resolvedDedicatedCollectorId = hasDedicatedCollector ? requestedDedicatedCollector?.id ?? null : null
    const resolvedCollectorLabel = hasDedicatedCollector
      ? participantName(requestedDedicatedCollector!)
      : collectorLabel

    const creatorParticipant = participantsByUserId.get(extra.created_by)
    const createdByLabel = creatorParticipant ? participantName(creatorParticipant) : `#${extra.created_by.slice(0, 6)}`

    return {
      id: extra.id,
      title: extra.title,
      description: extra.description ?? null,
      amount_cents: Number(extra.amount_cents ?? 0),
      amount_is_per_person: !!extra.amount_is_per_person,
      collection_mode: resolvedCollectionMode as 'project_collector' | 'dedicated_collector',
      dedicated_collector_participant_id: resolvedDedicatedCollectorId,
      collector_label: resolvedCollectorLabel,
      member_count: membersCount,
      member_labels: memberLabels,
      viewer_joined: viewerJoined,
      viewer_share_cents: viewerJoined ? perMemberShare : null,
      created_by_label: createdByLabel,
      can_manage: !!uid && (extra.created_by === uid || viewerIsCollector),
    }
  })
  const activeParticipantIds = new Set(participantsClean.map(p => p.id))
  const extraDueRows = buildExtraDueRows({
    extras: extrasRaw.map(extra => ({
      id: extra.id,
      title: extra.title,
      amount_cents: Number(extra.amount_cents ?? 0),
      amount_is_per_person: !!extra.amount_is_per_person,
      collection_mode: extra.collection_mode,
      dedicated_collector_participant_id: extra.dedicated_collector_participant_id,
    })),
    memberships: activeExtraMemberships.map(row => ({
      extra_id: row.extra_id,
      participant_id: row.participant_id,
      left_at: row.left_at,
    })),
    activeParticipantIds,
    projectCollectorParticipantId: collectorId,
  })
  const extraPaymentsByKey = new Map<string, ExtraPaymentRow>()
  for (const payment of extraPaymentRows) {
    extraPaymentsByKey.set(extraDueKey(payment.extra_id, payment.payer_participant_id), payment)
  }
  const extraDueWithStatus = extraDueRows.map(row => {
    const payment = extraPaymentsByKey.get(extraDueKey(row.extra_id, row.payer_participant_id))
    const amountMatches = !!payment && Number(payment.amount_cents ?? 0) === row.amount_cents
    const collectorMatches = !!payment && payment.collector_participant_id === row.collector_participant_id
    const rowMatchesCurrentDue = amountMatches && collectorMatches
    return {
      ...row,
      reported: rowMatchesCurrentDue && !!payment?.reported_at && !payment?.confirmed_at,
      confirmed: rowMatchesCurrentDue && !!payment?.confirmed_at,
    }
  })
  const extraTargetCents = extraDueWithStatus.reduce((sum, row) => sum + row.amount_cents, 0)
  const extraCollectedCents = extraDueWithStatus.reduce((sum, row) => {
    const autoCollected = row.payer_participant_id === row.collector_participant_id
    return sum + (autoCollected || row.confirmed ? row.amount_cents : 0)
  }, 0)
  const extraGrandTotalTargetCents = extraDueWithStatus
    .filter(row => !row.amount_is_per_person)
    .reduce((sum, row) => sum + row.amount_cents, 0)
  const extraGrandTotalCollectedCents = extraDueWithStatus
    .filter(row => !row.amount_is_per_person)
    .reduce((sum, row) => {
      const autoCollected = row.payer_participant_id === row.collector_participant_id
      return sum + (autoCollected || row.confirmed ? row.amount_cents : 0)
    }, 0)
  const extraPerPersonTargetCents = extraDueWithStatus
    .filter(row => row.amount_is_per_person)
    .reduce((sum, row) => sum + row.amount_cents, 0)
  const extraPerPersonCollectedCents = extraDueWithStatus
    .filter(row => row.amount_is_per_person)
    .reduce((sum, row) => {
      const autoCollected = row.payer_participant_id === row.collector_participant_id
      return sum + (autoCollected || row.confirmed ? row.amount_cents : 0)
    }, 0)
  const extraIncomingForViewer = viewerIsCollector && myParticipantId
    ? extraDueWithStatus.filter(
        row =>
          row.collector_participant_id === myParticipantId &&
          row.payer_participant_id !== myParticipantId &&
          !row.confirmed
      )
    : []
  const extraOutgoingForViewer = !viewerIsCollector && myParticipantId
    ? extraDueWithStatus.filter(
        row =>
          row.payer_participant_id === myParticipantId &&
          row.collector_participant_id !== myParticipantId &&
          !row.confirmed
      )
    : []
  const pendingExtraCollectorCount = viewerIsCollector ? extraIncomingForViewer.length : 0
  const pendingExtraOutgoingCount = !viewerIsCollector ? extraOutgoingForViewer.length : 0
  const pendingPaymentsCountWithExtras =
    pendingPaymentsCount + pendingExtraCollectorCount + pendingExtraOutgoingCount
  const totalCentsWithExtras = totalCents + extraTargetCents
  const collectedCentsWithExtras = collectedCentsDisplay + extraCollectedCents
  
  // Get collector options from payment_options (project-specific)
  let collectorPaymentOptions =
    collectorId
      ? (paymentOptions ?? []).filter(po => po.participant_id === collectorId && po.is_active !== false)
      : []
  
  // Fallback to user_payment_options if no project-specific options found
  // This handles cases where collector updated their payment options in Settings after joining
  if (collectorPaymentOptions.length === 0 && collectorParticipant?.user_id) {
    const { data: userPaymentOptions, error: userOptsError } = await supabaseAdmin
      .from('user_payment_options')
      .select('type, label, value, priority, is_active')
      .eq('user_id', collectorParticipant.user_id)
      .eq('is_active', true)
      .order('priority', { ascending: true })
    
    if (userOptsError) {
      console.error('[ProjectPage] Error fetching collector user_payment_options:', userOptsError)
    }
    
    collectorPaymentOptions = (userPaymentOptions ?? []).map(opt => ({
      label: opt.label,
      value: opt.value,
      type: opt.type,
      priority: opt.priority ?? 999,
      is_active: opt.is_active !== false,
    }))
  }
  
  console.log('[ProjectPage] Manager check:', {
    myParticipantRole,
    myParticipantId,
    organizerId,
    organizerFound: organizer?.id,
    isCollector: viewerIsCollector,
    pendingRequestsCount: pendingForOrganizer?.length ?? 0,
  })

  const isMemberActive = isMeParticipant
  const userVotes: Record<string, string | null> = {}
  if (uid) {
    for (const vote of pollVotes ?? []) {
      if (vote.user_id === uid) {
        userVotes[vote.poll_id] = vote.option_id
      }
    }
  }
  let unreadCount = 0
  if (uid && isMeParticipant) {
    const { data: chatRead, error: chatReadErr } = await supabaseAdmin
      .from('chat_reads')
      .select('last_read_at')
      .eq('project_id', projectId)
      .eq('user_id', uid)
      .maybeSingle()
    if (chatReadErr) {
      const msg = chatReadErr.message?.toLowerCase() ?? ''
      const missingTable = chatReadErr.code === '42P01' || msg.includes('chat_reads')
      if (!missingTable) {
        console.error('[ProjectPage] chat_reads fetch error', chatReadErr)
      }
    }
    const lastReadAt = chatRead?.last_read_at ? new Date(chatRead.last_read_at) : null
    unreadCount = lastReadAt
      ? (messages ?? []).filter(m => new Date(m.created_at) > lastReadAt).length
      : (messages ?? []).length
  }

  let activityItems: ActivityLogItem[] = []
  if (viewerIsCollector) {
    const { data: rawActivityRows, error: activityErr } = await supabaseAdmin
      .from('activity_logs')
      .select(
        'id, project_id, occurred_at, entry_type, actor_user_id, actor_participant_id, target_user_id, target_participant_id, payment_id, poll_id, extra_id, join_request_id, late_transfer_id, metadata'
      )
      .eq('project_id', projectId)
      .order('occurred_at', { ascending: false })
      .limit(400)

    if (activityErr) {
      if (missingTable(activityErr, 'activity_logs')) {
        console.warn('[ProjectPage] activity_logs table missing, skipping activity tab')
      } else {
        console.error('[ProjectPage] activity logs fetch error', activityErr)
      }
    } else {
      const activityRows = (rawActivityRows ?? []) as ActivityLogRow[]
      const participantIdsInLogs = new Set<string>()
      const userIdsInLogs = new Set<string>()
      for (const row of activityRows) {
        if (row.actor_participant_id) participantIdsInLogs.add(row.actor_participant_id)
        if (row.target_participant_id) participantIdsInLogs.add(row.target_participant_id)
        if (row.actor_user_id) userIdsInLogs.add(row.actor_user_id)
        if (row.target_user_id) userIdsInLogs.add(row.target_user_id)
      }

      const activityParticipantsById = new Map(participantsClean.map(p => [p.id, p]))
      const missingParticipantIds = Array.from(participantIdsInLogs).filter(id => !activityParticipantsById.has(id))
      if (missingParticipantIds.length) {
        const { data: missingParticipants, error: missingParticipantsErr } = await supabaseAdmin
          .from('participants')
          .select('id, user_id, role, short_code, joined_at, users(email, display_name)')
          .in('id', missingParticipantIds)
        if (missingParticipantsErr) {
          console.error('[ProjectPage] activity participants lookup error', missingParticipantsErr)
        } else {
          for (const participant of missingParticipants ?? []) {
            activityParticipantsById.set(participant.id, participant)
          }
        }
      }

      const userProfilesById = new Map<string, { display_name: string | null; email: string | null }>()
      if (userIdsInLogs.size) {
        const { data: activityUsers, error: activityUsersErr } = await supabaseAdmin
          .from('users')
          .select('id, display_name, email')
          .in('id', Array.from(userIdsInLogs))
        if (activityUsersErr) {
          console.error('[ProjectPage] activity users lookup error', activityUsersErr)
        } else {
          for (const user of activityUsers ?? []) {
            userProfilesById.set(user.id, {
              display_name: user.display_name ?? null,
              email: user.email ?? null,
            })
          }
        }
      }

      const userLabel = (userId: string | null | undefined) => {
        if (!userId) return null
        const profile = userProfilesById.get(userId)
        if (profile?.display_name?.trim()) return profile.display_name.trim()
        const masked = maskEmail(profile?.email ?? null)
        if (masked) return masked
        return `#${userId.slice(0, 6)}`
      }

      const participantLabel = (participantId: string | null | undefined) => {
        if (!participantId) return null
        const participant = activityParticipantsById.get(participantId)
        if (!participant) return null
        return participantName(participant)
      }

      const resolveLabel = (participantId: string | null | undefined, userId: string | null | undefined) =>
        participantLabel(participantId) ?? userLabel(userId) ?? 'Member'

      const readMetaString = (meta: Record<string, unknown> | null | undefined, key: string) => {
        const value = meta?.[key]
        return typeof value === 'string' && value.trim() ? value : null
      }
      const readMetaNumber = (meta: Record<string, unknown> | null | undefined, key: string) => {
        const value = meta?.[key]
        return typeof value === 'number' && Number.isFinite(value) ? value : null
      }

      activityItems = activityRows.map(row => {
        const meta = row.metadata ?? {}
        const actorLabel = resolveLabel(row.actor_participant_id, row.actor_user_id)
        const targetLabel = resolveLabel(row.target_participant_id, row.target_user_id)
        const toStatus = readMetaString(meta, 'to_status')
        const fromStatus = readMetaString(meta, 'from_status')
        const extraTitle = readMetaString(meta, 'title')
        const pollTitle = readMetaString(meta, 'title')
        const recipientsCount = readMetaNumber(meta, 'recipients_count')
        const optionId = readMetaString(meta, 'option_id')

        let message = `${actorLabel} did ${row.entry_type.replaceAll('_', ' ')}`
        switch (row.entry_type) {
          case 'project_created':
            message = `${actorLabel} created the project`
            break
          case 'project_updated':
            message = `${actorLabel} updated project settings`
            break
          case 'project_status_changed':
            message = fromStatus && toStatus
              ? `${actorLabel} changed project status from ${fromStatus} to ${toStatus}`
              : `${actorLabel} changed project status${toStatus ? ` to ${toStatus}` : ''}`
            break
          case 'collector_changed':
            message = `${actorLabel} changed collector to ${targetLabel}`
            break
          case 'participant_joined':
            message = `${targetLabel} joined the project`
            break
          case 'participant_left':
            message = `${targetLabel} left the project`
            break
          case 'join_request_submitted':
            message = `${actorLabel} submitted a join request`
            break
          case 'join_request_approved':
            message = `${actorLabel} approved join request for ${targetLabel}`
            break
          case 'join_request_rejected':
            message = `${actorLabel} rejected join request${row.target_user_id ? ` for ${targetLabel}` : ''}`
            break
          case 'join_request_canceled':
            message = `${actorLabel} canceled a join request`
            break
          case 'payment_reported':
            message = `${actorLabel} reported a payment`
            break
          case 'payment_confirmed':
            message = `${actorLabel} confirmed payment${row.target_participant_id ? ` from ${targetLabel}` : ''}`
            break
          case 'payment_unconfirmed':
            message = `${actorLabel} unconfirmed a payment`
            break
          case 'late_transfer_created':
            message = `${actorLabel} created ${recipientsCount ?? 0} late transfer${recipientsCount === 1 ? '' : 's'}${row.target_participant_id ? ` for ${targetLabel}` : ''}`
            break
          case 'late_transfer_sender_marked':
            message = `${actorLabel} marked a late transfer as paid`
            break
          case 'late_transfer_collector_confirmed':
            message = `${actorLabel} confirmed a late transfer receipt`
            break
          case 'poll_created':
            message = `${actorLabel} created poll${pollTitle ? ` \"${pollTitle}\"` : ''}`
            break
          case 'poll_updated':
            message = `${actorLabel} updated poll${pollTitle ? ` \"${pollTitle}\"` : ''}`
            break
          case 'poll_deleted':
            message = `${actorLabel} deleted poll${pollTitle ? ` \"${pollTitle}\"` : ''}`
            break
          case 'poll_vote_cast':
            message = `${actorLabel} cast a vote${optionId ? ` (${optionId.slice(0, 6)})` : ''}`
            break
          case 'poll_vote_changed':
            message = `${actorLabel} changed a vote${optionId ? ` (${optionId.slice(0, 6)})` : ''}`
            break
          case 'extra_created':
            message = `${actorLabel} created extra${extraTitle ? ` \"${extraTitle}\"` : ''}`
            break
          case 'extra_updated':
            message = `${actorLabel} updated extra${extraTitle ? ` \"${extraTitle}\"` : ''}`
            break
          case 'extra_joined':
            message = `${actorLabel} joined extra${extraTitle ? ` \"${extraTitle}\"` : ''}`
            break
          case 'extra_left':
            message = `${actorLabel} left extra${extraTitle ? ` \"${extraTitle}\"` : ''}`
            break
          case 'extra_collector_changed':
            message = `${actorLabel} changed extra collector${extraTitle ? ` for \"${extraTitle}\"` : ''}`
            break
          case 'extra_deleted':
            message = `${actorLabel} deleted extra${extraTitle ? ` \"${extraTitle}\"` : ''}`
            break
          default:
            break
        }

        return {
          id: row.id,
          occurred_at: row.occurred_at,
          category: getActivityCategory(row.entry_type),
          message,
        }
      })
    }
  }

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_45%),linear-gradient(to_bottom,#ffffff,#f8fafc)] p-5 md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-3">
            <div>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusPill.className}`}>
                {statusPill.label}
              </span>
            </div>
            <h1 className="break-words text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">{project.title}</h1>
            {project.description && (
              <div className="max-w-2xl text-sm text-slate-600 md:text-base">{project.description}</div>
            )}
            {(eventStartLocale || eventEndLocale) && (
              <div className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-sm text-slate-700">
                {eventStartLocale && eventEndLocale
                  ? `Event window: ${eventStartLocale} - ${eventEndLocale}`
                  : eventStartLocale
                    ? `Event starts: ${eventStartLocale}`
                    : `Event ends: ${eventEndLocale}`}
              </div>
            )}
          </div>
          <div className="flex items-start gap-2 md:items-center">
            {isClosedStatus ? (
              !isMemberActive && !isAborted ? (
                <div className="flex items-center gap-2">
                  <JoinButton projectId={projectId} canJoinNow={canJoinNow} requestStatus={myJoinRequestStatus} />
                </div>
              ) : null
            ) : isMemberActive && !viewerIsCollector && !isFinalized && !isAborted ? (
              <div className="flex items-center gap-2">
                <LeaveProjectButton projectId={projectId} />
              </div>
            ) : !isMemberActive && !isAborted ? (
              <div className="flex items-center gap-2">
                <JoinButton
                  projectId={projectId}
                  canJoinNow={canJoinNow}
                  requestStatus={myJoinRequestStatus}
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {isAborted && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm">
          This project was aborted {abortedAtLocale ? `on ${abortedAtLocale}` : 'recently'}.
        </div>
      )}

      <ProjectTabs
        counts={{
          participants: participantsCount,
          activity: unreadCount,
          adminPending: viewerIsCollector ? (pendingForOrganizer ?? []).length : 0,
          paymentsPending: pendingPaymentsCountWithExtras || undefined,
        }}
        sections={{
          overview: (
            <div className="space-y-6">
              <SummaryCards
                totalCents={totalCents}
                collectedCents={collectedCentsDisplay}
                totalIsPerPerson={totalIsPerPerson}
                minParticipants={project.min_participants as number | null}
                maxParticipants={project.max_participants as number | null}
                participantsNow={participantsNow}
                scenarios={scenarios}
                extrasSummary={
                  extraTargetCents > 0
                    ? {
                        targetCents: extraTargetCents,
                        collectedCents: extraCollectedCents,
                        grandTotalTargetCents: extraGrandTotalTargetCents,
                        grandTotalCollectedCents: extraGrandTotalCollectedCents,
                        perPersonTargetCents: extraPerPersonTargetCents,
                        perPersonCollectedCents: extraPerPersonCollectedCents,
                      }
                    : null
                }
                lateSummary={{
                  joinersCount: lateJoinersCount,
                  pendingCount: lateTransfersPendingCount,
                  pendingCents: lateTransfersPendingCents,
                }}
              />
            </div>
          ),
          profile: <ProfileTab projectId={projectId} />,
          people: (
            <div className="grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(0,1.35fr)]">
              <div className="min-w-0">
                <Participants
                  projectId={projectId}
                  participants={participantsClean}
                  preferred={preferredEntries}
                  allOptions={allOptionsEntries}
                  paidSet={paidSet}
                  organizerId={organizerId}
                  pendingRequests={viewerIsCollector ? (pendingForOrganizer ?? []) : []}
                  showPendingRequests={false}
                  showPayments={false}
                  myParticipantId={myParticipantId}
                  currentUserId={uid}
                  projectCanceled={isAborted}
                  perPersonCents={perPersonCents}
                  collectorId={collectorId}
                  collectorOptions={collectorPaymentOptions}
                  pendingSignalsSet={pendingSignalsSet}
                  transfers={lateTransferRows}
                  closedAt={closedAt}
                  projectStatus={project.status}
                />
              </div>
              <section className="border rounded-2xl bg-white p-4 space-y-4 min-w-0">
                <div className="space-y-0.5">
                  <h2 className="text-base font-semibold text-slate-900">Chat</h2>
                  <p className="text-sm text-muted-foreground">Coordinate updates with the group</p>
                </div>
                <Chat
                  projectId={projectId}
                  messages={messages ?? []}
                  userDisplayMap={userDisplayMap}
                  canRead={isMeParticipant}
                />
              </section>
            </div>
          ),
          payments: showPaymentsTab ? (
            <div className="space-y-4">
              <section className="border rounded-xl p-4 space-y-2">
                <h2 className="text-lg font-semibold">Balances</h2>
                <div
                  className={`grid gap-3 ${
                    lateIncomingPendingCents > 0 || lateOutgoingPendingCents > 0
                      ? 'md:grid-cols-3'
                      : 'md:grid-cols-2'
                  }`}
                >
                  <div className="border rounded-lg p-3 text-sm space-y-1">
                    <div className="text-xs uppercase opacity-60">Funds</div>
                    <div className="font-medium">
                      {`Collected ${formatEuro(collectedCentsWithExtras)} out of ${formatEuro(totalCentsWithExtras)}`}
                    </div>
                    {extraTargetCents > 0 && (
                      <div className="text-xs text-slate-500">
                        {`Base ${formatEuro(collectedCentsDisplay)}/${formatEuro(totalCents)} • Extras ${formatEuro(extraCollectedCents)}/${formatEuro(extraTargetCents)}`}
                      </div>
                    )}
                  </div>
                  <div className="border rounded-lg p-3 text-sm space-y-1">
                    <div className="text-xs uppercase opacity-60">SETTLED</div>
                    <div className="font-medium">
                      {`Settled ${effectivePaidCount} out of ${participantsCount}`}
                    </div>
                  </div>
                  {lateIncomingPendingCents > 0 && (
                    <div className="border rounded-lg p-3 text-sm space-y-1">
                      <div className="text-xs uppercase opacity-60">Late joiner due</div>
                      <div className="font-medium">{formatEuro(lateIncomingPendingCents)}</div>
                    </div>
                  )}
                  {lateOutgoingPendingCents > 0 && (
                    <div className="border rounded-lg p-3 text-sm space-y-1">
                      <div className="text-xs uppercase opacity-60">Late payments due</div>
                      <div className="font-medium">{formatEuro(lateOutgoingPendingCents)}</div>
                    </div>
                  )}
                </div>
              </section>
              <section className="border rounded-xl p-4 space-y-3">
                <div className="font-medium">Incoming transfers</div>
                {(() => {
                  const incomingLate = myParticipantId
                    ? lateTransfers.filter(t => t.to_participant_id === myParticipantId && !t.received_at)
                    : []
                  const incomingStandard = viewerIsCollector
                    ? participantsClean.filter(
                        p =>
                          p.id !== collectorId &&
                          !paidSet.has(p.id) &&
                          baseParticipantIds.has(p.id)
                      )
                    : []
                  const incomingExtra = viewerIsCollector ? extraIncomingForViewer : []
                  const hasAny = incomingStandard.length > 0 || incomingExtra.length > 0 || incomingLate.length > 0
                  if (!hasAny) {
                    return <div className="text-sm opacity-70">No incoming transfers.</div>
                  }
                  return (
                    <div className="divide-y">
                      {incomingStandard.map(p => (
                        <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span>
                              {participantName(p)} {formatEuro(perPersonCentsAtFinalize)}
                            </span>
                            {pendingSignalsSet.has(p.id) && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-300 text-amber-900">
                                Reported paid
                              </span>
                            )}
                          </div>
                          {!minParticipantsReached ? (
                            <span className="text-xs opacity-70">Waiting for minimum participants</span>
                          ) : (
                            <form action={markReceived.bind(null, p.id)}>
                              <button className="px-3 py-1.5 rounded border text-xs" type="submit">
                                {pendingSignalsSet.has(p.id) ? 'Confirm received' : 'Mark received'}
                              </button>
                            </form>
                          )}
                        </div>
                      ))}
                      {incomingExtra.map(row => {
                        const payer = participantsById.get(row.payer_participant_id)
                        const payerName = payer ? participantName(payer) : 'Participant'
                        const awaiting = row.reported
                        return (
                          <div key={`${row.extra_id}:${row.payer_participant_id}`} className="flex items-center justify-between py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span>
                                {payerName} {formatEuro(row.amount_cents)}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                                {row.extra_title ? `Extra: ${row.extra_title}` : 'Extra'}
                              </span>
                              {awaiting && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-300 text-amber-900">
                                  Reported paid
                                </span>
                              )}
                              {!extraPaymentsAvailable && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                                  Tracking unavailable
                                </span>
                              )}
                            </div>
                            {!minParticipantsReached ? (
                              <span className="text-xs opacity-70">Waiting for minimum participants</span>
                            ) : extraPaymentsAvailable ? (
                              <form action={markExtraReceived.bind(null, row.extra_id, row.payer_participant_id)}>
                                <button className="px-3 py-1.5 rounded border text-xs" type="submit">
                                  {awaiting ? 'Confirm received' : 'Mark received'}
                                </button>
                              </form>
                            ) : (
                              <span className="text-xs opacity-70">Apply latest migration</span>
                            )}
                          </div>
                        )
                      })}
                      {incomingLate.map(transfer => {
                        const sender = participantsClean.find(p => p.id === transfer.from_participant_id)
                        const senderName = sender ? participantName(sender) : 'Participant'
                        const awaiting = !!transfer.sender_marked_at && !transfer.received_at
                        return (
                          <div key={transfer.id} className="flex items-center justify-between py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span>
                                {senderName} {formatEuro(transfer.expected_cents)}
                              </span>
                              {awaiting && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-300 text-amber-900">
                                  Reported paid
                                </span>
                              )}
                            </div>
                            <form action={confirmLateJoinReceipt.bind(null, transfer.id)}>
                              <button className="px-3 py-1.5 rounded border text-xs" type="submit">
                                {awaiting ? 'Confirm received' : 'Mark received'}
                              </button>
                            </form>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </section>
              <section className="border rounded-xl p-4 space-y-3">
                <div className="font-medium">Outgoing transfers</div>
                {!viewerIsCollector && myParticipantId && collectorId ? (
                  (() => {
                    const showLateOutgoing = isFinalized && lateOutgoingTransfers.length > 0
                    const showBaseOutgoing = !isFinalized && !viewerPaid
                    const showExtraOutgoing = extraOutgoingForViewer.length > 0
                    if (!showLateOutgoing && !showBaseOutgoing && !showExtraOutgoing) {
                      return <div className="text-sm opacity-70">No outgoing transfers.</div>
                    }
                    return (
                      <div className="space-y-3">
                        {showLateOutgoing && (
                          <LateOutgoingTransfers
                            transfers={lateOutgoingTransfers}
                            participants={participantsClean}
                            allOptions={allOptionsEntries}
                            viewerParticipantId={myParticipantId}
                            projectCanceled={isAborted}
                          />
                        )}
                        {showBaseOutgoing && (
                          <div className="divide-y">
                            <OutgoingTransfer
                              collectorName={collectorName}
                              amountLabel={formatEuro(perPersonCents)}
                              collectorOptions={collectorPaymentOptions}
                              participantId={myParticipantId}
                              viewerPaid={viewerPaid}
                              viewerHasPendingSignal={viewerHasPendingSignal}
                              projectCanceled={isAborted}
                              canPay={minParticipantsReached}
                            />
                          </div>
                        )}
                        {showExtraOutgoing && (
                          <div className="divide-y">
                            {extraOutgoingForViewer.map(row => {
                              const collectorParticipant = participantsById.get(row.collector_participant_id)
                              const collectorNameForRow = collectorParticipant ? participantName(collectorParticipant) : 'Collector'
                              const collectorOptionsForRow =
                                (allOptions.get(row.collector_participant_id) ?? []).filter(
                                  option => option.is_active !== false
                                )
                              if (!extraPaymentsAvailable) {
                                return (
                                  <div key={`${row.extra_id}:${row.payer_participant_id}`} className="py-2 text-sm flex items-center justify-between gap-3">
                                    <div className="space-y-0.5">
                                      <div>{collectorNameForRow} - {formatEuro(row.amount_cents)}</div>
                                      <div className="text-xs text-slate-500">
                                        {row.extra_title ? `Extra: ${row.extra_title}` : 'Extra payment'}
                                      </div>
                                    </div>
                                    <span className="text-xs opacity-70">Apply latest migration</span>
                                  </div>
                                )
                              }
                              return (
                                <OutgoingTransfer
                                  key={`${row.extra_id}:${row.payer_participant_id}`}
                                  collectorName={collectorNameForRow}
                                  amountLabel={formatEuro(row.amount_cents)}
                                  collectorOptions={collectorOptionsForRow}
                                  participantId={myParticipantId}
                                  viewerPaid={false}
                                  viewerHasPendingSignal={row.reported}
                                  projectCanceled={isAborted}
                                  canPay={minParticipantsReached}
                                  contextLabel={row.extra_title ? `Extra: ${row.extra_title}` : 'Extra payment'}
                                  reportPaidAction={selfReportExtraPaid.bind(null, row.extra_id, row.payer_participant_id)}
                                />
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })()
                ) : (
                  <div className="text-sm opacity-70">No outgoing transfers.</div>
                )}
              </section>
            </div>
          ) : undefined,
          voting: (
            <Voting
              projectId={projectId}
              polls={pollsForVoting}
              projectCanceled={isAborted}
              canVote={isMemberActive}
              userVotes={userVotes}
            />
          ),
          extras: (
            <ExtrasTab
              projectId={projectId}
              extras={extrasForTab}
              canInteract={isMemberActive}
              projectCanceled={isAborted}
              projectCollectorLabel={collectorLabel}
              collectorOptions={extraCollectorOptions}
            />
          ),
          settings: viewerIsCollector ? <ProjectSettingsTab projectId={projectId} /> : null,
          admin: viewerIsCollector ? (
            <AdminPanel
              projectId={projectId}
              participants={participantsClean}
              collectorId={collectorId}
              myParticipantId={myParticipantId}
              pendingRequests={pendingForOrganizer ?? []}
              pendingCount={viewerIsCollector ? (pendingForOrganizer ?? []).length : 0}
              canManage={viewerIsCollector}
              canFinalize={isCollectingStatus && !isAborted}
              canCancel={!isAborted && !isFinalized}
              activityItems={activityItems}
            />
          ) : null,
        }}
      />
    </main>
  )
}

