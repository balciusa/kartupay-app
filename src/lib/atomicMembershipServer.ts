import 'server-only'

import { getCurrentUserId } from './supabaseServer'
import { supabaseAdmin } from './supabaseAdmin'
import {
  approvePr40ManagedApprovalFromAuthorizedContext,
} from './pr40ManagedApprovalServer'
import {
  executeDirectMembershipRpc,
  executeMembershipApprovalContextRpc,
  type AtomicMembershipResult,
} from './atomicMembershipRpc'

async function requireActorId() {
  const actorId = await getCurrentUserId()
  if (!actorId) throw new Error('You must be signed in')
  return actorId
}

export async function reserveDirectMembershipFromSession(
  projectId: string
): Promise<AtomicMembershipResult> {
  const actorId = await requireActorId()
  return executeDirectMembershipRpc(supabaseAdmin, {
    p_project_id: projectId,
    p_actor_user_id: actorId,
    p_user_id: actorId,
    p_join_request_id: null,
  })
}

export async function approveProjectMembershipFromSession(
  requestId: string
): Promise<AtomicMembershipResult> {
  const actorId = await requireActorId()
  const context = await executeMembershipApprovalContextRpc(supabaseAdmin, {
    p_request_id: requestId,
    p_actor_user_id: actorId,
  })
  if (context.status !== 'pending') {
    return {
      outcome: 'request_not_pending', project_id: context.project_id,
      request_id: context.request_id, participant_id: null,
      membership_changed: false, options_written: 0, transfers_written: 0,
    }
  }
  if (context.finance_mode === 'managed') {
    return approvePr40ManagedApprovalFromAuthorizedContext(context)
  }

  return executeDirectMembershipRpc(supabaseAdmin, {
    p_project_id: context.project_id,
    p_actor_user_id: actorId,
    p_user_id: context.requester_user_id,
    p_join_request_id: context.request_id,
  })
}
