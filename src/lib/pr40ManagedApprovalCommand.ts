import { planPr40PaymentOptionClone, type Pr40ExistingOption, type Pr40UserOption } from './pr40PaymentOptionPlan.ts'

export type Pr40PendingRequest = {
  id: string
  project_id: string
  requester_user_id: string
  status: string
}
export type Pr40Membership = {
  id: string
  left_at: string | null
}
export type Pr40ManagedApprovalCommand = {
  p_project_id: string
  p_request_id: string
  p_actor_user_id: string
  p_validated_options: Array<{
    type: string
    label: string
    value: string
    priority: number
  }>
}

/**
 * Prepares an RPC command from server-resolved, authenticated identity
 * and server-loaded records. This does NOT execute SQL or change runtime.
 *
 * Important: RPC must independently recheck actor permission, pending status,
 * project finance-mode, capacity and request ownership under the project lock.
 */
export async function preparePr40ManagedApproval(
  requestId: string,
  deps: {
    authenticatedActorId: () => Promise<string | null>
    loadRequest: (id: string) => Promise<Pr40PendingRequest | null>
    assertCanApprove: (projectId: string, actorId: string) => Promise<void>
    loadMember: (projectId: string, userId: string) => Promise<Pr40Membership | null>
    loadUserOptions: (userId: string) => Promise<Pr40UserOption[]>
    loadMemberOptions: (participantId: string) => Promise<Pr40ExistingOption[]>
  }
): Promise<Pr40ManagedApprovalCommand> {
  if (!requestId) throw new Error('Missing request id')
  const actorId = await deps.authenticatedActorId()
  if (!actorId) throw new Error('You must be signed in')
  const request = await deps.loadRequest(requestId)
  if (!request || request.id !== requestId) throw new Error('Join request not found')
  if (request.status !== 'pending') throw new Error('Join request is not pending')
  if (!request.project_id || !request.requester_user_id) throw new Error('Incomplete join request')
  // Do not load another user's payment destinations before manager authorization.
  await deps.assertCanApprove(request.project_id, actorId)
  const member = await deps.loadMember(request.project_id, request.requester_user_id)
  const options = await deps.loadUserOptions(request.requester_user_id)
  const existing = member ? await deps.loadMemberOptions(member.id) : []
  const planned = planPr40PaymentOptionClone(member?.id ?? 'new-participant', options, existing)
  // No client-side actor/user/recipient choice is accepted. The SQL function
  // still bears responsibility for atomic authorization + data changes.
  return {
    p_project_id: request.project_id,
    p_request_id: request.id,
    p_actor_user_id: actorId,
    p_validated_options: planned.map(({ type, label, value, priority }) => ({
      type, label, value, priority,
    })),
  }
}
