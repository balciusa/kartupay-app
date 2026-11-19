import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const adapter = readFileSync(
  new URL('./pr40ManagedApprovalServer.ts', import.meta.url), 'utf8'
)
const rpcAdapter = readFileSync(new URL('./atomicMembershipRpc.ts', import.meta.url), 'utf8')

test('PR40 server adapter is server-only and invokes the atomic RPC from an authorized context', () => {
  assert.match(adapter, /^import 'server-only'/)
  assert.match(adapter, /import \{ supabaseAdmin \} from '\.\/supabaseAdmin'/)
  assert.match(adapter, /executeManagedApprovalRpc\(supabaseAdmin, command\)/)
  assert.doesNotMatch(adapter, /getCurrentUserId/)
  assert.doesNotMatch(adapter, /\.from\('join_requests'\)/)
  assert.doesNotMatch(adapter, /\.from\('projects'\)/)
  assert.match(rpcAdapter, /client\.rpc\(functionName, args\)/)
  assert.match(rpcAdapter, /parseAtomicMembershipResult\(data\)/)
  assert.match(rpcAdapter, /client\.rpc\('get_membership_approval_context', args\)/)
  assert.match(rpcAdapter, /parseMembershipApprovalContext\(data\)/)
})

test('PR40 adapter consumes an already-authorized DB context before querying options', () => {
  assert.match(adapter, /preparePr40ManagedApprovalFromAuthorizedContext/)
  assert.match(adapter, /requester_user_id: context\.requester_user_id/)
  assert.match(adapter, /\.from\('user_payment_options'\)/)
  assert.match(adapter, /assertCanApprove: async \(\) => \{\}/)
  assert.match(adapter, /\.eq\('user_id', userId\)/)
  assert.match(adapter, /\.eq\('is_active', true\)/)
  assert.match(adapter, /\.from\('payment_options'\)/)
  assert.match(adapter, /\.eq\('participant_id', participantId\)/)
})

test('PR40 adapter passes only server-prepared payment source provenance', () => {
  assert.match(adapter, /preparePr40ManagedApprovalFromAuthorizedContext\(context\)/)
  assert.match(adapter, /loadUserOptions: async userId/)
  assert.match(adapter, /\.eq\('is_active', true\)/)
  assert.doesNotMatch(adapter, /requesterUserId:\s*string/)
})
