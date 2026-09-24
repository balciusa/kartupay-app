import { deriveProjectSuccessPath } from '@/lib/projectSuccessPath'
import { ProjectSuccessOverview } from '@/components/Project/ProjectSuccessOverview'
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
import { LocationLinkMenu } from '@/components/Project/LocationLinkMenu'
import { ProjectFlowBar } from '@/components/Project/ProjectFlowBar'
import { BaseItineraryEditor } from '@/components/Project/BaseItineraryEditor'
import { ProjectDateFinder } from '@/components/Project/ProjectDateFinder'
import { getActivityCategory } from '@/lib/activityLog'
import { buildExtraDueRows, extraDueKey } from '@/lib/extraPayments'
import { calculateProjectPricing, describeBundlePricing } from '@/lib/projectPricing'
import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadProjectDateFinderData } from '@/lib/projectDateService'
import { resolveProjectDateLocale } from '@/lib/projectDateStrings'
import { canManageProjectJoinRequests } from '@/lib/projectJoinRequests'
import { getProjectReadiness, normalizeProjectFinanceMode, type ProjectFinanceMode } from '@/lib/projectFinance'
import { headers } from 'next/headers'
import {
  approveParticipantRefund,
  confirmParticipantRefundReceived,
  confirmLateJoinReceipt,
  markParticipantRefundSent,
  markCollectorSelfPaid,
  markExtraCollectorSelfPaid,
  markExtraReceived,
  markReceived,
  rejectParticipantRefund,
  requestParticipantRefund,
  selfReportExtraPaid,
} from './actions'

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

