import { createHmac, timingSafeEqual } from 'node:crypto'

const TOKEN_VERSION = 'v1'
const PROJECT_ID = /^[A-Za-z0-9_-]+$/u
const TOKEN_SIGNATURE = /^[A-Za-z0-9_-]{43}$/u

function signature(projectId: string, expiresAt: number, secret: string) {
  return createHmac('sha256', secret)
    .update(`kartupay-private-invite:${TOKEN_VERSION}:${projectId}:${expiresAt}`)
    .digest('base64url')
}

export function createProjectInviteCapability({
  projectId,
  secret,
  now = Date.now(),
  lifetimeMs = 30 * 24 * 60 * 60 * 1000,
}: {
  projectId: string
  secret: string
  now?: number
  lifetimeMs?: number
}) {
  if (!PROJECT_ID.test(projectId) || !secret || lifetimeMs <= 0) {
    throw new Error('Private invitation capability cannot be created')
  }
  const expiresAt = Math.floor((now + lifetimeMs) / 1000)
  return `${TOKEN_VERSION}.${expiresAt}.${signature(projectId, expiresAt, secret)}`
}

export function verifyProjectInviteCapability({
  projectId,
  token,
  secret,
  now = Date.now(),
}: {
  projectId: string
  token: string | null | undefined
  secret: string
  now?: number
}) {
  if (!PROJECT_ID.test(projectId) || !token || !secret) return false
  const [version, rawExpiresAt, supplied] = token.split('.')
  if (version !== TOKEN_VERSION || !/^\d{10}$/u.test(rawExpiresAt) || !TOKEN_SIGNATURE.test(supplied ?? '')) {
    return false
  }
  const expiresAt = Number(rawExpiresAt)
  if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= now) return false
  const expected = signature(projectId, expiresAt, secret)
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

export function isInviteCapabilityTokenShape(value: string) {
  return /^v1\.\d{10}\.[A-Za-z0-9_-]{43}$/u.test(value)
}
