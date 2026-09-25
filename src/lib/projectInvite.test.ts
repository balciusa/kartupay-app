import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildProjectLoginHref,
  getProjectInviteStrings,
  getSafeProjectReturnPath,
  isProjectCanceled,
} from './projectInvite.ts'

const nodeRequire = createRequire(import.meta.url)
const pageSource = readFileSync(new URL('../app/project/[id]/page.tsx', import.meta.url), 'utf8')
const loginPageSource = readFileSync(new URL('../app/(auth)/login/page.tsx', import.meta.url), 'utf8')
const loginFormSource = readFileSync(new URL('../app/(auth)/login/LoginForm.tsx', import.meta.url), 'utf8')
const callbackSource = readFileSync(new URL('../app/auth/callback/route.ts', import.meta.url), 'utf8')
const inviteComponentSource = readFileSync(new URL('../components/Project/PrivateProjectInvite.tsx', import.meta.url), 'utf8')

function compile(source: string, fileName: string) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName,
  }).outputText
}

const joinButtonExports = {} as {
  JoinButton: typeof import('../components/Project/JoinButton').JoinButton
}
new Function('require', 'exports', compile(
  readFileSync(new URL('../components/Project/JoinButton.tsx', import.meta.url), 'utf8'),
  'JoinButton.tsx'
))((name: string) => {
  if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) }
  if (name === '@/app/project/[id]/actions') {
    return { requestJoinFromForm: async () => ({ ok: true }), cancelJoinRequestFromForm: async () => ({ ok: true }) }
  }
  if (name === '@/lib/projectInvite') return nodeRequire('./projectInvite.ts')
  return nodeRequire(name)
}, joinButtonExports)