type RefundRequestRow = {
  id: string
  project_id: string
  participant_id: string
  collector_participant_id: string
  requested_by_participant_id: string
  base_amount_cents: number
  extras_amount_cents: number
  total_amount_cents: number
  status: string
  requested_at: string
  decided_at: string | null
  decided_by_participant_id: string | null
  collector_marked_sent_at: string | null
  participant_confirmed_at: string | null
  completed_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

type BaseItineraryItemRow = {
  id: string
  project_id: string
  title: string
  amount_cents: number
  sort_order: number
  created_at: string
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

type ProjectRow = {
  [key: string]: unknown
  id: string
  title: string
  description: string | null
  total_cents: number | null
  total_is_per_person: boolean | null
  min_participants: number | null
  max_participants: number | null
  status: string | null
  canceled_at: string | null
  collector_participant_id: string | null
  event_start_at: string | null
  event_end_at: string | null
  date_mode?: 'fixed' | 'selecting'
  date_voting_deadline_at?: string | null
  date_suggestions_close_at?: string | null
  date_selection_status?: string | null
  selected_date_option_id?: string | null
  confirmation_deadline_at?: string | null
  finance_mode?: ProjectFinanceMode | null
  is_public?: boolean | null
  closed_at?: string | null
  aborted_at?: string | null
  finalized_at?: string | null
  bundle_size?: number | null
  bundle_pay_for?: number | null
  event_location_label?: string | null
  event_location_address?: string | null
  event_location_lat?: number | null
  event_location_lng?: number | null
  event_location_place_id?: string | null
}

type ProjectTabKey =
  | 'overview'
  | 'people'
  | 'participants'
  | 'payments'
  | 'activity'
  | 'profile'
  | 'voting'
  | 'extras'
  | 'settings'
  | 'admin'

const getSingleQueryParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

const resolveProjectTab = (value: string | undefined): ProjectTabKey => {
  const normalized = String(value ?? '').trim().toLowerCase()
  switch (normalized) {
    case 'people':
    case 'participants':
    case 'payments':
    case 'activity':
    case 'profile':
    case 'voting':
    case 'extras':
    case 'settings':
    case 'admin':
      return normalized
    case 'overview':
    default:
      return 'overview'
  }
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
  params: Promise<{ id?: string }>
  searchParams?:
    Promise<{ id?: string | string[]; tab?: string | string[]; adminModal?: string | string[] }>
}) {
  const resolvedParams = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const pathId = Array.isArray(resolvedParams?.id) ? resolvedParams?.id?.[0] : resolvedParams?.id
  const queryId = resolvedSearchParams ? getSingleQueryParam(resolvedSearchParams.id) : undefined
  const queryTab = resolvedSearchParams ? getSingleQueryParam(resolvedSearchParams.tab) : undefined
  const queryAdminModal = resolvedSearchParams ? getSingleQueryParam(resolvedSearchParams.adminModal) : undefined
  const adminModalKey = String(queryAdminModal ?? '').trim().toLowerCase()
  const defaultProjectTab = resolveProjectTab(queryTab)
  const openRequestsOnLoad = defaultProjectTab === 'admin' && adminModalKey === 'requests'
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
  const optionalProjectFields = [
    'is_public',
    'closed_at',
    'aborted_at',
    'finalized_at',
    'bundle_size',
    'bundle_pay_for',
    'event_location_label',
    'event_location_address',
    'event_location_lat',
    'event_location_lng',
    'event_location_place_id',
    'date_mode',
    'date_voting_deadline_at',
    'date_suggestions_close_at',
    'date_selection_status',
    'selected_date_option_id',
    'confirmation_deadline_at',
    'finance_mode',
  ] as const
  let optionalFields = [...optionalProjectFields]
  const missingFields = new Set<string>()
  let project: ProjectRow | null = null
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
        project = fallback.data as ProjectRow | null
        projectError = fallback.error
        break
      }
      continue
    }

    project = data as ProjectRow | null
    projectError = error
    break
  }

  if (project && optionalProjectFields.length) {
    const projectRecord = project as Record<string, unknown>
    for (const field of optionalProjectFields) {
      if (missingFields.has(field) || typeof project[field] === 'undefined') {
        projectRecord[field] = field === 'is_public' ? true : null
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

  const financeMode = normalizeProjectFinanceMode(project.finance_mode)
  const financeManaged = financeMode === 'managed'

  const isPendingStatus = project.status === 'pending'
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
  const eventLocationLabel = (project.event_location_label as string | null) ?? null
  const eventLocationAddress = (project.event_location_address as string | null) ?? null
  const eventLocationPlaceId = (project.event_location_place_id as string | null) ?? null
  const parsedLocationLat = Number(project.event_location_lat ?? NaN)
  const parsedLocationLng = Number(project.event_location_lng ?? NaN)
  const hasLocationCoordinates = Number.isFinite(parsedLocationLat) && Number.isFinite(parsedLocationLng)
  const eventLocationTitle = eventLocationLabel || 'Event location'
  const hasEventLocation = !!(eventLocationLabel || eventLocationAddress || hasLocationCoordinates)
  const eventLocationQuery = hasLocationCoordinates
    ? `${parsedLocationLat},${parsedLocationLng}`
    : (eventLocationAddress || eventLocationLabel || '')
  const encodedEventLocationQuery = encodeURIComponent(eventLocationQuery)
  const googleMapsUrl = eventLocationQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodedEventLocationQuery}${
        eventLocationPlaceId ? `&query_place_id=${encodeURIComponent(eventLocationPlaceId)}` : ''
      }`
    : null
  const wazeUrl = hasLocationCoordinates
    ? `https://waze.com/ul?ll=${encodeURIComponent(`${parsedLocationLat},${parsedLocationLng}`)}&navigate=yes`
    : eventLocationQuery
      ? `https://waze.com/ul?q=${encodedEventLocationQuery}&navigate=yes`
      : null
  const appleMapsUrl = hasLocationCoordinates
    ? `https://maps.apple.com/?ll=${encodeURIComponent(`${parsedLocationLat},${parsedLocationLng}`)}${
        eventLocationTitle ? `&q=${encodeURIComponent(eventLocationTitle)}` : ''
      }`
    : eventLocationQuery
      ? `https://maps.apple.com/?q=${encodedEventLocationQuery}`
      : null

  const uid = await getCurrentUserId()
  const requestHeaders = await headers()
  const projectDateLocale = resolveProjectDateLocale(requestHeaders.get('accept-language'))

  if (project.is_public !== true) {
    if (!uid) {
      return (
        <main className="p-6 max-w-2xl mx-auto space-y-4">
          <h1 className="text-xl font-semibold">Private project</h1>
          <p className="text-sm opacity-70">
            This project is private. Sign in with a member account to view it.
          </p>
        </main>
      )
    }

    const { data: privateMembership, error: privateMembershipError } = await supabaseAdmin
      .from('participants')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', uid)
      .limit(1)

    if (privateMembershipError) {
      console.error('[ProjectPage] private membership check error', privateMembershipError)
      return (
        <main className="p-6 max-w-2xl mx-auto space-y-4">
          <h1 className="text-xl font-semibold">Project unavailable</h1>
          <p className="text-sm opacity-70">
            The privacy check failed while opening this project.
          </p>
        </main>
      )
    }

    if (!privateMembership?.length) {
      return (
        <main className="p-6 max-w-2xl mx-auto space-y-4">
          <h1 className="text-xl font-semibold">Private project</h1>
          <p className="text-sm opacity-70">
            This project is only visible to the creator and members who already joined it.
          </p>
        </main>
      )
    }
  }

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

  const baseItineraryPromise = (async (): Promise<{ available: boolean; items: BaseItineraryItemRow[] }> => {
    if (!financeManaged) return { available: false, items: [] }
    const { data, error } = await supabaseAdmin
      .from('project_base_itinerary_items')
      .select('id, project_id, title, amount_cents, sort_order, created_at')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      if (missingTable(error, 'project_base_itinerary_items')) {
        console.warn('[ProjectPage] project_base_itinerary_items table missing, skipping base itinerary')
        return { available: false, items: [] }
      }
      console.error('[ProjectPage] base itinerary fetch error', error)
      return { available: true, items: [] }
    }

    return { available: true, items: (data ?? []) as BaseItineraryItemRow[] }
  })()

  const participantsPromise = (async () => {
    const withAttendance = await supabase
      .from('participants')
      .select('id, user_id, role, short_code, joined_at, attendance_status, users(email, display_name)')
      .eq('project_id', projectId)
      .is('left_at', null)
      .order('joined_at', { ascending: true })
    if (!missingColumn(withAttendance.error, 'attendance_status')) return withAttendance
    const fallback = await supabase
      .from('participants')
      .select('id, user_id, role, short_code, joined_at, users(email, display_name)')
      .eq('project_id', projectId)
      .is('left_at', null)
      .order('joined_at', { ascending: true })
    return {
      ...fallback,
      data: (fallback.data ?? []).map(participant => ({ ...participant, attendance_status: 'confirmed' })),
    }
  })()

  const projectDateDataPromise = loadProjectDateFinderData(projectId, uid)

  const [
    { data: participants },
    { data: messages },
    { data: polls },
    { data: allPayments },
    { data: myJoinRequest }
  ] = await Promise.all([
    participantsPromise,
    supabase
      .from('messages')
      .select('id, project_id, user_id, author_user_id, parent_id, body, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    pollsPromise,
    financeManaged
      ? supabase.from('payments').select('participant_id, is_counted, created_at')
      : Promise.resolve({ data: [] as Array<{ participant_id: string; is_counted: boolean; created_at: string }> }),
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
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
    : { data: [] as Array<{ id: string; poll_id: string; label: string }> }
  const { data: pollVotes } = pollIds.length
    ? await supabase
        .from('poll_votes')
        .select('poll_id, option_id, user_id')
        .in('poll_id', pollIds)
    : { data: [] as Array<{ poll_id: string; option_id: string; user_id: string }> }
  const projectDateData = await projectDateDataPromise
  const extrasRaw = await extrasPromise
  const { available: baseItineraryAvailable, items: baseItineraryRaw } = await baseItineraryPromise
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
  if (financeManaged && extraIds.length) {
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
  let refundRequestsAvailable = true
  let refundRequestRows: RefundRequestRow[] = []
  const { data: rawRefundRequests, error: refundRequestsErr } = financeManaged
    ? await supabaseAdmin
        .from('participant_refund_requests')
        .select(
          'id, project_id, participant_id, collector_participant_id, requested_by_participant_id, base_amount_cents, extras_amount_cents, total_amount_cents, status, requested_at, decided_at, decided_by_participant_id, collector_marked_sent_at, participant_confirmed_at, completed_at, rejection_reason, created_at, updated_at'
        )
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
    : { data: [] as RefundRequestRow[], error: null }
  if (refundRequestsErr) {
    if (missingTable(refundRequestsErr, 'participant_refund_requests')) {
      refundRequestsAvailable = false
      console.warn('[ProjectPage] participant_refund_requests table missing, skipping refund workflow')
    } else {
      console.error('[ProjectPage] refund requests fetch error', refundRequestsErr)
    }
  } else {
    refundRequestRows = (rawRefundRequests ?? []) as RefundRequestRow[]
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

  const lateTransfersResult = financeManaged
    ? await supabase
        .from('late_join_transfers')
        .select('id, project_id, from_participant_id, to_participant_id, expected_cents, received_at, sender_marked_at')
        .eq('project_id', projectId)
    : { data: [] as LateTransferRow[], error: null }
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
  const { data: paymentOptions, error: pmErr } = financeManaged && participantIdsArr.length
    ? await supabase
        .from('payment_options')
        .select('*')
        .in('participant_id', participantIdsArr)
    : { data: [], error: null as { message?: string } | null }
  if (pmErr) throw pmErr

  let pendingSignalsSet = new Set<string>()
  if (financeManaged && participantIdsArr.length) {
    const { data: pendingSignals, error: sigErr } = await supabaseAdmin
      .from('payment_signals')
      .select('participant_id, cleared_at')
      .in('participant_id', participantIdsArr)
      .is('cleared_at', null)

    if (sigErr) {
      const code = sigErr.code
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

  const participantsClean = (rawParticipants ?? []).map(participant => ({
    ...participant,
    users: Array.isArray(participant.users) ? participant.users[0] ?? null : participant.users ?? null,
  }))
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
  const membersCount = participantsClean.length
  const financialParticipants = projectDateData
    ? participantsClean.filter(participant => participant.attendance_status === 'confirmed')
    : participantsClean
  const participantsCount = financialParticipants.length
  const minParticipants = project.min_participants as number | null
  const maxParticipants = project.max_participants as number | null
  const finalizedAt = (project.finalized_at as string | null) ?? (project.closed_at as string | null) ?? null
  const finalizedAtDate = finalizedAt ? new Date(finalizedAt) : null
  const baseParticipants = finalizedAtDate
    ? financialParticipants.filter(p => !p.joined_at || new Date(p.joined_at) <= finalizedAtDate)
    : financialParticipants
  const baseParticipantIds = new Set(baseParticipants.map(p => p.id))
  const baseParticipantsCount = baseParticipants.length
  const projectReadiness = getProjectReadiness({
    financeMode: project.finance_mode,
    confirmedParticipants: participantsCount,
    minParticipants,
    managedFinanceReady: false,
  })
  const minParticipantsReached = projectReadiness.participationReady
  const capacityParticipantCount = project.date_mode === 'selecting' ? membersCount : participantsCount
  const canJoinNow =
    (financeManaged ? isCollectingStatus : !isFinalized) &&
    !isAborted &&
    (!maxParticipants || capacityParticipantCount < maxParticipants)
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
  const pricingNow = calculateProjectPricing({
    totalCents: storedTotalCents,
    totalIsPerPerson,
    participantCount: participantsCount,
    bundleSize: project.bundle_size ?? null,
    bundlePayFor: project.bundle_pay_for ?? null,
  })
  const pricingAtFinalize = calculateProjectPricing({
    totalCents: storedTotalCents,
    totalIsPerPerson,
    participantCount: baseParticipantsCount,
    bundleSize: project.bundle_size ?? null,
    bundlePayFor: project.bundle_pay_for ?? null,
  })
  const pricingPlus1 = calculateProjectPricing({
    totalCents: storedTotalCents,
    totalIsPerPerson,
    participantCount: participantsCount + 1,
    bundleSize: project.bundle_size ?? null,
    bundlePayFor: project.bundle_pay_for ?? null,
  })
  const pricingPlus2 = calculateProjectPricing({
    totalCents: storedTotalCents,
    totalIsPerPerson,
    participantCount: participantsCount + 2,
    bundleSize: project.bundle_size ?? null,
    bundlePayFor: project.bundle_pay_for ?? null,
  })
  const perPersonCents = pricingNow.perPersonCents
  const perPersonCentsAtFinalize = pricingAtFinalize.perPersonCents
  const totalCents = pricingNow.totalCents
  const participantsNow = participantsCount
  const dateSelectionBlocksPayments = projectDateData?.dateMode === 'selecting'
  const paymentsOpen = !isPendingStatus
  const viewerPaid = !!(myParticipantId && paidSet.has(myParticipantId))
  const viewerHasPendingSignal = !!(myParticipantId && pendingSignalsSet.has(myParticipantId))
  const formatEuro = (cents: number) => `?${(cents / 100).toFixed(2)}`
  const bundleLabel = describeBundlePricing(pricingNow.bundleSize, pricingNow.bundlePayFor)
  const scenarios = {
    now: pricingNow.perPersonCents,
    plus1: pricingPlus1.perPersonCents,
    plus2: pricingPlus2.perPersonCents,
  }
  const baseItineraryItems = baseItineraryRaw.map(item => ({
    ...item,
    amount_cents: Number(item.amount_cents ?? 0),
  }))
  const baseItineraryTotalCents = baseItineraryItems.reduce((sum, item) => sum + item.amount_cents, 0)

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
  const viewerCanManageJoinRequests = canManageProjectJoinRequests({
    participantId: myParticipantId,
    participantRole: myParticipantRole,
    collectorParticipantId: collectorId,
  })
  const collectorIsCountedPaid = !!(collectorId && paidIds.includes(collectorId))
  const shouldLoadPendingRequests = viewerCanManageJoinRequests
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
  console.log('[ProjectPage] Pending join requests for manager:', { count: pendingForOrganizer?.length ?? 0, requests: pendingForOrganizer })
  const basePaidIds = countedPayments
    .filter(p => baseParticipantIds.has(p.participant_id))
    .map(p => p.participant_id)
  const basePaidSet = new Set(basePaidIds)
  const collectedCentsDisplay = Math.min(perPersonCentsAtFinalize * basePaidSet.size, pricingAtFinalize.totalCents)
  const lateJoinerIds = new Set(
    finalizedAtDate
      ? financialParticipants
          .filter(p => p.joined_at && new Date(p.joined_at) > finalizedAtDate)
          .map(p => p.id)
      : []
  )
  const lateOutgoingPendingIds = new Set(
    lateTransfers.filter(t => !t.received_at).map(t => t.from_participant_id)
  )
  const lateJoinersCount = lateJoinerIds.size
  const lateTransfersPendingCount = lateTransfers.filter(t => !t.received_at).length
  const lateTransfersPendingCents = lateTransfers
    .filter(t => !t.received_at)
    .reduce((sum, t) => sum + t.expected_cents, 0)
  const settledIds = new Set<string>(basePaidSet)
  for (const id of lateOutgoingPendingIds) {
    settledIds.delete(id)
  }
  for (const id of lateJoinerIds) {
    if (!lateOutgoingPendingIds.has(id)) settledIds.add(id)
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
  const financialParticipantIds = new Set(financialParticipants.map(participant => participant.id))
  const pendingSignalCount = viewerIsCollector
    ? Array.from(pendingSignalsSet).filter(participantId => financialParticipantIds.has(participantId)).length
    : 0
  const pendingLateConfirmations = myParticipantId
    ? lateTransfers.filter(t => t.to_participant_id === myParticipantId && t.sender_marked_at && !t.received_at).length
    : 0
  const outgoingPayAvailable =
    !viewerIsCollector &&
    !isAborted &&
    minParticipantsReached &&
    !!myParticipantId &&
    financialParticipantIds.has(myParticipantId) &&
    !!collectorId &&
    !viewerPaid &&
    !viewerHasPendingSignal
  const lateOutgoingDueCount = lateOutgoingTransfers.filter(t => !t.received_at).length
  const outgoingPaymentsDueCount =
    lateOutgoingDueCount +
    (!isFinalized && outgoingPayAvailable ? 1 : 0)
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
    const viewerDeclined = !!(myParticipantId && (extraMembershipRows ?? []).some(
      membership => membership.extra_id === extra.id && membership.participant_id === myParticipantId && !!membership.left_at
    ))
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
      viewer_declined: viewerDeclined,
      viewer_share_cents: viewerJoined ? perMemberShare : null,
      created_by_label: createdByLabel,
      created_at: extra.created_at,
      can_manage: !!uid && (extra.created_by === uid || viewerIsCollector),
    }
  })
  const activeParticipantIds = new Set(financialParticipants.map(p => p.id))
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
    return sum + (row.confirmed ? row.amount_cents : 0)
  }, 0)
  const extraGrandTotalTargetCents = extraDueWithStatus
    .filter(row => !row.amount_is_per_person)
    .reduce((sum, row) => sum + row.amount_cents, 0)
  const extraGrandTotalCollectedCents = extraDueWithStatus
    .filter(row => !row.amount_is_per_person)
    .reduce((sum, row) => {
      return sum + (row.confirmed ? row.amount_cents : 0)
    }, 0)
  const extraPerPersonTargetCents = extraDueWithStatus
    .filter(row => row.amount_is_per_person)
    .reduce((sum, row) => sum + row.amount_cents, 0)
  const extraPerPersonCollectedCents = extraDueWithStatus
    .filter(row => row.amount_is_per_person)
    .reduce((sum, row) => {
      return sum + (row.confirmed ? row.amount_cents : 0)
    }, 0)
  const extraDueSummaryById = new Map<string, { targetCents: number; collectedCents: number }>()
  for (const row of extraDueWithStatus) {
    const summary = extraDueSummaryById.get(row.extra_id) ?? { targetCents: 0, collectedCents: 0 }
    summary.targetCents += row.amount_cents
    if (row.confirmed) summary.collectedCents += row.amount_cents
    extraDueSummaryById.set(row.extra_id, summary)
  }
  const extraBreakdownRows = extrasForTab.map(extra => {
    const summary = extraDueSummaryById.get(extra.id)
    return {
      id: extra.id,
      title: extra.title,
      amount_cents: extra.amount_cents,
      amount_is_per_person: extra.amount_is_per_person,
      member_count: extra.member_count,
      target_cents: summary?.targetCents ?? 0,
      collected_cents: summary?.collectedCents ?? 0,
    }
  })
  const extraIncomingForViewer = myParticipantId
    ? extraDueWithStatus.filter(
        row =>
          row.collector_participant_id === myParticipantId &&
          row.payer_participant_id !== myParticipantId &&
          !row.confirmed
      )
    : []
  const extraOutgoingForViewer = myParticipantId
    ? extraDueWithStatus.filter(
        row =>
          row.payer_participant_id === myParticipantId &&
          row.collector_participant_id !== myParticipantId &&
          !row.confirmed
      )
    : []
  const extraSelfMarkRowsForViewer = myParticipantId
    ? extraDueWithStatus.filter(
        row =>
          row.payer_participant_id === myParticipantId &&
          row.collector_participant_id === myParticipantId &&
          !row.confirmed
      )
    : []
  const pendingExtraCollectorCount = extraIncomingForViewer.length
  const pendingExtraOutgoingCount = extraOutgoingForViewer.length
  const pendingExtraSelfMarkCount = extraSelfMarkRowsForViewer.length
  const myLatestRefundRequest = myParticipantId
    ? refundRequestRows.find(row => row.participant_id === myParticipantId) ?? null
    : null
  const collectorRefundRequests = viewerIsCollector
    ? refundRequestRows.filter(
        row => row.status === 'pending' || row.status === 'approved' || row.status === 'sent'
      )
    : []
  const myBaseRefundableCents = myParticipantId && basePaidSet.has(myParticipantId) ? perPersonCents : 0
  const myExtrasRefundableCents = myParticipantId
    ? extraPaymentRows
        .filter(
          row =>
            row.payer_participant_id === myParticipantId &&
            !!row.confirmed_at &&
            row.collector_participant_id !== myParticipantId
        )
        .reduce((sum, row) => sum + Math.max(0, Number(row.amount_cents ?? 0)), 0)
    : 0
  const myRefundEligibleTotalCents = myBaseRefundableCents + myExtrasRefundableCents
  const showMyRefundSection =
    !!myParticipantId &&
    isMeParticipant &&
    !viewerIsCollector &&
    !isFinalized &&
    !isAborted &&
    (myRefundEligibleTotalCents > 0 || !!myLatestRefundRequest)
  const showCollectorRefundSection = viewerIsCollector && !isAborted && collectorRefundRequests.length > 0
  const pendingRefundApprovalCount = viewerIsCollector
    ? collectorRefundRequests.filter(row => row.status === 'pending').length
    : 0
  const pendingRefundReceiptCount =
    !viewerIsCollector && myLatestRefundRequest?.status === 'sent' ? 1 : 0
  const pendingPaymentsCountWithExtras =
    pendingPaymentsCount +
    pendingExtraCollectorCount +
    pendingExtraOutgoingCount +
    pendingExtraSelfMarkCount +
    pendingRefundApprovalCount +
    pendingRefundReceiptCount
  const totalCentsWithExtras = totalCents + extraTargetCents
  const collectedCentsWithExtras = collectedCentsDisplay + extraCollectedCents
  const collectedCentsWithExtrasClamped =
    totalCentsWithExtras > 0 ? Math.min(collectedCentsWithExtras, totalCentsWithExtras) : collectedCentsWithExtras
  const paymentsProgressPercent =
    totalCentsWithExtras > 0
      ? Math.min(100, Math.round((collectedCentsWithExtrasClamped / totalCentsWithExtras) * 100))
      : 0
  const settledPercent =
    participantsCount > 0 ? Math.min(100, Math.round((effectivePaidCount / participantsCount) * 100)) : 0
  const hasLatePaymentSummaries = lateIncomingPendingCents > 0 || lateOutgoingPendingCents > 0
  const lateSummariesGridCols =
    lateIncomingPendingCents > 0 && lateOutgoingPendingCents > 0 ? 'md:grid-cols-2' : 'md:grid-cols-1'
  
  // Get collector options from payment_options (project-specific)
  let collectorPaymentOptions =
    collectorId
      ? (paymentOptions ?? []).filter(po => po.participant_id === collectorId && po.is_active !== false)
      : []
  
  // Fallback to user_payment_options if no project-specific options found
  // This handles cases where collector updated their payment options in Settings after joining
  if (financeManaged && collectorPaymentOptions.length === 0 && collectorParticipant?.user_id) {
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

  const successPath = deriveProjectSuccessPath({
    isCanceled: isAborted,
    isFinalized,
    financeMode,
    confirmedParticipants: projectDateData?.confirmedCount ?? participantsCount,
    minParticipants,
    capacityAvailable: !maxParticipants || capacityParticipantCount < maxParticipants,
    joinsAllowed: !isAborted && !isFinalized,
    // Existing base settlement indicator; optional Extras never gate readiness.
    managedFinanceReady: totalCents === 0 || (participantsCount > 0 && effectivePaidCount === participantsCount),
    date: {
      selecting: (projectDateData?.dateMode ?? project.date_mode) === 'selecting',
      votingOpen: projectDateData?.dateMode === 'selecting' && projectDateData.selectionStatus === 'open',
      hasOptions: !!projectDateData?.options.some(option => option.status === 'active'),
      awaitingOrganizer: projectDateData?.selectionStatus === 'awaiting_organizer_decision',
      viewerResponded: projectDateData?.viewerTaskComplete ?? false,
      viewerNeedsConfirmation: projectDateData?.viewerAttendanceStatus === 'awaiting_confirmation'
        && projectDateData.selectionStatus === 'confirmation_open',
      missingResponses: Math.max(0, (projectDateData?.memberCount ?? 0) - (projectDateData?.respondedCount ?? 0)),
      awaitingAttendance: projectDateData?.awaitingCount ?? 0,
    },
  }, {
    isParticipant: isMeParticipant,
    canManage: viewerIsCollector,
    canPay: isMeParticipant && financialParticipantIds.has(myParticipantId ?? '')
      && paymentsOpen && minParticipantsReached && !dateSelectionBlocksPayments
      && !viewerPaid && !viewerHasPendingSignal && perPersonCents > 0,
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
            activityParticipantsById.set(participant.id, {
              ...participant,
              attendance_status: 'confirmed',
              users: Array.isArray(participant.users) ? participant.users[0] ?? null : participant.users ?? null,
            })
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
          case 'date_option_suggested':
            message = `${actorLabel} suggested a project date`
            break
          case 'date_option_removed':
            message = `${actorLabel} removed a project date option`
            break
          case 'date_response_updated':
            message = `${actorLabel} updated date availability`
            break
          case 'project_date_selected':
            message = `${actorLabel} confirmed the project date`
            break
          case 'date_confirmation_updated':
            message = `${actorLabel} updated attendance confirmation`
            break
          case 'date_reminder_sent':
            message = `${actorLabel} sent a date reminder`
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
          case 'refund_requested':
            message = `${actorLabel} requested a refund`
            break
          case 'refund_approved':
            message = `${actorLabel} approved a refund request${row.target_participant_id ? ` for ${targetLabel}` : ''}`
            break
          case 'refund_rejected':
            message = `${actorLabel} rejected a refund request${row.target_participant_id ? ` for ${targetLabel}` : ''}`
            break
          case 'refund_sent':
            message = `${actorLabel} marked a refund as sent${row.target_participant_id ? ` to ${targetLabel}` : ''}`
            break
          case 'refund_completed':
            message = `${actorLabel} confirmed refund receipt`
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
      <section className="relative rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_45%),linear-gradient(to_bottom,#ffffff,#f8fafc)] p-5 md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-3">
            <h1 className="break-words text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">{project.title}</h1>
            {project.description && (
              <div className="max-w-2xl text-sm text-slate-600 md:text-base">{project.description}</div>
            )}
            {(eventStartLocale || eventEndLocale || hasEventLocation) && (
              <div className="flex flex-wrap items-center gap-2">
                {(eventStartLocale || eventEndLocale) && (
                  <div className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-sm text-slate-700">
                    {eventStartLocale && eventEndLocale
                      ? `Event window: ${eventStartLocale} - ${eventEndLocale}`
                      : eventStartLocale
                        ? `Event starts: ${eventStartLocale}`
                        : `Event ends: ${eventEndLocale}`}
                  </div>
                )}

                {hasEventLocation && (
                  <LocationLinkMenu
                    label={eventLocationTitle}
                    address={eventLocationAddress}
                    googleMapsUrl={googleMapsUrl}
                    wazeUrl={wazeUrl}
                    appleMapsUrl={appleMapsUrl}
                  />
                )}
              </div>
            )}
          </div>
          <div className="flex items-start gap-2 md:items-center">
            {isClosedStatus ? (
              !isMemberActive && !isAborted ? (
                <div className="flex items-center gap-2">
                  <JoinButton
                    projectId={projectId}
                    canJoinNow={canJoinNow}
                    requestStatus={myJoinRequestStatus}
                    locale={projectDateLocale}
                  />
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
                  locale={projectDateLocale}
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
        defaultTab={defaultProjectTab}
        counts={{
          participants: membersCount,
          activity: unreadCount,
          adminPending: viewerCanManageJoinRequests ? (pendingForOrganizer ?? []).length : 0,
          paymentsPending: financeManaged ? (pendingPaymentsCountWithExtras || undefined) : undefined,
        }}
        sections={{
          overview: (
            <div className="space-y-6">
              <ProjectSuccessOverview model={successPath} projectId={projectId} locale={projectDateLocale} />
              {projectDateData && !isAborted && (
                <div id="project-date-finder" className="scroll-mt-4">
                  <ProjectDateFinder
                    projectId={projectId}
                    data={projectDateData}
                    viewerUserId={uid}
                    viewerIsParticipant={isMeParticipant}
                    canManage={viewerIsCollector}
                    locale={projectDateLocale}
                    dateActionShown={successPath.nextAction === 'choose_dates'}
                  />
                </div>
              )}
              {financeManaged && (
                <SummaryCards
                  totalCents={totalCents}
                  collectedCents={collectedCentsDisplay}
                  totalIsPerPerson={totalIsPerPerson}
                  bundleLabel={bundleLabel}
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
              )}
            </div>
          ),
          profile: <ProfileTab projectId={projectId} financeMode={financeMode} />,
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
                  pendingRequests={viewerCanManageJoinRequests ? (pendingForOrganizer ?? []) : []}
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
                  canPost={!isAborted}
                />
              </section>
            </div>
          ),
          payments: financeManaged ? (
            <div className="space-y-6">
              <ProjectFlowBar
                projectId={projectId}
                status={project.status as string | null | undefined}
                isCanceled={isAborted}
                isFinalized={isFinalized}
                canManage={viewerIsCollector}
                canStartCollecting={isPendingStatus && !isAborted && !dateSelectionBlocksPayments}
                canFinalize={isCollectingStatus && !isAborted}
                startCollectingBlockedReason={
                  isPendingStatus && dateSelectionBlocksPayments
                    ? 'Waiting for a confirmed project date'
                    : isPendingStatus && !minParticipantsReached
                      ? 'Waiting for minimum confirmed participants'
                      : null
                }
                collectorBaseShareLabel={formatEuro(perPersonCents)}
              />

              <section className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-100 p-5 shadow-sm md:p-6">
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-2xl font-semibold leading-none text-teal-700">
                      $
                    </div>
                    <div className="space-y-0.5">
                      <h2 className="text-2xl font-semibold text-slate-900">Payment Progress</h2>
                      <p className="text-sm text-slate-600">Track balances and settle transfers quickly.</p>
                    </div>
                  </div>

                  {isPendingStatus && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
                      Payments are still closed. You can review the base itinerary and projected totals here, but payment
                      actions will unlock after the collector opens payments.
                    </div>
                  )}

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 md:p-5">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="text-3xl font-semibold leading-none text-slate-900">
                        {formatEuro(collectedCentsWithExtrasClamped)} / {formatEuro(totalCentsWithExtras)}
                      </div>
                      <div className="pb-0.5 text-sm text-slate-600 md:text-base">collected</div>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-slate-600 transition-all"
                          style={{ width: `${paymentsProgressPercent}%` }}
                        />
                      </div>
                      <div className="w-12 text-right text-3xl font-medium leading-none text-slate-700">
                        {paymentsProgressPercent}%
                      </div>
                    </div>
                    <div className="mt-4 space-y-2.5">
                      <details className="group rounded-xl border border-slate-200 bg-white/80 [&_summary::-webkit-details-marker]:hidden">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100/70">
                          <span>
                            <span className="font-semibold text-slate-900 underline decoration-dotted underline-offset-2">
                              Base:
                            </span>{' '}
                            {formatEuro(collectedCentsDisplay)} / {formatEuro(totalCents)}
                          </span>
                          <span className="text-xs text-slate-500 group-open:hidden">Show itinerary</span>
                          <span className="hidden text-xs text-slate-500 group-open:inline">Hide itinerary</span>
                        </summary>
                        <div className="border-t border-slate-200 px-3 py-3">
                          {viewerIsCollector ? (
                            <BaseItineraryEditor
                              projectId={projectId}
                              available={baseItineraryAvailable}
                              items={baseItineraryItems}
                              variant="embedded"
                              targetTotalCents={totalCents}
                            />
                          ) : (
                            baseItineraryItems.length === 0 ? (
                              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                                No base itinerary has been published yet.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div className="overflow-x-auto rounded-lg border border-slate-200">
                                  <table className="min-w-full border-collapse text-sm">
                                    <thead>
                                      <tr className="bg-slate-100 text-slate-700">
                                        <th className="w-14 border-b border-r border-slate-200 px-3 py-2 text-left font-semibold">
                                          #
                                        </th>
                                        <th className="border-b border-r border-slate-200 px-3 py-2 text-left font-semibold">
                                          Included in Base
                                        </th>
                                        <th className="w-36 border-b border-slate-200 px-3 py-2 text-right font-semibold">
                                          Price
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {baseItineraryItems.map((item, index) => (
                                        <tr key={item.id} className="bg-white odd:bg-white even:bg-slate-50/60">
                                          <td className="border-b border-r border-slate-200 px-3 py-2 text-slate-600">
                                            {index + 1}
                                          </td>
                                          <td className="border-b border-r border-slate-200 px-3 py-2 font-medium text-slate-900">
                                            {item.title}
                                          </td>
                                          <td className="border-b border-slate-200 px-3 py-2 text-right font-medium text-slate-900">
                                            {formatEuro(item.amount_cents)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="bg-slate-100/80">
                                        <td
                                          className="border-r border-slate-200 px-3 py-2 text-right font-semibold text-slate-700"
                                          colSpan={2}
                                        >
                                          Itinerary total
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                          {formatEuro(baseItineraryTotalCents)}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                                {baseItineraryTotalCents !== totalCents && (
                                  <div className="text-xs text-slate-500">
                                    Note: itinerary total is {formatEuro(baseItineraryTotalCents)}, while base target is{' '}
                                    {formatEuro(totalCents)}.
                                  </div>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </details>
                      {extraBreakdownRows.length > 0 && (
                        <details className="group rounded-xl border border-slate-200 bg-white/80 [&_summary::-webkit-details-marker]:hidden">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100/70">
                            <span>
                              <span className="font-semibold text-slate-900 underline decoration-dotted underline-offset-2">
                                Extras:
                              </span>{' '}
                              {formatEuro(extraCollectedCents)} / {formatEuro(extraTargetCents)}
                            </span>
                            <span className="text-xs text-slate-500 group-open:hidden">Show extras</span>
                            <span className="hidden text-xs text-slate-500 group-open:inline">Hide extras</span>
                          </summary>
                          <div className="border-t border-slate-200 px-3 py-3">
                            <div className="space-y-2">
                              <div className="overflow-x-auto rounded-lg border border-slate-200">
                                <table className="min-w-full border-collapse text-sm">
                                  <thead>
                                    <tr className="bg-slate-100 text-slate-700">
                                      <th className="w-14 border-b border-r border-slate-200 px-3 py-2 text-left font-semibold">
                                        #
                                      </th>
                                      <th className="border-b border-r border-slate-200 px-3 py-2 text-left font-semibold">
                                        Extra
                                      </th>
                                      <th className="w-32 border-b border-r border-slate-200 px-3 py-2 text-left font-semibold">
                                        Type
                                      </th>
                                      <th className="w-24 border-b border-r border-slate-200 px-3 py-2 text-right font-semibold">
                                        Members
                                      </th>
                                      <th className="w-32 border-b border-r border-slate-200 px-3 py-2 text-right font-semibold">
                                        Price
                                      </th>
                                      <th className="w-40 border-b border-slate-200 px-3 py-2 text-right font-semibold">
                                        Collected / Target
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {extraBreakdownRows.map((row, index) => (
                                      <tr key={row.id} className="bg-white odd:bg-white even:bg-slate-50/60">
                                        <td className="border-b border-r border-slate-200 px-3 py-2 text-slate-600">
                                          {index + 1}
                                        </td>
                                        <td className="border-b border-r border-slate-200 px-3 py-2 font-medium text-slate-900">
                                          {row.title}
                                        </td>
                                        <td className="border-b border-r border-slate-200 px-3 py-2 text-slate-700">
                                          {row.amount_is_per_person ? 'Per person' : 'Grand total'}
                                        </td>
                                        <td className="border-b border-r border-slate-200 px-3 py-2 text-right text-slate-700">
                                          {row.member_count}
                                        </td>
                                        <td className="border-b border-r border-slate-200 px-3 py-2 text-right font-medium text-slate-900">
                                          {formatEuro(row.amount_cents)}
                                        </td>
                                        <td className="border-b border-slate-200 px-3 py-2 text-right font-medium text-slate-900">
                                          {formatEuro(row.collected_cents)} / {formatEuro(row.target_cents)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-slate-100/80">
                                      <td
                                        className="border-r border-slate-200 px-3 py-2 text-right font-semibold text-slate-700"
                                        colSpan={5}
                                      >
                                        Extras total
                                      </td>
                                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                        {formatEuro(extraCollectedCents)} / {formatEuro(extraTargetCents)}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                              {extraTargetCents === 0 && (
                                <div className="text-xs text-slate-500">
                                  No extra payments are due yet because no active members are assigned.
                                </div>
                              )}
                            </div>
                          </div>
                        </details>
                      )}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm text-slate-700">
                          <span>Settled participants</span>
                          <span className="font-medium text-slate-900">
                            {effectivePaidCount} / {participantsCount}
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-teal-500/70" style={{ width: `${settledPercent}%` }} />
                        </div>
                      </div>

                      {viewerIsCollector && collectorId && myParticipantId === collectorId && collectorIsCountedPaid && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                          <div className="text-sm font-medium text-emerald-700">Your base share is marked as paid.</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {hasLatePaymentSummaries && (
                    <div className={`grid grid-cols-1 gap-3 ${lateSummariesGridCols}`}>
                      {lateIncomingPendingCents > 0 && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
                          <div className="text-[11px] uppercase tracking-wide text-amber-800">Late joiner due</div>
                          <div className="mt-2 text-3xl font-semibold leading-none text-amber-950">
                            {formatEuro(lateIncomingPendingCents)}
                          </div>
                          <div className="mt-1 text-sm text-amber-900/80">awaiting your confirmation</div>
                        </div>
                      )}
                      {lateOutgoingPendingCents > 0 && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
                          <div className="text-[11px] uppercase tracking-wide text-amber-800">Late payments due</div>
                          <div className="mt-2 text-3xl font-semibold leading-none text-amber-950">
                            {formatEuro(lateOutgoingPendingCents)}
                          </div>
                          <div className="mt-1 text-sm text-amber-900/80">remaining from your side</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm md:p-5">
                <div className="space-y-0.5">
                  <h3 className="text-base font-semibold text-slate-900">Incoming transfers</h3>
                  <p className="text-sm text-slate-600">Confirm payments people have sent to you.</p>
                </div>

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
                  const incomingExtra = myParticipantId ? extraIncomingForViewer : []
                  const hasAny = incomingStandard.length > 0 || incomingExtra.length > 0 || incomingLate.length > 0
                  if (!hasAny) {
                    return (
                      <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-sm text-slate-500">
                        No incoming transfers.
                      </div>
                    )
                  }
                  return (
                    <div className="mt-3 space-y-2.5">
                      {incomingStandard.map(p => (
                        <div key={p.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-900">
                                {participantName(p)} {formatEuro(perPersonCentsAtFinalize)}
                              </span>
                              {pendingSignalsSet.has(p.id) && (
                                <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                  Reported paid
                                </span>
                              )}
                            </div>
                            {!minParticipantsReached ? (
                              <span className="text-xs text-slate-500">Waiting for minimum participants</span>
                            ) : (
                              <form action={markReceived.bind(null, p.id)}>
                                <button
                                  className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                  type="submit"
                                >
                                  {pendingSignalsSet.has(p.id) ? 'Confirm received' : 'Mark received'}
                                </button>
                              </form>
                            )}
                          </div>
                        </div>
                      ))}
                      {incomingExtra.map(row => {
                        const payer = participantsById.get(row.payer_participant_id)
                        const payerName = payer ? participantName(payer) : 'Participant'
                        const awaiting = row.reported
                        return (
                          <div
                            key={`${row.extra_id}:${row.payer_participant_id}`}
                            className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-slate-900">
                                  {payerName} {formatEuro(row.amount_cents)}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                  {row.extra_title ? `Extra: ${row.extra_title}` : 'Extra'}
                                </span>
                                {awaiting && (
                                  <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                    Reported paid
                                  </span>
                                )}
                                {!extraPaymentsAvailable && (
                                  <span className="rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                                    Tracking unavailable
                                  </span>
                                )}
                              </div>
                              {!minParticipantsReached ? (
                                <span className="text-xs text-slate-500">Waiting for minimum participants</span>
                              ) : extraPaymentsAvailable ? (
                                <form action={markExtraReceived.bind(null, row.extra_id, row.payer_participant_id)}>
                                  <button
                                    className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                    type="submit"
                                  >
                                    {awaiting ? 'Confirm received' : 'Mark received'}
                                  </button>
                                </form>
                              ) : (
                                <span className="text-xs text-slate-500">Apply latest migration</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      {incomingLate.map(transfer => {
                        const sender = participantsClean.find(p => p.id === transfer.from_participant_id)
                        const senderName = sender ? participantName(sender) : 'Participant'
                        const awaiting = !!transfer.sender_marked_at && !transfer.received_at
                        return (
                          <div key={transfer.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-slate-900">
                                  {senderName} {formatEuro(transfer.expected_cents)}
                                </span>
                                {awaiting && (
                                  <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                    Reported paid
                                  </span>
                                )}
                              </div>
                              <form action={confirmLateJoinReceipt.bind(null, transfer.id)}>
                                <button
                                  className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                  type="submit"
                                >
                                  {awaiting ? 'Confirm received' : 'Mark received'}
                                </button>
                              </form>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </section>

              <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm md:p-5">
                <div className="space-y-0.5">
                  <h3 className="text-base font-semibold text-slate-900">Outgoing transfers</h3>
                  <p className="text-sm text-slate-600">Complete and self-report transfers you still owe.</p>
                </div>

                {myParticipantId ? (
                  (() => {
                    const showLateOutgoing = lateOutgoingTransfers.length > 0
                    const showBaseOutgoing = paymentsOpen && !viewerIsCollector && !!collectorId && !isFinalized && !viewerPaid
                    const showBaseSelfMark =
                      paymentsOpen && viewerIsCollector && !!collectorId && myParticipantId === collectorId && !collectorIsCountedPaid
                    const showExtraOutgoing = paymentsOpen && extraOutgoingForViewer.length > 0
                    const showExtraSelfMark = paymentsOpen && extraSelfMarkRowsForViewer.length > 0
                    if (!showLateOutgoing && !showBaseOutgoing && !showBaseSelfMark && !showExtraOutgoing && !showExtraSelfMark) {
                      return (
                        <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-sm text-slate-500">
                          {isPendingStatus ? 'Payments are not open yet.' : 'No outgoing transfers.'}
                        </div>
                      )
                    }
                    return (
                      <div className="mt-3 space-y-3">
                        {showLateOutgoing && (
                          <div className="space-y-2">
                            <LateOutgoingTransfers
                              transfers={lateOutgoingTransfers}
                              participants={participantsClean}
                              allOptions={allOptionsEntries}
                              viewerParticipantId={myParticipantId}
                              projectCanceled={isAborted}
                            />
                          </div>
                        )}
                        {showBaseOutgoing && collectorId && (
                          <div className="space-y-2">
                            <OutgoingTransfer
                              collectorName={collectorName}
                              amountLabel={formatEuro(perPersonCents)}
                              collectorOptions={collectorPaymentOptions}
                              participantId={myParticipantId}
                              viewerPaid={viewerPaid}
                              viewerHasPendingSignal={viewerHasPendingSignal}
                              projectCanceled={isAborted}
                              canPay={paymentsOpen && minParticipantsReached}
                            />
                          </div>
                        )}
                        {showBaseSelfMark && (
                          <div className="space-y-2">
                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-slate-900">
                                    My base share {formatEuro(perPersonCents)}
                                  </span>
                                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                    Base contribution
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <form action={markCollectorSelfPaid.bind(null, projectId)}>
                                    <button
                                      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                                      type="submit"
                                      disabled={!minParticipantsReached || isAborted || isFinalized}
                                      title={
                                        !minParticipantsReached
                                          ? 'Waiting for minimum participants'
                                          : isAborted
                                            ? 'Payments are disabled for canceled projects'
                                            : isFinalized
                                              ? 'Payments are locked after finalization'
                                              : undefined
                                      }
                                    >
                                      Mark my share as paid
                                    </button>
                                  </form>
                                  {!minParticipantsReached && (
                                    <span className="text-xs text-slate-500">Waiting for minimum participants</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        {showExtraOutgoing && (
                          <div className="space-y-2">
                            {extraOutgoingForViewer.map(row => {
                              const collectorParticipant = participantsById.get(row.collector_participant_id)
                              const collectorNameForRow = collectorParticipant ? participantName(collectorParticipant) : 'Collector'
                              const collectorOptionsForRow =
                                (allOptions.get(row.collector_participant_id) ?? []).filter(
                                  option => option.is_active !== false
                                )
                              if (!extraPaymentsAvailable) {
                                return (
                                  <div
                                    key={`${row.extra_id}:${row.payer_participant_id}`}
                                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm"
                                  >
                                    <div className="space-y-0.5">
                                      <div className="font-medium text-slate-900">
                                        {collectorNameForRow} - {formatEuro(row.amount_cents)}
                                      </div>
                                      <div className="text-xs text-slate-600">
                                        {row.extra_title ? `Extra: ${row.extra_title}` : 'Extra payment'}
                                      </div>
                                      <div className="mt-2 text-xs text-slate-500">Apply latest migration</div>
                                    </div>
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
                                  canPay={paymentsOpen && minParticipantsReached}
                                  contextLabel={row.extra_title ? `Extra: ${row.extra_title}` : 'Extra payment'}
                                  reportPaidAction={selfReportExtraPaid.bind(null, row.extra_id, row.payer_participant_id)}
                                />
                              )
                            })}
                          </div>
                        )}
                        {showExtraSelfMark && (
                          <div className="space-y-2">
                            {extraSelfMarkRowsForViewer.map(row => {
                              if (!extraPaymentsAvailable) {
                                return (
                                  <div
                                    key={`${row.extra_id}:${row.payer_participant_id}`}
                                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm"
                                  >
                                    <div className="space-y-0.5">
                                      <div className="font-medium text-slate-900">My extra share - {formatEuro(row.amount_cents)}</div>
                                      <div className="text-xs text-slate-600">
                                        {row.extra_title ? `Extra: ${row.extra_title}` : 'Extra payment'}
                                      </div>
                                      <div className="mt-2 text-xs text-slate-500">Apply latest migration</div>
                                    </div>
                                  </div>
                                )
                              }
                              return (
                                <div
                                  key={`${row.extra_id}:${row.payer_participant_id}`}
                                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                                >
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-medium text-slate-900">
                                        My extra share {formatEuro(row.amount_cents)}
                                      </span>
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                        {row.extra_title ? `Extra: ${row.extra_title}` : 'Extra payment'}
                                      </span>
                                    </div>
                                    {!paymentsOpen ? (
                                      <span className="text-xs text-slate-500">Open payments to mark your share</span>
                                    ) : !minParticipantsReached ? (
                                      <span className="text-xs text-slate-500">Waiting for minimum participants</span>
                                    ) : (
                                      <form
                                        action={markExtraCollectorSelfPaid.bind(
                                          null,
                                          row.extra_id,
                                          row.payer_participant_id
                                        )}
                                      >
                                        <button
                                          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                          type="submit"
                                        >
                                          Mark my share as paid
                                        </button>
                                      </form>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })()
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-sm text-slate-500">
                    {isPendingStatus ? 'Payments are not open yet.' : 'No outgoing transfers.'}
                  </div>
                )}
              </section>

              {showMyRefundSection && (
                <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm md:p-5">
                  <div className="space-y-0.5">
                    <h3 className="text-base font-semibold text-slate-900">Leave With Refund</h3>
                    <p className="text-sm text-slate-600">
                      If you already paid, request collector approval before leaving.
                    </p>
                  </div>

                  {!refundRequestsAvailable ? (
                    <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-sm text-slate-500">
                      Refund workflow is unavailable until the latest migration is applied.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <div className="text-xs uppercase tracking-wide text-slate-600">Eligible refund</div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">
                          {formatEuro(myRefundEligibleTotalCents)}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          Base {formatEuro(myBaseRefundableCents)} + Extras {formatEuro(myExtrasRefundableCents)}
                        </div>
                      </div>

                      {myLatestRefundRequest ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-900">
                              Refund status: {String(myLatestRefundRequest.status).replaceAll('_', ' ')}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                              Requested {new Date(myLatestRefundRequest.requested_at).toLocaleString()}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            Amount {formatEuro(Number(myLatestRefundRequest.total_amount_cents ?? 0))}
                          </div>

                          {myLatestRefundRequest.status === 'pending' && (
                            <div className="mt-2 text-xs text-amber-700">
                              Waiting for collector approval.
                            </div>
                          )}
                          {myLatestRefundRequest.status === 'approved' && (
                            <div className="mt-2 text-xs text-slate-600">
                              Approved. Waiting for collector to mark refund as sent.
                            </div>
                          )}
                          {myLatestRefundRequest.status === 'sent' && (
                            <div className="mt-2">
                              <form action={confirmParticipantRefundReceived.bind(null, myLatestRefundRequest.id)}>
                                <button
                                  className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                  type="submit"
                                >
                                  Confirm refund received and leave
                                </button>
                              </form>
                            </div>
                          )}
                          {(myLatestRefundRequest.status === 'rejected' || myLatestRefundRequest.status === 'canceled') && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="text-xs text-red-700">Request was not approved.</span>
                              <form action={requestParticipantRefund.bind(null, projectId)}>
                                <button
                                  className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                  type="submit"
                                >
                                  Request again
                                </button>
                              </form>
                            </div>
                          )}
                          {myLatestRefundRequest.status === 'completed' && (
                            <div className="mt-2 text-xs text-emerald-700">
                              Refund completed. You can leave the project now.
                            </div>
                          )}
                        </div>
                      ) : myRefundEligibleTotalCents > 0 ? (
                        <form action={requestParticipantRefund.bind(null, projectId)}>
                          <button
                            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                            type="submit"
                          >
                            Request refund approval
                          </button>
                        </form>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-3 text-xs text-slate-600">
                          No confirmed payments are currently eligible for refund.
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              {showCollectorRefundSection && (
                <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm md:p-5">
                  <div className="space-y-0.5">
                    <h3 className="text-base font-semibold text-slate-900">Refund Requests</h3>
                    <p className="text-sm text-slate-600">Approve, reject, and mark participant refunds as sent.</p>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    {collectorRefundRequests.map(refund => {
                      const participant = participantsById.get(refund.participant_id)
                      const requesterLabel = participant ? participantName(participant) : `#${refund.participant_id.slice(0, 6)}`
                      return (
                        <div key={refund.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-0.5">
                              <div className="text-sm font-medium text-slate-900">
                                {requesterLabel} {formatEuro(Number(refund.total_amount_cents ?? 0))}
                              </div>
                              <div className="text-xs text-slate-600">
                                Base {formatEuro(Number(refund.base_amount_cents ?? 0))} + Extras{' '}
                                {formatEuro(Number(refund.extras_amount_cents ?? 0))}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Status {refund.status.replaceAll('_', ' ')} � Requested{' '}
                                {new Date(refund.requested_at).toLocaleString()}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {refund.status === 'pending' && (
                                <>
                                  <form action={approveParticipantRefund.bind(null, refund.id)}>
                                    <button
                                      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                      type="submit"
                                    >
                                      Approve
                                    </button>
                                  </form>
                                  <form action={rejectParticipantRefund.bind(null, refund.id)}>
                                    <button
                                      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                      type="submit"
                                    >
                                      Reject
                                    </button>
                                  </form>
                                </>
                              )}
                              {refund.status === 'approved' && (
                                <>
                                  <form action={markParticipantRefundSent.bind(null, refund.id)}>
                                    <button
                                      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                      type="submit"
                                    >
                                      Mark sent
                                    </button>
                                  </form>
                                  <form action={rejectParticipantRefund.bind(null, refund.id)}>
                                    <button
                                      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                      type="submit"
                                    >
                                      Reject
                                    </button>
                                  </form>
                                </>
                              )}
                              {refund.status === 'sent' && (
                                <span className="text-xs text-slate-600">Waiting for participant confirmation</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          ) : null,
          voting: (
            <Voting
              projectId={projectId}
              polls={pollsForVoting}
              projectCanceled={isAborted}
              canVote={isMemberActive}
              userVotes={userVotes}
              financeMode={financeMode}
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
              financeMode={financeMode}
              locale={projectDateLocale}
            />
          ),
          settings: viewerIsCollector ? <ProjectSettingsTab projectId={projectId} /> : null,
          admin: viewerCanManageJoinRequests ? (
            <AdminPanel
              projectId={projectId}
              participants={participantsClean}
              collectorId={collectorId}
              myParticipantId={myParticipantId}
              pendingRequests={pendingForOrganizer ?? []}
              pendingCount={(pendingForOrganizer ?? []).length}
              canManage={viewerIsCollector}
              canManageJoinRequests={viewerCanManageJoinRequests}
              canCancel={!isAborted && !isFinalized}
              openRequestsOnMount={openRequestsOnLoad}
              activityItems={activityItems}
              financeMode={financeMode}
            />
          ) : null,
        }}
      />
    </main>
  )
}
