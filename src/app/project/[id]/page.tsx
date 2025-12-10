import { headers } from 'next/headers'
import { SummaryCards } from '@/components/Project/SummaryCards'
import { Participants } from '@/components/Project/Participants'
import { Discussions } from '@/components/Project/Discussions'
import Voting from '@/components/Project/Voting'
import { getCurrentUserId, getSupabaseServer } from '@/lib/supabaseServer'
import { joinProject } from './actions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id?: string }>
  searchParams?: Promise<{ id?: string | string[] }>
}) {
  // In Next.js 16, params is a Promise that must be awaited
  const resolvedParams = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  
  // IDs from a dynamic segment are already decoded by Next
  const pathId = Array.isArray(resolvedParams?.id) ? resolvedParams?.id?.[0] : resolvedParams?.id
  const queryId = resolvedSearchParams ? (Array.isArray(resolvedSearchParams?.id) ? resolvedSearchParams?.id?.[0] : resolvedSearchParams?.id) : undefined
  const hdrs = await headers()
  const extractIdFromPath = (path?: string | null) => {
    if (!path) return null
    const match = path.match(/\/project\/([^/?#]+)/)
    return match?.[1] ?? null
  }
  const headerPaths =
    hdrs && typeof (hdrs as any).get === 'function'
      ? [
          (hdrs as any).get('x-invoke-path'),
          (hdrs as any).get('x-middleware-pathname'),
          (hdrs as any).get('x-original-url'),
          (hdrs as any).get('x-rewrite-url'),
          (hdrs as any).get('x-forwarded-url'),
          (hdrs as any).get('next-url'),
          (hdrs as any).get('referer')
        ].filter(Boolean)
      : []
  const parsedFromHeaders = headerPaths.map(extractIdFromPath).find(Boolean) ?? null
  const projectId = pathId || queryId || parsedFromHeaders

  if (!projectId) {
    const headerSnapshot: Array<[string, string]> = []
    try {
      // ReadonlyHeaders doesn't have entries(), so we'll just use the headerPaths we already extracted
      // This is just for debugging display
    } catch {
      // ignore
    }
    return (
      <main className="p-6 max-w-2xl mx-auto space-y-4">
        <h1 className="text-xl font-semibold">Project not found (missing id)</h1>
        <pre className="text-xs whitespace-pre-wrap border rounded p-3 bg-muted/30">
{JSON.stringify({
  paramsReceived: resolvedParams,
  searchParamsReceived: resolvedSearchParams,
  parsedFromHeaders: parsedFromHeaders ?? null,
  headerSnapshot
}, null, 2)}
        </pre>
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
    { data: transfers },
    { data: addonVotes }
  ] = await Promise.all([
    supabase.from('participants').select('id, user_id, role, short_code').eq('project_id', projectId),
    supabase.from('messages').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('addons').select('*').eq('project_id', projectId),
    supabase.from('payments').select('participant_id, is_counted, created_at').eq('is_counted', true),
    supabase.from('late_join_transfers').select('*').eq('project_id', projectId),
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
  const isMeParticipant = !!uid && rawParticipants.some(p => p.user_id === uid)
  const participantsClean = rawParticipants
  const participantsCount = participantsClean.length
  const participantIds = new Set(participantsClean.map(p => p.id))
  const paymentMethodsList = paymentOptions ?? []
  
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
        priority: m.priority ?? 999
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
  const organizerId = organizer?.id ?? null

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
        deadlineISO={project.deadline_at as string}
      />

      <div className="border rounded-xl p-4">
        <div className="font-medium mb-2">Join this project</div>
        <form action={async () => { 'use server'; await joinProject(projectId) }}>
            <button
              className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
              disabled={!uid || isMeParticipant}
              title={uid ? undefined : 'Sign in to join'}
            >
              {uid ? (isMeParticipant ? 'You are in' : 'Join project') : 'Sign in to join'}
            </button>
          </form>
          <div className="text-xs opacity-60 mt-1">On join, your active payment links from Settings will be copied here.</div>
        </div>

      <Participants
        projectId={projectId}
        participants={participantsClean}
        preferred={preferred}
        allOptions={allOptions}
        paidSet={paidSet}
        afterDeadlineSet={afterDeadlineSet}
        transfers={transfers ?? []}
        organizerId={organizerId}
      />

      <Voting addons={addonsWithCounts} />

      <Discussions projectId={projectId} messages={messages ?? []} />
    </main>
  )
}
