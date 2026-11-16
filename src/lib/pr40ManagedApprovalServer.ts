import 'server-only'

import { getCurrentUserId } from './supabaseServer'
import { supabaseAdmin } from './supabaseAdmin'
import { canManageProjectJoinRequests } from './projectJoinRequests'
import {
  preparePr40ManagedApproval,
  type Pr40ManagedApprovalCommand,
  type Pr40PendingRequest,
  type Pr40Membership,
} from './pr40ManagedApprovalCommand'
import type { Pr40ExistingOption, Pr40UserOption } from './pr40PaymentOptionPlan'

/**
 * DORMANT adapter: never imported by a server action or route yet.
 * No RPC is invoked here and it is NOT a runtime cutover.
 *
 * The only user input is requestId. The actor comes from the verified
 * Supabase auth.getUser() session; requester and payment options are loaded
 * using the server-only service-role client.
 *
 * Concurrency: data can change between these reads and the eventual RPC.
 * The RPC must re-authorize under the project lock and implement a reviewed
 * strategy for staleness/option provenance before runtime use.
 */
export async function preparePr40ManagedApprovalFromSession(
  requestId: string
): Promise<Pr40ManagedApprovalCommand> {
  return preparePr40ManagedApproval(requestId, {
    authenticatedActorId: getCurrentUserId,
    loadRequest: async id => {
      const { data, error } = await supabaseAdmin
        .from('join_requests')
        .select('id, project_id, requester_user_id, status')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return (data as Pr40PendingRequest | null) ?? null
    },
    assertCanApprove: async (projectId, actorId) => {
      const { data: project, error: projectError } = await supabaseAdmin
        .from('projects')
        .select('is_public, collector_participant_id, status, canceled_at')
        .eq('id', projectId)
        .maybeSingle()
      if (projectError) throw projectError
      if (!project) throw new Error('Project not found')
      if (project.canceled_at || ['canceled', 'cancelled'].includes(String(project.status ?? '').trim().toLowerCase())) {
        throw new Error('Project is no longer active')
      }
      const { data: actor, error: actorError } = await supabaseAdmin
        .from('participants')
        .select('id, role')
        .eq('project_id', projectId)
        .eq('user_id', actorId)
        .is('left_at', null)
        .maybeSingle()
      if (actorError) throw actorError
      if (!canManageProjectJoinRequests({
        isPublic: project.is_public,
        participantId: actor?.id,
        participantRole: actor?.role,
        collectorParticipantId: project.collector_participant_id,
      })) throw new Error('Not authorized')
    },
    loadMember: async (projectId, userId) => {
      const { data, error } = await supabaseAdmin
        .from('participants')
        .select('id, left_at')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return (data as Pr40Membership | null) ?? null
    },
    loadUserOptions: async userId => {
      const { data, error } = await supabaseAdmin
        .from('user_payment_options')
        .select('id, type, label, value, priority, is_active')
        .eq('user_id', userId)
        .eq('is_active', true)
      if (error) throw error
      return (data ?? []) as Pr40UserOption[]
    },
    loadMemberOptions: async participantId => {
      const { data, error } = await supabaseAdmin
        .from('payment_options')
        .select('type, value')
        .eq('participant_id', participantId)
      if (error) throw error
      return (data ?? []) as Pr40ExistingOption[]
    },
  })
}
