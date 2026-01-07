import { SummaryCards } from '@/components/Project/SummaryCards'
import { Participants } from '@/components/Project/Participants'
import { Discussions } from '@/components/Project/Discussions'
import Voting from '@/components/Project/Voting'
import { ProjectTabs } from '@/components/Project/ProjectTabs'
import { AdminPanel } from '@/components/Project/AdminPanel'
import { OutgoingTransfer } from '@/components/Project/OutgoingTransfer'
import { LeaveProjectButton } from '@/components/Project/LeaveProjectButton'
import { JoinButton } from '@/components/Project/JoinButton'
import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import OverflowMenu from '@/components/ui/OverflowMenu'
import { finalizeProject, reopenProject, abortProject, markReceived } from './actions'

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
    'id, title, description, total_cents, min_participants, max_participants, deadline_at, status, canceled_at, collector_participant_id'
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
  const abortedAtDisplay = (project.aborted_at as string | null) ?? (project.canceled_at as string | null) ?? null
  const abortedAtLocale = abortedAtDisplay ? new Date(abortedAtDisplay).toLocaleString() : null
  const closedAt = (project.closed_at as string | null) ?? null

  // Fetch all related data in parallel
  const [
    { data: participants },
    { data: messages },
    { data: addons },
    { data: allPayments },
    { data: addonVotes }
  ] = await Promise.all([
    supabase
      .from('participants')
      .select('id, user_id, role, short_code, joined_at, users(email, display_name)')
      .eq('project_id', projectId)
      .is('left_at', null)
      .order('joined_at', { ascending: true }),
    supabase.from('messages').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('addons').select('*').eq('project_id', projectId),
    supabase.from('payments').select('participant_id, is_counted, created_at'),
    supabase.from('addon_votes').select('addon_id')
  ])
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
  const uid = await getCurrentUserId()
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

  const { data: myPendingReq } = uid
    ? await supabase
        .from('join_requests')
        .select('id, created_at, status')
        .eq('project_id', projectId)
        .eq('requester_user_id', uid)
        .eq('status', 'pending')
        .maybeSingle()
    : { data: null as any }
  const hasPending = !!myPendingReq

  const { data: pendingForOrganizer, error: pendingErr } = await supabase
    .from('join_requests')
    .select('id, requester_user_id, created_at, status')
    .eq('project_id', projectId)
    .eq('status', 'pending')
  
  if (pendingErr) {
    console.error('[ProjectPage] Error fetching pending requests:', pendingErr)
  }
  console.log('[ProjectPage] Pending requests for organizer:', { count: pendingForOrganizer?.length ?? 0, requests: pendingForOrganizer })

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
  
  const deadline = project.deadline_at ? new Date(project.deadline_at as any) : null
  const afterDeadlineIds = payments
    .filter(p => (deadline ? new Date(p.created_at) > deadline : false))
    .map(p => p.participant_id)
  const afterDeadlineSet = new Set(afterDeadlineIds)

  // Calculate scenarios
  const totalCents = Number(project.total_cents ?? 0)
  const perPersonCents = Math.floor(totalCents / Math.max(1, participantsCount))
  const participantsNow = paidIds.length || participantsCount
  const viewerPaid = !!(myParticipantId && paidSet.has(myParticipantId))
  const viewerHasPendingSignal = !!(myParticipantId && pendingSignalsSet.has(myParticipantId))
  const viewerPaidCents = viewerPaid ? perPersonCents : 0
  const collectedCents = perPersonCents * paidIds.length
  const formatEuro = (cents: number) => `€${(cents / 100).toFixed(2)}`
  const scenarios = {
    now: Math.floor(totalCents / Math.max(1, participantsNow)),
    plus1: Math.floor(totalCents / Math.max(1, participantsNow + 1)),
    plus2: Math.floor(totalCents / Math.max(1, participantsNow + 2))
  }

  // Process addon votes - filter to only votes for addons in this project
  const addonIds = new Set((addons ?? []).map(a => a.id))
  const projectAddonVotes = (addonVotes ?? []).filter(v => addonIds.has(v.addon_id))
  const voteCount: Record<string, number> = {}
  for (const vote of projectAddonVotes) {
    voteCount[vote.addon_id] = (voteCount[vote.addon_id] ?? 0) + 1
  }
  const addonsWithCounts = (addons ?? []).map(a => ({
    ...a,
    current_votes: voteCount[a.id] ?? 0,
  }))

  // Find organizer
  const organizer = participantsClean.find(p => p.role === 'organizer')
  const organizerId = myParticipantRole === 'organizer' ? myParticipantId : organizer?.id ?? null
  const collectorId = (project.collector_participant_id as string | null) ?? organizerId
  const collectorParticipant = collectorId ? participantsClean.find(p => p.id === collectorId) : null
  const collectorLabel = collectorParticipant ? participantName(collectorParticipant) : 'Member'
  const collectorName = collectorLabel
  const viewerIsCollector = !!(myParticipantId && collectorId && myParticipantId === collectorId)
  
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
  const viewerIsOrganizer = myParticipantRole === 'organizer'
  const overflowItems = []
  if (isClosedStatus) {
    overflowItems.push({
      label: 'Reopen project',
      formAction: reopenProject.bind(null, projectId),
    })
  }
  if (!isAborted) {
    overflowItems.push({
      label: 'Abort project',
      type: 'danger' as const,
      formAction: abortProject.bind(null, projectId),
    })
  }
  const joinCta = (() => {
    if (!uid) {
      return (
        <button className="px-3 py-1.5 rounded bg-black text-white opacity-50" disabled>
          Sign in to join
        </button>
      )
    }
    if (isAborted) {
      return (
        <button className="px-3 py-1.5 rounded border" disabled title="Project aborted">
          Project aborted
        </button>
      )
    }
    if (isMemberActive) {
      if (isOnlyOrganizer) {
        return null
      }
      return (
        <button className="px-3 py-1.5 rounded border" disabled>
          You are in
        </button>
      )
    }
    if (isCollectingStatus) {
      if (hasPending) {
        return (
          <div className="space-y-1">
            <button className="px-3 py-1.5 rounded border" disabled>
              Request sent
            </button>
            <div className="text-xs opacity-60">
              Waiting for organizer approval
              {myPendingReq?.created_at ? ` since ${new Date(myPendingReq.created_at).toLocaleString()}` : ''}
            </div>
          </div>
        )
      }
      return <JoinButton projectId={projectId} canJoinNow={true} />
    }
    if (hasPending) {
      return (
        <div className="space-y-1">
          <button className="px-3 py-1.5 rounded border" disabled>
            Request sent
          </button>
          <div className="text-xs opacity-60">
            Waiting for organizer approval
            {myPendingReq?.created_at ? ` since ${new Date(myPendingReq.created_at).toLocaleString()}` : ''}
          </div>
        </div>
      )
    }
    return <JoinButton projectId={projectId} canJoinNow={false} />
  })()

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            {project.title}
            {isClosedStatus && (
              <span className="text-xs px-2 py-0.5 rounded bg-black text-white">Finalized</span>
            )}
            {isAborted && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-600 text-white">Aborted</span>
            )}
          </h1>
          {project.description && (
            <div className="text-sm opacity-70 mt-2">{project.description}</div>
          )}
        </div>
        {viewerIsOrganizer && (
          <div className="flex items-center gap-2">
            {isCollectingStatus && (
              <form action={finalizeProject.bind(null, projectId)}>
                <button className="px-3 py-1.5 rounded bg-black text-white" type="submit">
                  Finalize project
                </button>
              </form>
            )}
            {overflowItems.length > 0 && <OverflowMenu items={overflowItems} />}
          </div>
        )}
      </div>

      {isAborted && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm">
          This project was aborted {abortedAtLocale ? `on ${abortedAtLocale}` : 'recently'}.
        </div>
      )}

      <SummaryCards
        totalCents={totalCents}
        minParticipants={project.min_participants as number | null}
        participantsNow={participantsNow}
        scenarios={scenarios}
        deadlineISO={(project.deadline_at as string) ?? undefined}
        maxParticipants={project.max_participants as number | null}
        collectorLabel={collectorLabel}
      />

      <ProjectTabs
        counts={{
          participants: participantsCount,
          activity: (messages ?? []).length,
          adminPending: viewerIsOrganizer ? (pendingForOrganizer ?? []).length : 0,
        }}
        sections={{
          overview: (
            <div className="space-y-6">
              <div className="border rounded-xl p-4 space-y-2">
                <div className="font-medium">Join this project</div>
                {joinCta}
                {isMemberActive && (
                  <div>
                    <LeaveProjectButton projectId={projectId} isOnlyOrganizer={isOnlyOrganizer} />
                  </div>
                )}
                <div className="text-xs opacity-60 mt-1">
                  On join, your active payment links from Settings will be copied here.
                </div>
              </div>
            </div>
          ),
          participants: (
            <Participants
              projectId={projectId}
              participants={participantsClean}
              preferred={preferredEntries}
              allOptions={allOptionsEntries}
              paidSet={paidSet}
              afterDeadlineSet={afterDeadlineSet}
              organizerId={organizerId}
              pendingRequests={pendingForOrganizer ?? []}
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
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="border rounded-lg p-3 text-sm space-y-1">
                    <div className="text-xs uppercase opacity-60">Funds</div>
                    <div className="font-medium">
                      {viewerIsOrganizer
                        ? `Collected ${formatEuro(collectedCents)} out of ${formatEuro(totalCents)}`
                        : `Paid ${formatEuro(viewerPaidCents)} out of ${formatEuro(perPersonCents)}`}
                    </div>
                  </div>
                  <div className="border rounded-lg p-3 text-sm space-y-1">
                    <div className="text-xs uppercase opacity-60">SETTLED</div>
                    <div className="font-medium">
                      {viewerIsOrganizer
                        ? `Settled ${paidIds.length} out of ${participantsCount}`
                        : `Settled ${viewerPaid ? 1 : 0} out of ${participantsCount}`}
                    </div>
                  </div>
                </div>
              </section>
              <section className="border rounded-xl p-4 space-y-3">
                <div className="font-medium">Incoming transfers</div>
                {viewerIsCollector ? (
                  (() => {
                    const incoming = participantsClean.filter(p => p.id !== collectorId && !paidSet.has(p.id))
                    if (incoming.length === 0) {
                      return <div className="text-sm opacity-70">No incoming transfers.</div>
                    }
                    return (
                      <div className="divide-y">
                        {incoming.map(p => (
                          <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                            <div>
                              {participantName(p)}{' '}
                              — {formatEuro(perPersonCents)}
                            </div>
                            <form action={markReceived.bind(null, p.id)}>
                              <button className="px-3 py-1.5 rounded border text-xs" type="submit">
                                Mark received
                              </button>
                            </form>
                          </div>
                        ))}
                      </div>
                    )
                  })()
                ) : (
                  <div className="text-sm opacity-70">No incoming transfers.</div>
                )}
              </section>
              <section className="border rounded-xl p-4 space-y-3">
                <div className="font-medium">Outgoing transfers</div>
                {!viewerIsCollector && myParticipantId && collectorId ? (
                  <div className="divide-y">
                    <OutgoingTransfer
                      collectorName={collectorName}
                      amountLabel={formatEuro(perPersonCents)}
                      collectorOptions={collectorOptions}
                      participantId={myParticipantId}
                      viewerPaid={viewerPaid}
                      viewerHasPendingSignal={viewerHasPendingSignal}
                      projectCanceled={isAborted}
                    />
                  </div>
                ) : (
                  <div className="text-sm opacity-70">No outgoing transfers.</div>
                )}
              </section>
              <Voting addons={addonsWithCounts} projectCanceled={isAborted} />
            </div>
          ),
          activity: (
            <Discussions projectId={projectId} messages={messages ?? []} projectCanceled={isAborted} />
          ),
          admin: (
            <AdminPanel
              projectId={projectId}
              pendingRequests={pendingForOrganizer ?? []}
              pendingCount={viewerIsOrganizer ? (pendingForOrganizer ?? []).length : 0}
              isOrganizer={viewerIsOrganizer}
              canFinalize={isCollectingStatus && !isAborted}
              canCancel={!isAborted}
            />
          ),
        }}
      />
    </main>
  )
}