const inviteComponentExports = {} as {
  PrivateProjectInvite: typeof import('../components/Project/PrivateProjectInvite').PrivateProjectInvite
}
new Function('require', 'exports', compile(inviteComponentSource, 'PrivateProjectInvite.tsx'))((name: string) => {
  if (name === 'next/link') {
    function LinkStub({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
      return createElement('a', { href, ...props }, children)
    }
    return { __esModule: true, default: LinkStub }
  }
  if (name === 'lucide-react') {
    return { CalendarDays: () => createElement('span'), MapPin: () => createElement('span') }
  }
  if (name === '@/components/ui/button') {
    return {
      Button: ({ asChild, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) =>
        asChild ? children : createElement('button', props, children),
    }
  }
  if (name === '@/components/Project/JoinButton') return joinButtonExports
  if (name === '@/lib/projectInvite') return nodeRequire('./projectInvite.ts')
  return nodeRequire(name)
}, inviteComponentExports)

function renderInvite(overrides: Partial<Parameters<typeof inviteComponentExports.PrivateProjectInvite>[0]> = {}) {
  return renderToStaticMarkup(createElement(inviteComponentExports.PrivateProjectInvite, {
    projectId: 'private-project',
    title: 'Weekend trip',
    description: 'A safe short description',
    eventDate: 'Oct 3, 2026, 10:00 AM',
    location: 'Vilnius',
    isAuthenticated: true,
    canJoinNow: false,
    requestStatus: null,
    isCanceled: false,
    locale: 'en',
    ...overrides,
  }))
}

test('private anonymous viewer gets invite preview and canonical sign-in return link', () => {
  const html = renderInvite({ isAuthenticated: false })
  assert.match(html, /Private project/)
  assert.match(html, /You&#x27;ve been invited to join/)
  assert.match(html, /Weekend trip/)
  assert.match(html, /Sign in to continue/)
  assert.match(html, /href="\/login\?redirect=%2Fproject%2Fprivate-project"/)
  assert.doesNotMatch(html, /Request to join|Join project|ProjectTabs/)
})

test('managed nonmember can request access and pending request can be canceled', () => {
  const available = renderInvite()
  assert.match(available, />Request to join<\/button>/)

  const pending = renderInvite({ requestStatus: 'pending' })
  assert.match(pending, /Request sent/)
  assert.match(pending, /Waiting for approval/)
  assert.match(pending, /Cancel request/)
})

test('rejected and canceled managed requests can be resubmitted', () => {
  for (const requestStatus of ['rejected', 'canceled']) {
    const html = renderInvite({ requestStatus })
    assert.match(html, />Request to join<\/button>/)
    assert.doesNotMatch(html, /Waiting for approval/)
  }
})

test('finance-none nonmember gets direct Join project action', () => {
  const html = renderInvite({ canJoinNow: true })
  assert.match(html, />Join project<\/button>/)
  assert.doesNotMatch(html, /Request to join/)
})

test('canceled private project is inactive and has no join or sign-in action', () => {
  const html = renderInvite({ isCanceled: true, isAuthenticated: false })
  assert.match(html, /This project is no longer active/)
  assert.doesNotMatch(html, /<button|href="\/login/)
})

test('closed/finalized projects keep their existing late-join surface', () => {
  const html = renderInvite({ canJoinNow: true, isCanceled: false })
  assert.match(html, />Join project<\/button>/)
})

test('Lithuanian invite and join UI contains no English action copy', () => {
  const html = renderInvite({ locale: 'lt', requestStatus: 'pending' })
  assert.match(html, /Privatus projektas/)
  assert.match(html, /Esate pakviesti prisijungti/)
  assert.match(html, /Prašymas išsiųstas/)
  assert.match(html, /Laukiama patvirtinimo/)
  assert.match(html, /Atšaukti prašymą/)
  assert.doesNotMatch(html, /Private project|Request sent|Waiting for approval|Cancel request/)
})

test('invite surface contains only selected preview and onboarding fields', () => {
  const html = renderInvite()
  for (const forbidden of ['Participants', 'Payments', 'Chat', 'Polls', 'Extras', 'Date Finder', 'Activity', 'Admin', 'Success Path']) {
    assert.doesNotMatch(html, new RegExp(forbidden, 'i'))
  }
  assert.doesNotMatch(inviteComponentSource, /ProjectTabs|Participants|Payments|Chat|Voting|ExtrasTab|ActivityLog|AdminPanel/)
})

test('private nonmember returns before full and related project data queries', () => {
  const inviteReturn = pageSource.indexOf('<PrivateProjectInvite\n          {...inviteProps}')
  const fullProjectLoad = pageSource.indexOf('// Public viewers and active private-project participants may load the full page record.')
  const relatedDataLoad = pageSource.indexOf('// Fetch all related data in parallel')
  assert.ok(inviteReturn > 0 && inviteReturn < fullProjectLoad && fullProjectLoad < relatedDataLoad)

  const previewLoad = pageSource.slice(
    pageSource.indexOf('// Load only deliberately public invite fields'),
    pageSource.indexOf('const uid = await getCurrentUserId()')
  )
  for (const protectedField of [
    'total_cents', 'collector_participant_id', 'bundle_size', 'event_location_address',
    'date_voting_deadline_at', 'selected_date_option_id', 'confirmation_deadline_at',
  ]) {
    assert.doesNotMatch(previewLoad, new RegExp(protectedField))
  }

  for (const protectedQuery of [
    ".from('messages')", ".from('polls')", ".from('payments')", ".from('extras')",
    ".select('id, user_id, role, short_code", 'loadProjectDateFinderData', ".from('activity_logs')",
  ]) {
    const queryIndex = pageSource.indexOf(protectedQuery, pageSource.indexOf('export default async function ProjectPage'))
    assert.ok(queryIndex === -1 || queryIndex > relatedDataLoad, `${protectedQuery} must stay after the invite return`)
  }
})

test('only active membership unlocks the full private page', () => {
  const membershipStart = pageSource.indexOf(".from('participants')", pageSource.indexOf("if (project.is_public !== true)"))
  const membershipEnd = pageSource.indexOf('.limit(1)', membershipStart)
  const membershipQuery = pageSource.slice(membershipStart, membershipEnd)
  assert.match(membershipQuery, /\.is\('left_at', null\)/)
  assert.match(pageSource, /if \(!privateMembership\?\.length\)/)
})

test('public projects and active private participants continue to the normal page', () => {
  assert.match(pageSource, /if \(project\.is_public !== true\)/)
  assert.match(pageSource, /<ProjectTabs/)
  assert.match(pageSource, /isActiveParticipant: isMemberActive/)
})

test('auth return paths accept only canonical internal project URLs', () => {
  assert.equal(getSafeProjectReturnPath('/project/abc-123'), '/project/abc-123')
  for (const unsafe of [
    'https://evil.example/project/abc', '//evil.example/project/abc', '/project/abc?tab=admin',
    '/project/abc#payments', '/settings', '/project/abc/participants', '/project/%2F%2Fevil.example',
  ]) {
    assert.equal(getSafeProjectReturnPath(unsafe), '/')
  }
  assert.equal(buildProjectLoginHref('abc-123'), '/login?redirect=%2Fproject%2Fabc-123')
  assert.match(loginPageSource, /getSafeProjectReturnPath\(redirect\)/)
  assert.match(loginFormSource, /window\.location\.assign\(redirectPath\)/)
  assert.match(loginFormSource, /callbackUrl\.searchParams\.set\('redirect', redirectPath\)/)
  assert.match(callbackSource, /getSafeProjectReturnPath\(url\.searchParams\.get\('redirect'\)\)/)
})

test('cancellation detection covers both spellings and timestamp fallbacks', () => {
  assert.equal(isProjectCanceled({ status: 'canceled' }), true)
  assert.equal(isProjectCanceled({ status: ' CANCELLED ' }), true)
  assert.equal(isProjectCanceled({ canceled_at: '2026-09-01' }), true)
  assert.equal(isProjectCanceled({ aborted_at: '2026-09-01' }), true)
  assert.equal(isProjectCanceled({ status: 'closed' }), false)
})

test('English and Lithuanian string sets cover every invite action', () => {
  const en = getProjectInviteStrings('en')
  const lt = getProjectInviteStrings('lt')
  assert.deepEqual(Object.keys(en), Object.keys(lt))
  assert.equal(en.requestToJoin, 'Request to join')
  assert.equal(lt.requestToJoin, 'Prašyti prisijungti')
})
