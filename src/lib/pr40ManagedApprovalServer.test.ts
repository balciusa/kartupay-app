import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const adapter = readFileSync(
  new URL('./pr40ManagedApprovalServer.ts', import.meta.url), 'utf8'
)

test('PR40 server adapter is server-only, reads session user and never calls RPC', () => {
  assert.match(adapter, /^import 'server-only'/)
  assert.match(adapter, /authenticatedActorId: getCurrentUserId/)
  assert.match(adapter, /import \{ getCurrentUserId \} from '\.\/supabaseServer'/)
  assert.match(adapter, /import \{ supabaseAdmin \} from '\.\/supabaseAdmin'/)
  assert.doesNotMatch(adapter, /supabaseAdmin\.rpc\(/)
})

test('PR40 adapter derives requester from stored request before querying options', () => {
  assert.match(adapter, /\.from\('join_requests'\)/)
  assert.match(adapter, /\.select\('id, project_id, requester_user_id, status'\)/)
  assert.match(adapter, /\.from\('user_payment_options'\)/)
  assert.match(adapter, /assertCanApprove: async \(projectId, actorId\)/)
  assert.match(adapter, /canManageProjectJoinRequests/)
  assert.match(adapter, /\.eq\('user_id', userId\)/)
  assert.match(adapter, /\.eq\('is_active', true\)/)
  assert.match(adapter, /\.from\('payment_options'\)/)
  assert.match(adapter, /\.eq\('participant_id', participantId\)/)
})
