import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { deriveProjectSuccessPath, type SuccessContext, type SuccessViewer } from './projectSuccessPath.ts'
import { countConfirmedParticipants } from './projectDateSelection.ts'

const viewer: SuccessViewer = { isParticipant: true, canManage: false, canPay: false }
const manager = { ...viewer, canManage: true }
function context(changes: Partial<SuccessContext> = {}): SuccessContext {
  return {
    isCanceled: false, isFinalized: false, financeMode: 'none', confirmedParticipants: 6,
    minParticipants: 6, capacityAvailable: true, joinsAllowed: true, managedFinanceReady: false,
    date: { selecting: false, votingOpen: false, hasOptions: true, awaitingOrganizer: false,
      viewerResponded: false, viewerNeedsConfirmation: false, missingResponses: 0, awaitingAttendance: 0 },
    ...changes,
  }
}
function selecting(changes: Partial<SuccessContext['date']> = {}) {
  return context({ date: { ...context().date, selecting: true, votingOpen: true, missingResponses: 3, ...changes } })
}
const derive = (input = context(), actor = viewer) => deriveProjectSuccessPath(input, actor)

test('1. fixed date, minimum met, no finance: ready', () => {
  const result = derive()
  assert.equal(result.ready, true)
  assert.equal(result.health, 'ready')
  assert.equal(result.nextAction, null)
})
test('2. incomplete personal availability: choose dates', () => assert.equal(derive(selecting()).nextAction, 'choose_dates'))
test('3. responded viewer waits on other date responses', () => {
  const result = derive(selecting({ viewerResponded: true }))
  assert.equal(result.nextAction, null)
  assert.equal(result.waitingOn.dates, 3)
})
test('4. persisted Date Finder tie: manager resolves', () => {
  const result = derive(selecting({ votingOpen: false, awaitingOrganizer: true }), manager)
  assert.equal(result.nextAction, 'resolve_date')
  assert.equal(result.health, 'blocked')
})
test('5. final-date attendance requirement: confirm attendance', () => {
  assert.equal(derive(context({ date: { ...context().date, viewerNeedsConfirmation: true } })).nextAction, 'confirm_attendance')
})
test('6. below minimum: manager invites', () => assert.equal(derive(context({ confirmedParticipants: 4 }), manager).nextAction, 'invite_people'))
test('7. below minimum: participant waits, no invite CTA', () => {
  const result = derive(context({ confirmedParticipants: 4 }))
  assert.equal(result.nextAction, null)
  assert.equal(result.waitingOn.participants, 2)
})
test('8. exact minimum completes participant gate', () => {
  assert.deepEqual(derive().visibleStages.find(stage => stage.id === 'participants'), { id: 'participants', state: 'complete' })
})
test('9. capacity prevents invite', () => {
  const result = derive(context({ confirmedParticipants: 4, capacityAvailable: false }), manager)
  assert.equal(result.nextAction, null)
  assert.equal(result.health, 'blocked')
})
test('10. finance none omits Finance from every output', () => {
  const result = derive(context(), { ...manager, canPay: true })
  assert.ok(!JSON.stringify(result).includes('finance'))
})
test('11. managed finance ready completes Finance', () => {
  const result = derive(context({ financeMode: 'managed', managedFinanceReady: true }))
  assert.equal(result.ready, true)
  assert.deepEqual(result.visibleStages.find(stage => stage.id === 'finance'), { id: 'finance', state: 'complete' })
})
test('12. managed incomplete finance blocks; eligible payer gets existing payment destination', () => {
  const result = derive(context({ financeMode: 'managed' }), { ...viewer, canPay: true })
  assert.equal(result.ready, false)
  assert.deepEqual(result.blockers, [{ type: 'finance' }])
  assert.equal(result.nextAction, 'review_payment')
})
test('13. optional Extras cannot affect the normalized model', () => {
  const input = { ...context(), extras: [{ joined: false, amount_cents: 1000 }] }
  assert.deepEqual(derive(input), derive())
})
test('14. ordinary poll vote thresholds cannot block readiness', () => {
  const input = { ...context(), polls: [{ required_votes: 10, votes: 0 }] }
  assert.deepEqual(derive(input), derive())
})
for (const scenario of ['15. unresolved required poll', '16. personal required vote', '17. waiting on required votes']) {
  test(scenario, { skip: 'Not applicable: polls.required_votes is a vote threshold; no persisted required/optional distinction exists.' }, () => {})
}
test('18. canceled/aborted snapshot suppresses every action and readiness', () => {
  const result = derive({ ...selecting(), isCanceled: true }, manager)
  assert.equal(result.stage, 'canceled')
  assert.equal(result.nextAction, null)
  assert.equal(result.ready, false)
  assert.deepEqual(result.blockers, [])
})
test('19. existing finalized lifecycle suppresses stale actions without claiming event completion', () => {
  const result = derive({ ...selecting(), isFinalized: true }, manager)
  assert.equal(result.stage, 'finalized')
  assert.equal(result.nextAction, null)
  assert.equal(result.ready, false)
})
test('20. personal requirement outranks organizer participant issue', () => {
  assert.equal(derive({ ...selecting(), confirmedParticipants: 2 }, manager).nextAction, 'choose_dates')
})
test('21. global priority: date tie, then participants, then Finance', () => {
  const input = { ...selecting({ votingOpen: false, awaitingOrganizer: true }), financeMode: 'managed', confirmedParticipants: 2 }
  assert.equal(derive(input, manager).nextAction, 'resolve_date')
  input.date = context().date
  assert.equal(derive(input, manager).nextAction, 'invite_people')
  input.confirmedParticipants = 6
  assert.equal(derive(input, manager).nextAction, 'review_finance')
})
test('22. historical financial data ignored for none', () => {
  const input = { ...context(), payments: [{ is_counted: false }], managedFinanceReady: false }
  assert.deepEqual(derive(input), derive())
})
test('23. absent optional features and minimum are safe', () => {
  assert.equal(derive(context({ minParticipants: undefined })).ready, true)
  assert.equal(derive(context({ minParticipants: null })).ready, true)
})
test('24. repeated derivation is stable and does not mutate context', () => {
  const input = selecting()
  const before = structuredClone(input)
  assert.deepEqual(derive(input), derive(input))
  assert.deepEqual(input, before)
})
test('25. observer/nonmember never receives a personal action', () => {
  assert.equal(derive(selecting(), { ...viewer, isParticipant: false }).nextAction, null)
})
test('26. existing attendance helper excludes MAYBE, observer, cannot attend and pending', () => {
  const confirmedParticipants = countConfirmedParticipants(['confirmed', 'awaiting_confirmation', 'observer', 'cannot_attend', 'unconfirmed', 'pending_date_selection']
    .map(attendance_status => ({ attendance_status })))
  assert.equal(derive(context({ confirmedParticipants })).ready, false)
  assert.equal(confirmedParticipants, 1)
})
test('27. no manual date resolution before persisted tie state', () => {
  assert.equal(derive(selecting({ viewerResponded: true }), manager).nextAction, null)
})
test('28. unavailable join flow prevents invite', () => {
  assert.equal(derive(context({ confirmedParticipants: 2, joinsAllowed: false }), manager).nextAction, null)
})
test('29. no availability action when no date options exist', () => assert.equal(derive(selecting({ hasOptions: false })).nextAction, null))
test('30. confirmed minimum permits readiness while extra attendance responses remain informational', () => {
  const result = derive(context({ date: { ...context().date, awaitingAttendance: 2 } }))
  assert.equal(result.ready, true)
  assert.equal(result.waitingOn.attendance, 2)
})
test('31. canceled wins over finalized', () => assert.equal(derive(context({ isCanceled: true, isFinalized: true })).stage, 'canceled'))
test('32. Finance cannot suggest payment while Date Finder or minimum blocks it', () => {
  const actor = { ...viewer, canPay: true }
  assert.equal(derive({ ...selecting({ viewerResponded: true }), financeMode: 'managed' }, actor).nextAction, null)
  assert.equal(derive(context({ financeMode: 'managed', confirmedParticipants: 2 }), actor).nextAction, null)
})
test('33. full membership while choosing dates is not a hard participation blocker', () => {
  const result = derive({ ...selecting(), confirmedParticipants: 0, capacityAvailable: false })
  assert.equal(result.health, 'needs_attention')
  assert.equal(result.nextAction, 'choose_dates')
})
test('34. awaiting confirmations at capacity remain a waiting state', () => {
  const result = derive(context({ confirmedParticipants: 2, capacityAvailable: false,
    date: { ...context().date, awaitingAttendance: 3 } }))
  assert.equal(result.health, 'on_track')
})

