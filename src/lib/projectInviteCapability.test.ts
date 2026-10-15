import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createProjectInviteCapability,
  verifyProjectInviteCapability,
} from './projectInviteCapability.ts'

const secret = 'test-only-private-invite-secret'
const now = Date.UTC(2026, 9, 15)

test('scoped invite capabilities verify only for their project before expiry', () => {
  const token = createProjectInviteCapability({ projectId: 'project-a', secret, now, lifetimeMs: 60_000 })
  assert.equal(verifyProjectInviteCapability({ projectId: 'project-a', token, secret, now: now + 1 }), true)
  assert.equal(verifyProjectInviteCapability({ projectId: 'project-b', token, secret, now: now + 1 }), false)
  assert.equal(verifyProjectInviteCapability({ projectId: 'project-a', token, secret, now: now + 60_000 }), false)
})

test('tampered and malformed invite capabilities fail closed', () => {
  const token = createProjectInviteCapability({ projectId: 'project-a', secret, now })
  assert.equal(verifyProjectInviteCapability({ projectId: 'project-a', token: `${token.slice(0, -1)}x`, secret, now }), false)
  assert.equal(verifyProjectInviteCapability({ projectId: 'project-a', token: 'not-a-token', secret, now }), false)
  assert.equal(verifyProjectInviteCapability({ projectId: 'project-a', token, secret: 'wrong-secret', now }), false)
})
