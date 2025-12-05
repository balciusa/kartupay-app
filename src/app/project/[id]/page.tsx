import { createSupabaseServerClient } from '@/lib/supabaseClient'
import { SummaryCards } from '@/components/Project/SummaryCards'
import { Participants } from '@/components/Project/Participants'
import { Discussions } from '@/components/Project/Discussions'
import { Voting } from '@/components/Project/Voting'
import { notFound } from 'next/navigation'

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = createSupabaseServerClient()
  const { id } = await params
  const projectId = decodeURIComponent(id)

  // Fetch project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (projectError || !project) {
    notFound()
  }

  // Fetch all related data in parallel
  const [
    { data: participants },
    { data: messages },
    { data: addons },
    { data: allPayments },
    { data: transfers },
    { data: paymentMethods },
    { data: addonVotes }
  ] = await Promise.all([
    supabase.from('participants').select('id, user_id, role, short_code').eq('project_id', projectId),
    supabase.from('messages').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('addons').select('*').eq('project_id', projectId),
    supabase.from('payments').select('participant_id, is_counted, created_at').eq('is_counted', true),
    supabase.from('late_join_transfers').select('*').eq('project_id', projectId),
    supabase.from('payment_methods').select('*').eq('project_id', projectId),
    supabase.from('addon_votes').select('addon_id')
  ])

  // Process participants and payment methods
  const participantsList = participants ?? []
  const participantIds = new Set(participantsList.map(p => p.id))
  const paymentMethodsList = paymentMethods ?? []
  
  // Filter payments to only those for participants in this project
  const payments = (allPayments ?? []).filter(p => participantIds.has(p.participant_id))
  
  // Build preferred payment methods map
  const preferred: Record<string, { label: string | null, value: string, type: string }> = {}
  const allOptions: Record<string, Array<{ label: string | null, value: string, type: string, priority: number }>> = {}
  
  for (const p of participantsList) {
    const methods = paymentMethodsList.filter(pm => pm.participant_id === p.id)
    if (methods.length > 0) {
      // Sort by priority, find preferred (lowest priority number)
      const sorted = methods.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      preferred[p.id] = {
        label: sorted[0].label,
        value: sorted[0].value,
        type: sorted[0].type
      }
      allOptions[p.id] = sorted.map(m => ({
        label: m.label,
        value: m.value,
        type: m.type,
        priority: m.priority ?? 999
      }))
    }
  }

  // Process payments
  const paidIds = payments.map(p => p.participant_id)
  const deadline = new Date(project.deadline_at as any)
  const afterDeadlineIds = payments
    .filter(p => new Date(p.created_at) > deadline)
    .map(p => p.participant_id)

  // Calculate scenarios
  const participantsNow = paidIds.length
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

  // Find organizer
  const organizer = participantsList.find(p => p.role === 'organizer')
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

      <Participants
        projectId={projectId}
        participants={participantsList}
        preferred={preferred}
        allOptions={allOptions}
        paidIds={paidIds}
        afterDeadlineIds={afterDeadlineIds}
        transfers={transfers ?? []}
        organizerId={organizerId}
      />

      <Voting addons={addons ?? []} voteCount={voteCount} />

      <Discussions projectId={projectId} messages={messages ?? []} />
    </main>
  )
}