// Render the actual component with the repository's existing TypeScript/React test harness.
const nodeRequire = createRequire(import.meta.url)
const componentSource = readFileSync(new URL('../components/Project/ProjectSuccessOverview.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(componentSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  fileName: 'ProjectSuccessOverview.tsx',
}).outputText
const moduleObject = { exports: {} as { ProjectSuccessOverview: React.ComponentType<{ model: ReturnType<typeof derive>; projectId: string }> } }
new Function('require', 'module', 'exports', code)(nodeRequire, moduleObject, moduleObject.exports)
const render = (input = context(), actor = viewer) => renderToStaticMarkup(createElement(moduleObject.exports.ProjectSuccessOverview, { model: derive(input, actor), projectId: 'fixture' }))

test('UI: relevant stages, skipped stages, ready positive state and no fake CTA', () => {
  const html = render()
  for (const label of ['Date', 'Participants', 'Ready', 'Project ready', 'Complete']) assert.ok(html.includes(label))
  for (const label of ['Finance', 'Decisions', 'Preparation', 'Setup', '<a ']) assert.ok(!html.includes(label))
})
test('UI: exactly one next action and Date Finder anchor', () => {
  const html = render({ ...selecting(), confirmedParticipants: 2 }, manager)
  assert.equal((html.match(/<a /g) ?? []).length, 1)
  assert.equal((html.match(/>Next action</g) ?? []).length, 1)
  assert.ok(html.includes('href="#project-date-finder"'))
  assert.ok(html.includes('aria-current="step"'))
})
test('UI: participant action uses existing Collab tab route', () => assert.ok(render(context({ confirmedParticipants: 2 }), manager).includes('href="/project/fixture?tab=people"')))
test('UI: managed Finance and existing Payments tab destination', () => {
  const html = render(context({ financeMode: 'managed' }), manager)
  assert.ok(html.includes('Finance'))
  assert.ok(html.includes('href="/project/fixture?tab=payments"'))
  assert.equal((html.match(/<a /g) ?? []).length, 1)
})
test('UI: canceled and finalized hide actionable links and stale blockers', () => {
  for (const state of [{ isCanceled: true }, { isFinalized: true }]) {
    const html = render({ ...selecting(), ...state }, manager)
    assert.ok(!html.includes('<a '))
    assert.ok(!html.includes('Still needed'))
    assert.ok(!html.includes('Project ready'))
  }
})
test('UI: rendering is stable with no clock/browser-dependent inference', () => {
  assert.equal(render(selecting()), render(selecting()))
  assert.doesNotMatch(componentSource, /Date\.now|new Date|Math\.random|window\.|useEffect/)
})

