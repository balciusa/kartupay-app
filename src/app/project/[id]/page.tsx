import { SummaryCards } from '@/components/Project/SummaryCards'
import { Participants } from '@/components/Project/Participants'
import Chat from '@/components/Project/Chat'
import Voting from '@/components/Project/Voting'
import { ProjectTabs } from '@/components/Project/ProjectTabs'
import { AdminPanel } from '@/components/Project/AdminPanel'
import { OutgoingTransfer } from '@/components/Project/OutgoingTransfer'
import { LeaveProjectButton } from '@/components/Project/LeaveProjectButton'
import { JoinButton } from '@/components/Project/JoinButton'
import { ProfileTab } from '@/components/Project/ProfileTab'
import { ProjectSettingsTab } from '@/components/Project/ProjectSettingsTab'
import { LateOutgoingTransfers } from '@/components/Project/LateOutgoingTransfers'
import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { confirmLateJoinReceipt, markReceived } from './actions'

type LateTransferRow = {
  id: string
  project_id: string
  from_participant_id: string
  to_participant_id: string
  expected_cents: number
  received_at: string | null
  sender_marked_at: string | null
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

const missingColumn = (error: { message?: string } | null, column: string) => {
  const msg = error?.message?.toLowerCase() ?? ''
  return msg.includes('does not exist') && msg.includes(column.toLowerCase())
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
    supabase
      .from('polls')
      .select('id, title, description, extra_cents, required_votes, created_by')
      .eq('project_id', projectId)
    ,
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
  const participantName = (p: { users?: { email?: string | null; display_name?: string | null } | null; short_code?: string | null }) => {
    const displayName = p.users?.display_name ?? null
    if (displayName) return displayName
    const masked = maskEmail(p.users?.email ?? null)
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
  const allOptions = new Map<string, Array<{ label: string | null, value: string, type: string, priority: number }>>()
  
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
  const viewerIsOrganizer = myParticipantRole === 'organizer'
  const shouldLoadPendingRequests = viewerIsOrganizer || viewerIsCollector
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
  console.log('[ProjectPage] Pending requests for organizer:', { count: pendingForOrganizer?.length ?? 0, requests: pendingForOrganizer })
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
    required_votes: poll.required_votes,
    options: poll.options,
    can_edit: !!uid && (poll.created_by === uid || viewerIsCollector),
  }))
  
  // Get collector options from payment_options (project-specific)
  let collectorOptions =
    collectorId
      ? (paymentOptions ?? []).filter(po => po.participant_id === collectorId && po.is_active !== false)
      : []
  
  // Fallback to user_payment_options if no project-specific options found
  // This handles cases where collector updated their payment options in Settings after joining
  if (collectorOptions.length === 0 && collectorParticipant?.user_id) {
    const { data: userPaymentOptions, error: userOptsError } = await supabaseAdmin
      .from('user_payment_options')
      .select('type, label, value, priority, is_active')
      .eq('user_id', collectorParticipant.user_id)
      .eq('is_active', true)
      .order('priority', { ascending: true })
    
    if (userOptsError) {
      console.error('[ProjectPage] Error fetching collector user_payment_options:', userOptsError)
    }
    
    collectorOptions = (userPaymentOptions ?? []).map(opt => ({
      label: opt.label,
      value: opt.value,
      type: opt.type,
      priority: opt.priority ?? 999,
      is_active: opt.is_active !== false,
    }))
  }
  
  // Count active organizers
  const organizerCount = participantsClean.filter(p => p.role === 'organizer').length
  const isOnlyOrganizer = myParticipantRole === 'organizer' && organizerCount === 1
  
  console.log('[ProjectPage] Organizer check:', { 
    myParticipantRole, 
    myParticipantId, 
    organizerId, 
    organizerFound: organizer?.id,
    isMeOrganizer: myParticipantRole === 'organizer',
    organizerCount,
    isOnlyOrganizer,
    pendingRequestsCount: pendingForOrganizer?.length ?? 0
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

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            {project.title}
            {isAborted && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-600 text-white">Aborted</span>
            )}
          </h1>
          {project.description && (
            <div className="text-sm opacity-70 mt-2">{project.description}</div>
          )}
          {(eventStartLocale || eventEndLocale) && (
            <div className={`text-sm text-slate-600 ${project.description ? 'mt-1' : 'mt-2'}`}>
              {eventStartLocale && eventEndLocale
                ? `Event: ${eventStartLocale} – ${eventEndLocale}`
                : eventStartLocale
                  ? `Event starts: ${eventStartLocale}`
                  : `Event ends: ${eventEndLocale}`}
            </div>
          )}
        </div>
        {isClosedStatus ? (
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded bg-black text-white text-sm">Finalized</span>
            {!isMemberActive && !isAborted ? (
              <JoinButton projectId={projectId} canJoinNow={canJoinNow} requestStatus={myJoinRequestStatus} />
            ) : null}
          </div>
        ) : isMemberActive && !viewerIsCollector && !isFinalized && !isAborted ? (
          <div className="flex items-center gap-2">
            <LeaveProjectButton projectId={projectId} isOnlyOrganizer={isOnlyOrganizer} />
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
          paymentsPending: pendingPaymentsCount || undefined,
        }}
        sections={{
          overview: (
            <div className="space-y-6">
              <SummaryCards
                totalCents={totalCents}
                minParticipants={project.min_participants as number | null}
                participantsNow={participantsNow}
                scenarios={scenarios}
                maxParticipants={project.max_participants as number | null}
                collectorLabel={collectorLabel}
                lateSummary={
                  lateJoinersCount > 0
                    ? {
                        joinersCount: lateJoinersCount,
                        pendingCount: lateTransfersPendingCount,
                        pendingCents: lateTransfersPendingCents,
                      }
                    : null
                }
              />
            </div>
          ),
          profile: <ProfileTab projectId={projectId} />,
          participants: (
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
              collectorOptions={collectorOptions}
              pendingSignalsSet={pendingSignalsSet}
              transfers={lateTransferRows}
              closedAt={closedAt}
              projectStatus={project.status}
            />
          ),
          payments: (
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
                      {`Collected ${formatEuro(collectedCentsDisplay)} out of ${formatEuro(totalCents)}`}
                    </div>
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
                  const hasAny = incomingStandard.length > 0 || incomingLate.length > 0
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
                          <form action={markReceived.bind(null, p.id)}>
                            <button className="px-3 py-1.5 rounded border text-xs" type="submit">
                              {pendingSignalsSet.has(p.id) ? 'Confirm received' : 'Mark received'}
                            </button>
                          </form>
                        </div>
                      ))}
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
                  isFinalized && lateOutgoingTransfers.length > 0 ? (
                    <LateOutgoingTransfers
                      transfers={lateOutgoingTransfers}
                      participants={participantsClean}
                      allOptions={allOptionsEntries}
                      viewerParticipantId={myParticipantId}
                      projectCanceled={isAborted}
                    />
                  ) : !viewerPaid ? (
                    <div className="divide-y">
                      <OutgoingTransfer
                        collectorName={collectorName}
                        amountLabel={formatEuro(perPersonCents)}
                        collectorOptions={collectorOptions}
                        participantId={myParticipantId}
                        viewerPaid={viewerPaid}
                        viewerHasPendingSignal={viewerHasPendingSignal}
                        projectCanceled={isAborted}
                        canPay={minParticipantsReached}
                      />
                    </div>
                  ) : (
                    <div className="text-sm opacity-70">No outgoing transfers.</div>
                  )
                ) : (
                  <div className="text-sm opacity-70">No outgoing transfers.</div>
                )}
              </section>
            </div>
          ),
          voting: (
            <Voting
              projectId={projectId}
              polls={pollsForVoting}
              projectCanceled={isAborted}
              canVote={isMemberActive}
              userVotes={userVotes}
            />
          ),
          settings: viewerIsCollector ? <ProjectSettingsTab projectId={projectId} /> : null,
          activity: (
            <Chat
              projectId={projectId}
              messages={messages ?? []}
              userDisplayMap={userDisplayMap}
              canRead={isMeParticipant}
            />
          ),
          admin: viewerIsCollector ? (
            <AdminPanel
              projectId={projectId}
              participants={participantsClean}
              collectorId={collectorId}
              myParticipantId={myParticipantId}
              pendingRequests={pendingForOrganizer ?? []}
              pendingCount={viewerIsOrganizer ? (pendingForOrganizer ?? []).length : 0}
              isOrganizer={viewerIsOrganizer}
              canFinalize={isCollectingStatus && !isAborted}
              canCancel={!isAborted && !isFinalized}
            />
          ) : null,
        }}
      />
    </main>
  )
}
