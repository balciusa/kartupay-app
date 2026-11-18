import 'server-only'

import { supabaseAdmin } from './supabaseAdmin'
import {
  preparePr40ManagedApproval,
  type Pr40ManagedApprovalCommand,
  type Pr40PendingRequest,
  type Pr40Membership,
} from './pr40ManagedApprovalCommand'
import type { Pr40ExistingOption, Pr40UserOption } from './pr40PaymentOptionPlan'
import {
  executeManagedApprovalRpc,
  type AtomicMembershipResult,
  type MembershipApprovalContext,
} from './atomicMembershipRpc'

/**
 * The request, actor and approval permission come from the service-only
 * authorization context RPC, which derives the actor from auth.getUser() on
 * the server adapter. Only then are requester payment options loaded.
 * The RPC re-authorizes and locks each source row, so a concurrent change
 * causes the complete approval transaction to fail rather than accepting a
 * stale or substituted destination.
 */
export async function preparePr40ManagedApprovalFromAuthorizedContext(
  context: MembershipApprovalContext
): Promise<Pr40ManagedApprovalCommand> {
  const request: Pr40PendingRequest = {
    id: context.request_id,
    project_id: context.project_id,
    requester_user_id: context.requester_user_id,
    status: context.status,
  }
  return preparePr40ManagedApproval(context.request_id, {
    authenticatedActorId: async () => context.actor_user_id,
    loadRequest: async id => id === context.request_id ? request : null,
    assertCanApprove: async () => {},
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

export async function approvePr40ManagedApprovalFromAuthorizedContext(
  context: MembershipApprovalContext
): Promise<AtomicMembershipResult> {
  const command = await preparePr40ManagedApprovalFromAuthorizedContext(context)
  return executeManagedApprovalRpc(supabaseAdmin, command)
}
