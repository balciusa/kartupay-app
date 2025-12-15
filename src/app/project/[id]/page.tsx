import { SummaryCards } from '@/components/Project/SummaryCards'
import { Participants } from '@/components/Project/Participants'
import { Discussions } from '@/components/Project/Discussions'
import Voting from '@/components/Project/Voting'
import { JoinButton } from '@/components/Project/JoinButton'
import { LeaveProjectButton } from '@/components/Project/LeaveProjectButton'
import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

  // Fetch project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

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
      .select('id, user_id, role, short_code, joined_at')
      .eq('project_id', projectId)
      .is('left_at', null)
      .order('joined_at', { ascending: true }),
    supabase.from('messages').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('addons').select('*').eq('project_id', projectId),
    supabase.from('payments').select('participant_id, is_counted, created_at').eq('is_counted', true),
    supabase.from('addon_votes').select('addon_id')
  ])

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

  // Process payments (as Sets for component)
  const paidIds = payments.map(p => p.participant_id)
  const paidSet = new Set(paidIds)
  const deadline = project.deadline_at ? new Date(project.deadline_at as any) : null
  const afterDeadlineIds = payments
    .filter(p => (deadline ? new Date(p.created_at) > deadline : false))
    .map(p => p.participant_id)
  const afterDeadlineSet = new Set(afterDeadlineIds)

  // Calculate scenarios
  const participantsNow = paidIds.length || participantsCount
  const totalCents = project.total_cents
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
  const organizerId = myParticipantRole === 'organizer'
    ? myParticipantId
    : organizer?.id ?? null
  
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

  const now = new Date()
  const beforeDeadline = project.deadline_at ? now <= new Date(project.deadline_at as any) : true
  const canJoinNow = project.status === 'collecting' && beforeDeadline
  const isMemberActive = isMeParticipant

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">{project.title}</h1>
        {project.description && (
          <div className="text-sm opacity-70 mt-2">{project.description}</div>
        )}
      </div>

      <SummaryCards
        totalCents={totalCents}
        minParticipants={project.min_participants}
        participantsNow={participantsNow}
        scenarios={scenarios}
        deadlineISO={(project.deadline_at as string) ?? undefined}
        maxParticipants={project.max_participants as number | null}
      />

      <div className="border rounded-xl p-4">
        <div className="font-medium mb-2">Join this project</div>
        {!uid ? (
          <button className="px-3 py-1.5 rounded bg-black text-white opacity-50" disabled>
            Sign in to join
          </button>
        ) : isMemberActive ? (
          <LeaveProjectButton projectId={projectId} isOnlyOrganizer={isOnlyOrganizer} />
        ) : canJoinNow ? (
          <JoinButton projectId={projectId} canJoinNow={true} />
        ) : hasPending ? (
          <div className="space-y-1">
            <button className="px-3 py-1.5 rounded bg-black text-white opacity-50" disabled>
              Request sent
            </button>
            <div className="text-xs opacity-60">
              Waiting for organizer approval
              {myPendingReq?.created_at
                ? ` • requested ${new Date(myPendingReq.created_at).toLocaleString()}`
                : ''}
            </div>
          </div>
        ) : (
          <JoinButton projectId={projectId} canJoinNow={false} />
        )}
        <div className="text-xs opacity-60 mt-1">
          On join, your active payment links from Settings will be copied here.
        </div>
      </div>

      <Participants
        projectId={projectId}
        participants={participantsClean}
        preferred={preferred}
        allOptions={allOptions}
        paidSet={paidSet}
        afterDeadlineSet={afterDeadlineSet}
        organizerId={organizerId}
        pendingRequests={pendingForOrganizer ?? []}
        myParticipantId={myParticipantId}
        currentUserId={uid}
      />

      <Voting addons={addonsWithCounts} />

      <Discussions projectId={projectId} messages={messages ?? []} />
    </main>
  )
}
