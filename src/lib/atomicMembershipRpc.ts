import type { SupabaseClient } from '@supabase/supabase-js'
import type { Pr40ManagedApprovalCommand } from './pr40ManagedApprovalCommand'

export type AtomicMembershipResult = {
  outcome: 'reserved' | 'already_active' | 'full' | 'request_not_pending'
  project_id: string
  request_id: string | null
  participant_id: string | null
  membership_changed: boolean
  options_written: number
  transfers_written: number
}

export type MembershipApprovalContext = {
  request_id: string
  project_id: string
  requester_user_id: string
  status: string
  finance_mode: 'none' | 'managed'
  actor_user_id: string
}

export function parseMembershipApprovalContext(value: unknown): MembershipApprovalContext {
  if (!value || typeof value !== 'object') throw new Error('Invalid membership approval context')
  const row = value as Record<string, unknown>
  if (
    typeof row.request_id !== 'string'
    || typeof row.project_id !== 'string'
    || typeof row.requester_user_id !== 'string'
    || typeof row.status !== 'string'
    || !['none', 'managed'].includes(String(row.finance_mode))
    || typeof row.actor_user_id !== 'string'
  ) throw new Error('Incomplete membership approval context')
  return row as MembershipApprovalContext
}

export function parseAtomicMembershipResult(value: unknown): AtomicMembershipResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid atomic membership response')
  const row = value as Record<string, unknown>
  if (!['reserved', 'already_active', 'full', 'request_not_pending'].includes(String(row.outcome))) {
    throw new Error('Invalid atomic membership outcome')
  }
  if (typeof row.project_id !== 'string') throw new Error('Invalid atomic membership project')
  return {
    outcome: row.outcome as AtomicMembershipResult['outcome'],
    project_id: row.project_id,
    request_id: typeof row.request_id === 'string' ? row.request_id : null,
    participant_id: typeof row.participant_id === 'string' ? row.participant_id : null,
    membership_changed: row.membership_changed === true,
    options_written: Number.isInteger(row.options_written) ? Number(row.options_written) : 0,
    transfers_written: Number.isInteger(row.transfers_written) ? Number(row.transfers_written) : 0,
  }
}

async function executeAtomicRpc(
  client: Pick<SupabaseClient, 'rpc'>,
  functionName: 'reserve_project_membership_atomic' | 'approve_managed_membership_atomic',
  args: Record<string, unknown>
) {
  const { data, error } = await client.rpc(functionName, args)
  if (error) throw error
  return parseAtomicMembershipResult(data)
}

export function executeDirectMembershipRpc(
  client: Pick<SupabaseClient, 'rpc'>,
  args: {
    p_project_id: string
    p_actor_user_id: string
    p_user_id: string
    p_join_request_id: string | null
  }
) {
  return executeAtomicRpc(client, 'reserve_project_membership_atomic', args)
}

export function executeManagedApprovalRpc(
  client: Pick<SupabaseClient, 'rpc'>,
  command: Pr40ManagedApprovalCommand
) {
  return executeAtomicRpc(client, 'approve_managed_membership_atomic', command)
}

export async function executeMembershipApprovalContextRpc(
  client: Pick<SupabaseClient, 'rpc'>,
  args: { p_request_id: string; p_actor_user_id: string }
) {
  const { data, error } = await client.rpc('get_membership_approval_context', args)
  if (error) throw error
  return parseMembershipApprovalContext(data)
}
