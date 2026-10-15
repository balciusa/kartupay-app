import type { ProjectDateLocale } from './projectDateStrings'

export const projectInviteStrings = {
  en: {
    privateProject: 'Private project',
    privateInvitation: 'Private invitation',
    detailsHidden: 'Project details are hidden until you open a valid invitation link and receive organizer approval.',
    invitedToJoin: "You've been invited to join",
    signInToContinue: 'Sign in to continue',
    signIn: 'Sign in',
    joinProject: 'Join project',
    requestToJoin: 'Request to join',
    requestSent: 'Request sent',
    waitingForApproval: 'Waiting for approval',
    waitingForApprovalHelp: 'Your request needs to be approved before you can access the project.',
    cancelRequest: 'Cancel request',
    submitting: 'Submitting...',
    inactiveProject: 'This project is no longer active.',
    date: 'Date',
    location: 'Location',
  },
  lt: {
    privateProject: 'Privatus projektas',
    privateInvitation: 'Privatus kvietimas',
    detailsHidden: 'Projekto informacija slepiama, kol neatidarote galiojančios kvietimo nuorodos ir organizatorius nepatvirtina prieigos.',
    invitedToJoin: 'Esate pakviesti prisijungti',
    signInToContinue: 'Prisijunkite, kad galėtumėte tęsti',
    signIn: 'Prisijungti',
    joinProject: 'Prisijungti prie projekto',
    requestToJoin: 'Prašyti prisijungti',
    requestSent: 'Prašymas išsiųstas',
    waitingForApproval: 'Laukiama patvirtinimo',
    waitingForApprovalHelp: 'Jūsų prašymas turi būti patvirtintas, kad galėtumėte pasiekti projektą.',
    cancelRequest: 'Atšaukti prašymą',
    submitting: 'Siunčiama...',
    inactiveProject: 'Šis projektas nebėra aktyvus.',
    date: 'Data',
    location: 'Vieta',
  },
} as const

export function getProjectInviteStrings(locale: ProjectDateLocale) {
  return projectInviteStrings[locale]
}

export function getSafeProjectReturnPath(value: string | string[] | null | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/'

  try {
    const parsed = new URL(candidate, 'https://kartupay.invalid')
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (
      parsed.origin !== 'https://kartupay.invalid' ||
      parsed.hash ||
      segments.length !== 2 ||
      segments[0] !== 'project' ||
      !/^[A-Za-z0-9_-]+$/.test(segments[1])
    ) {
      return '/'
    }
    if (parsed.searchParams.size === 0) return parsed.pathname
    const inviteValues = parsed.searchParams.getAll('invite')
    if (
      parsed.searchParams.size !== 1 ||
      inviteValues.length !== 1 ||
      !/^v1\.\d{10}\.[A-Za-z0-9_-]{43}$/u.test(inviteValues[0])
    ) {
      return '/'
    }
    return `${parsed.pathname}?invite=${encodeURIComponent(inviteValues[0])}`
  } catch {
    return '/'
  }
}

export function buildProjectLoginHref(projectId: string, inviteToken?: string | null) {
  const returnPath = `/project/${encodeURIComponent(projectId)}${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''}`
  return `/login?redirect=${encodeURIComponent(returnPath)}`
}

export function isProjectCanceled(project: {
  status?: string | null
  canceled_at?: string | null
  aborted_at?: string | null
}) {
  const status = String(project.status ?? '').trim().toLowerCase()
  return status === 'canceled' || status === 'cancelled' || !!project.canceled_at || !!project.aborted_at
}