// Evaluate the actual page JSX guard, then render the real Date Finder. Only I/O
// and unrelated leaf controls are stubbed; no production actions are invoked.
const pageSource = readFileSync(new URL('../app/project/[id]/page.tsx', import.meta.url), 'utf8')
const pageAst = ts.createSourceFile('page.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let dateFinderExpression = ''
function findDateFinder(node: ts.Node) {
  if (ts.isJsxExpression(node) && node.expression?.getText(pageAst).startsWith('projectDateData &&')
    && node.expression.getText(pageAst).includes('<ProjectDateFinder')) {
    dateFinderExpression = node.expression.getText(pageAst)
  }
  ts.forEachChild(node, findDateFinder)
}
findDateFinder(pageAst)
assert.ok(dateFinderExpression, 'Actual page Date Finder expression must be found')
const compileFixture = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  fileName: 'fixture.tsx',
}).outputText
const dateSelection = await import('./projectDateSelection.ts')
const dateStrings = await import('./projectDateStrings.ts')
const dateComponentExports: Record<string, React.ComponentType<Record<string, unknown>>> = {}
const dateRequire = (name: string) => {
  if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) }
  if (name === '@/app/project/[id]/actions') return new Proxy({}, { get: () => () => { throw new Error('Unexpected action invocation') } })
  if (name === '@/components/Project/LeaveProjectButton') return { LeaveProjectButton: () => createElement('button', {}, 'Leave project') }
  if (name === '@/components/ui/button') return { Button: ({ variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => { void variant; return createElement('button', props) } }
  if (name === '@/lib/projectDateSelection') return dateSelection
  if (name === '@/lib/projectDateStrings') return dateStrings
  return nodeRequire(name)
}
new Function('require', 'exports', compileFixture(readFileSync(new URL('../components/Project/ProjectDateFinder.tsx', import.meta.url), 'utf8')))(dateRequire, dateComponentExports)
const pageFixture: { render?: (...args: unknown[]) => React.ReactNode } = {}
new Function('require', 'exports', 'ProjectDateFinder', compileFixture(`
export function render(projectDateData, isAborted, isFinalized, viewerIsCollector = false) {
  const projectId = 'fixture', uid = 'user', isMeParticipant = true, projectDateLocale = 'en'
  return (${dateFinderExpression})
}`))(nodeRequire, pageFixture, dateComponentExports.ProjectDateFinder)
const fixedDateFixture = {
  available: true, dateMode: 'fixed', selectionStatus: 'confirmation_open',
  votingDeadlineAt: null, suggestionsCloseAt: null, selectedDateOptionId: 'selected',
  confirmationDeadlineAt: '2099-01-01T00:00:00Z', eventStartAt: '2099-02-01T00:00:00Z', eventEndAt: null,
  minParticipants: 2, maxParticipants: 10, options: [], respondedCount: 2, memberCount: 3,
  confirmedCount: 2, awaitingCount: 1, cannotAttendCount: 0, missingResponseNames: [], awaitingNames: ['Member'],
  viewerAttendanceStatus: 'confirmed', viewerTaskComplete: true, unreadNotificationCount: 0,
}
function renderPageDate(status = 'confirmed', finalized = true, canceled = false, manager = false, overrides = {}) {
  return renderToStaticMarkup(pageFixture.render!({ ...fixedDateFixture, viewerAttendanceStatus: status, ...overrides }, canceled, finalized, manager))
}

test('P1: active Date Finder still renders its availability path', () => {
  assert.match(renderPageDate('pending_date_selection', false, false, false, {
    dateMode: 'selecting', selectionStatus: 'open', selectedDateOptionId: null, viewerTaskComplete: false,
  }), /Choose dates/)
})
test('P1: canceled or aborted page suppresses all Date Finder mutations even when finalized', () => {
  for (const finalized of [false, true]) assert.equal(renderPageDate('awaiting_confirmation', finalized, true, true), '')
})
test('P1: finalized awaiting confirmation keeps the real confirmation controls', () => {
  const html = renderPageDate('awaiting_confirmation')
  assert.match(html, /Yes, I will attend/)
  assert.match(html, /No, I cannot attend/)
  assert.doesNotMatch(html, /Join this project/)
})
for (const status of ['unconfirmed', 'cannot_attend', 'observer']) {
  test(`P1: finalized ${status} keeps the real late-confirm/rejoin control`, () => {
    const html = renderPageDate(status)
    assert.match(html, /Join this project/)
    assert.doesNotMatch(html, /Yes, I will attend/)
  })
}
test('P1: finalized confirmed participant sees date information without attendance mutation prompts', () => {
  const html = renderPageDate()
  assert.match(html, /Project date/)
  assert.doesNotMatch(html, /Join this project|Yes, I will attend|Add time|Save deadline|Send reminder/)
})
test('P1: finalized fixed-date manager cannot reopen voting, suggest/remove/select dates', () => {
  const html = renderPageDate('confirmed', true, false, true)
  assert.equal(html, renderPageDate('confirmed', false, false, true))
  assert.doesNotMatch(html, /Suggest another date|Remove date|Select this date|Choose dates/)
  // These existing manager actions have no finalization prohibition in the server rules.
  assert.match(html, /Add time/)
  assert.match(html, /Save deadline/)
})
test('P1: finalized late confirmation still respects existing capacity disablement', () => {
  assert.match(renderPageDate('observer', true, false, false, { confirmedCount: 10 }), /<button[^>]*disabled=""[^>]*>Join this project/)
})
test('P1: finalized Date Finder coexists with non-actionable Success Path', () => {
  const successHtml = render(context({ isFinalized: true }), manager)
  assert.match(successHtml, /Project finalized/)
  assert.doesNotMatch(successHtml, /<a |Next action/)
  assert.match(renderPageDate('awaiting_confirmation'), /Yes, I will attend/)
})
test('P1: normal fixed-date ready Success Path and date information remain unchanged', () => {
  assert.match(render(), /Project ready/)
  assert.match(renderPageDate('confirmed', false), /Project date/)
  assert.equal(derive().nextAction, null)
})
