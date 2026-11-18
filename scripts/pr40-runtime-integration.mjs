import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  executeDirectMembershipRpc,
  executeManagedApprovalRpc,
  executeMembershipApprovalContextRpc,
} from '../src/lib/atomicMembershipRpc.ts'

const url = process.env.PR40_POSTGREST_URL ?? 'http://127.0.0.1:3001'
const secret = process.env.PR40_JWT_SECRET ?? 'pr40-local-integration-secret-32-bytes-minimum'
const base64url = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = role => {
  const header = base64url({ alg: 'HS256', typ: 'JWT' })
  const payload = base64url({ role, exp: Math.floor(Date.now() / 1000) + 3600 })
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch(url)
    if (response.ok) break
  } catch {
    // PostgREST is still starting.
  }
  if (attempt === 59) throw new Error('PostgREST did not become ready')
  await new Promise(resolve => setTimeout(resolve, 250))
}

// A standalone PostgREST container serves at `/`; Supabase projects expose the
// same API at `/rest/v1`. Keep the real Supabase client and rewrite only that
// local test prefix.
const postgrestFetch = (input, init) => fetch(String(input).replace('/rest/v1', ''), init)
const service = createClient(url, token('service_role'), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: postgrestFetch },
})
const anon = createClient(url, token('anon'), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: postgrestFetch },
})
const serviceToken = token('service_role')
const probe = await fetch(`${url}/users?select=id&limit=1`, {
  headers: { Authorization: `Bearer ${serviceToken}`, apikey: serviceToken },
})
if (!probe.ok) throw new Error(`PostgREST authenticated probe failed: ${probe.status} ${await probe.text()}`)
const describeError = error => error instanceof Error
  ? `${error.name}: ${error.message}${error.cause ? `; cause=${String(error.cause)}` : ''}`
  : JSON.stringify(error)

const ids = {
  owner: '90000000-0000-4000-8000-000000000001',
  directUser: '90000000-0000-4000-8000-000000000002',
  managedUser: '90000000-0000-4000-8000-000000000003',
  directProject: '91000000-0000-4000-8000-000000000001',
  managedProject: '91000000-0000-4000-8000-000000000002',
  directOwner: '92000000-0000-4000-8000-000000000001',
  managedOwner: '92000000-0000-4000-8000-000000000002',
  request: '93000000-0000-4000-8000-000000000001',
  source: '94000000-0000-4000-8000-000000000001',
  notification: '95000000-0000-4000-8000-000000000001',
}

const insert = async (table, rows) => {
  const { error } = await service.from(table).insert(rows).select()
  if (error) throw new Error(`${table} insert failed: ${describeError(error)}`)
}
await insert('users', [
  { id: ids.owner, email: 'runtime-owner@example.invalid', display_name: 'Runtime Owner' },
  { id: ids.directUser, email: 'runtime-direct@example.invalid', display_name: 'Runtime Direct' },
  { id: ids.managedUser, email: 'runtime-managed@example.invalid', display_name: 'Runtime Managed' },
])
await insert('projects', [
  { id: ids.directProject, title: 'Runtime direct', status: 'pending', created_by: ids.owner, max_participants: 2, is_public: true, finance_mode: 'none' },
  { id: ids.managedProject, title: 'Runtime managed', status: 'pending', created_by: ids.owner, max_participants: 2, is_public: false, finance_mode: 'managed' },
])
await insert('participants', [
  { id: ids.directOwner, project_id: ids.directProject, user_id: ids.owner, role: 'organizer' },
  { id: ids.managedOwner, project_id: ids.managedProject, user_id: ids.owner, role: 'organizer' },
])
{
  const { error } = await service.from('projects').update({ collector_participant_id: ids.managedOwner }).eq('id', ids.managedProject)
  if (error) throw new Error(`project collector update failed: ${describeError(error)}`)
}
await insert('join_requests', {
  id: ids.request, project_id: ids.managedProject, requester_user_id: ids.managedUser, status: 'pending',
})
await insert('user_payment_options', {
  id: ids.source, user_id: ids.managedUser, type: 'revolut', label: 'Runtime managed', value: '@runtime-managed', priority: 1, is_active: true,
})
await insert('project_notifications', {
  id: ids.notification, project_id: ids.managedProject, recipient_user_id: ids.owner,
  notification_type: 'join_request_pending', title: 'Join', body: 'Pending',
  metadata: { join_request_id: ids.request }, dedupe_key: 'runtime-managed-join',
})

const direct = await executeDirectMembershipRpc(service, {
  p_project_id: ids.directProject,
  p_actor_user_id: ids.directUser,
  p_user_id: ids.directUser,
  p_join_request_id: null,
})
assert.equal(direct.outcome, 'reserved')
assert.equal(direct.membership_changed, true)

const approvalContext = await executeMembershipApprovalContextRpc(service, {
  p_request_id: ids.request, p_actor_user_id: ids.owner,
})
assert.deepEqual(approvalContext, {
  request_id: ids.request, project_id: ids.managedProject,
  requester_user_id: ids.managedUser, status: 'pending',
  finance_mode: 'managed', actor_user_id: ids.owner,
})
const managed = await executeManagedApprovalRpc(service, {
  p_project_id: approvalContext.project_id,
  p_request_id: approvalContext.request_id,
  p_actor_user_id: approvalContext.actor_user_id,
  p_validated_options: [{
    type: 'revolut', label: 'Runtime managed', value: 'https://revolut.me/runtime-managed', priority: 1,
    source_option_id: ids.source, source_value: '@runtime-managed', source_label: 'Runtime managed', source_priority: 1,
  }],
})
assert.equal(managed.outcome, 'reserved')
assert.equal(managed.options_written, 1)

const [{ data: request }, { data: notification }, { data: member }, { data: option }] = await Promise.all([
  service.from('join_requests').select('status,participant_id').eq('id', ids.request).single(),
  service.from('project_notifications').select('read_at').eq('id', ids.notification).single(),
  service.from('participants').select('id,left_at').eq('project_id', ids.managedProject).eq('user_id', ids.managedUser).single(),
  service.from('payment_options').select('type,value').eq('participant_id', managed.participant_id).single(),
])
assert.equal(request?.status, 'approved')
assert.equal(request?.participant_id, managed.participant_id)
assert.ok(notification?.read_at)
assert.equal(member?.left_at, null)
assert.deepEqual(option, { type: 'revolut', value: 'https://revolut.me/runtime-managed' })

const denied = await executeDirectMembershipRpc(anon, {
  p_project_id: ids.directProject,
  p_actor_user_id: ids.directUser,
  p_user_id: ids.directUser,
  p_join_request_id: null,
}).then(() => null, error => error)
assert.ok(denied, 'anon unexpectedly executed the service-only RPC')

console.log('PR40 Supabase JS -> PostgREST -> PostgreSQL runtime integration PASS')
