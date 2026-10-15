import 'server-only'
import {
  createProjectInviteCapability,
  verifyProjectInviteCapability,
} from './projectInviteCapability'

function getInviteSecret() {
  const secret = process.env.PROJECT_INVITE_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Private invitation signing is unavailable')
  return secret
}

export function createServerProjectInviteCapability(projectId: string) {
  return createProjectInviteCapability({ projectId, secret: getInviteSecret() })
}

export function verifyServerProjectInviteCapability(projectId: string, token: string | null | undefined) {
  try {
    return verifyProjectInviteCapability({ projectId, token, secret: getInviteSecret() })
  } catch {
    return false
  }
}
