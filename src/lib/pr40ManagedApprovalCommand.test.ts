import assert from 'node:assert/strict'
import test from 'node:test'
import { preparePr40ManagedApproval, type Pr40PendingRequest } from './pr40ManagedApprovalCommand.ts'

const request: Pr40PendingRequest = {
  id: 'request-1',
  project_id: 'project-from-db',
  requester_user_id: 'requester-from-db',
  status: 'pending',
}
const option = { type: 'revolut', label: 'My link', value: '@alice_22', priority: null, is_active: true }
function makeDeps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  return {
    calls,
    deps: {
      authenticatedActorId: async () => { calls.push('auth'); return 'authenticated-actor' },
      loadRequest: async (_id: string) => { calls.push('request'); return request },
      assertCanApprove: async (_projectId: string, _actorId: string) => { calls.push('authorize') },
      loadMember: async (_projectId: string, userId: string) => { calls.push('member:' + userId); return null },
      loadUserOptions: async (userId: string) => { calls.push('options:' + userId); return [option] },
      loadMemberOptions: async (_participantId: string) => { calls.push('existing'); return [] },
      ...overrides,
    },
  }
}

test('PR40 command derives requester and actor from server-resolved data', async () => {
  const { deps, calls } = makeDeps()
  const command = await preparePr40ManagedApproval('request-1', deps)
  assert.equal(command.p_actor_user_id, 'authenticated-actor')
  assert.equal(command.p_project_id, 'project-from-db')
  assert.equal(command.p_request_id, 'request-1')
  assert.deepEqual(command.p_validated_options, [{
    type: 'revolut',
    label: 'My link',
    value: 'https://revolut.me/alice_22',
    priority: 1,
  }])
  assert.deepEqual(calls, ['auth', 'request', 'authorize', 'member:requester-from-db', 'options:requester-from-db'])
})

test('PR40 command fails before loading data for unauthenticated actor', async () => {
  const { deps, calls } = makeDeps({ authenticatedActorId: async () => null })
  await assert.rejects(preparePr40ManagedApproval('request-1', deps), /signed in/)
  assert.deepEqual(calls, [])
})

test('PR40 command blocks rejected request without accessing payment options', async () => {
  const { deps, calls } = makeDeps({ loadRequest: async () => ({ ...request, status: 'rejected' }) })
  await assert.rejects(preparePr40ManagedApproval('request-1', deps), /not pending/)
  assert.deepEqual(calls, ['auth'])
})

test('PR40 command rejects inconsistent request identity', async () => {
  const { deps } = makeDeps({ loadRequest: async () => ({ ...request, id: 'other' }) })
  await assert.rejects(preparePr40ManagedApproval('request-1', deps), /not found/)
})

test('PR40 command validates and deduplicates canonical options from requester', async () => {
  const { deps } = makeDeps({
    loadUserOptions: async () => [
      option,
      { ...option, value: 'https://revolut.me/alice_22' },
      { ...option, value: 'http://invalid.example' },
    ],
  })
  const command = await preparePr40ManagedApproval('request-1', deps)
  assert.equal(command.p_validated_options.length, 1)
})

test('PR40 command excludes already-linked normalized payment destinations', async () => {
  const { deps } = makeDeps({
    loadMember: async () => ({ id: 'membership-existing', left_at: '2026-01-01T00:00:00Z' }),
    loadMemberOptions: async () => [{ type: 'revolut', value: 'https://revolut.me/alice_22' }],
  })
  const command = await preparePr40ManagedApproval('request-1', deps)
  assert.deepEqual(command.p_validated_options, [])
})

test('PR40 command blocks unauthorized manager before reading recipient information', async () => {
  const { deps, calls } = makeDeps({ assertCanApprove: async () => { throw new Error('Not authorized') } })
  await assert.rejects(preparePr40ManagedApproval('request-1', deps), /Not authorized/)
  assert.deepEqual(calls, ['auth', 'request'])
})
