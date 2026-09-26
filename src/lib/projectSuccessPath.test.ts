import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { deriveProjectSuccessPath, type SuccessContext, type SuccessViewer } from './projectSuccessPath.ts'
import * as successStrings from './projectSuccessOverviewStrings.ts'
import type { ProjectDateLocale } from './projectDateStrings.ts'
import { countConfirmedParticipants } from './projectDateSelection.ts'

const viewer: SuccessViewer = { isParticipant: true, canManage: false, canPay: false }
const manager = { ...viewer, canManage: true }
function context(changes: Partial<SuccessContext> = {}): SuccessContext {
  return {
    isCanceled: false, isFinalized: false, financeMode: 'none', confirmedParticipants: 6,
    minParticipants: 6, capacityAvailable: true, joinsAllowed: true, managedFinanceReady: false,
    date: { selecting: false, votingOpen: false, hasOptions: true, allResponded: false, awaitingOrganizer: false,
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
test('27. manager can finalize before the deadline only after everyone responds', () => {
  assert.equal(derive(selecting({ viewerResponded: true, allResponded: false }), manager).nextAction, null)
  assert.equal(derive(selecting({ viewerResponded: true, allResponded: true, missingResponses: 0 }), manager).nextAction, 'finalize_date_early')
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
const moduleObject = { exports: {} as { ProjectSuccessOverview: React.ComponentType<{ model: ReturnType<typeof derive>; projectId: string; locale?: ProjectDateLocale }> } }
new Function('require', 'module', 'exports', code)((name: string) => name === '@/lib/projectSuccessOverviewStrings' ? successStrings : nodeRequire(name), moduleObject, moduleObject.exports)
const render = (input = context(), actor = viewer, locale: ProjectDateLocale = 'en') => renderToStaticMarkup(createElement(moduleObject.exports.ProjectSuccessOverview, { model: derive(input, actor), projectId: 'fixture', locale }))

test('UI: relevant stages, skipped stages, ready positive state and no fake CTA', () => {
  const html = render()
  for (const label of ['Date', 'Participants', 'Ready', 'Project ready', 'Complete']) assert.ok(html.includes(label))
  for (const label of ['Finance', 'Decisions', 'Preparation', 'Setup', '<a ']) assert.ok(!html.includes(label))
})
test('UI: exactly one next action and Date Finder anchor', () => {
  const html = render({ ...selecting(), confirmedParticipants: 2 }, manager)
  assert.equal((html.match(/<a /g) ?? []).length, 1)
  assert.equal((html.match(/>Project status</g) ?? []).length, 1)
  assert.ok(html.includes('href="#date-availability"'))
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

test('UI: all-responded manager gets one early-finalization link into Date Finder', () => {
  const html = render(selecting({ viewerResponded: true, allResponded: true, missingResponses: 0 }), manager)
  assert.match(html, /Choose the final date/)
  assert.match(html, /Everyone has responded/)
  assert.match(html, /href="#early-date-finalization"/)
  assert.equal((html.match(/<a /g) ?? []).length, 1)
})

test('UI: all-responded participant gets passive status in EN and LT', () => {
  const input = selecting({ viewerResponded: true, allResponded: true, missingResponses: 0 })
  const en = render(input, viewer, 'en')
  const lt = render(input, viewer, 'lt')
  assert.match(en, /The organizer can choose the final date now/)
  assert.match(lt, /Organizatorius gali pasirinkti galutinę datą dabar/)
  assert.doesNotMatch(en, /href="#early-date-finalization"/)
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
const datePickerExports: Record<string, React.ComponentType<Record<string, unknown>>> = {}
const datePickerRequire = (name: string) => {
  if (name === '@/lib/projectDateSelection') return dateSelection
  if (name === '@/lib/projectDateStrings') return dateStrings
  return nodeRequire(name)
}
new Function('require', 'exports', compileFixture(readFileSync(new URL('../components/ui/DateRangePicker.tsx', import.meta.url), 'utf8')))(datePickerRequire, datePickerExports)
const dateComponentExports: Record<string, React.ComponentType<Record<string, unknown>>> = {}
const dateRequire = (name: string) => {
  if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) }
  if (name === '@/app/project/[id]/actions') return new Proxy({}, { get: () => () => { throw new Error('Unexpected action invocation') } })
  if (name === '@/components/Project/LeaveProjectButton') return { LeaveProjectButton: () => createElement('button', {}, 'Leave project') }
  if (name === '@/components/ui/DateRangePicker') return datePickerExports
  if (name === '@/components/ui/button') return { Button: ({ variant, asChild, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; asChild?: boolean }) => { void variant; return asChild ? children : createElement('button', props, children) } }
  if (name === '@/lib/projectDateSelection') return dateSelection
  if (name === '@/lib/projectDateStrings') return dateStrings
  return nodeRequire(name)
}
new Function('require', 'exports', compileFixture(readFileSync(new URL('../components/Project/ProjectDateFinder.tsx', import.meta.url), 'utf8')))(dateRequire, dateComponentExports)
const pageFixture: { render?: (...args: unknown[]) => React.ReactNode } = {}
new Function('require', 'exports', 'ProjectDateFinder', compileFixture(`
export function render(projectDateData, isAborted, isFinalized, viewerIsCollector = false, successPath = { nextAction: null }) {
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

// Overview presentation regression cases use the real page wiring and components.
const dateOption = (id = 'date-a', changes = {}) => ({
  id, starts_at: '2099-02-01T00:00:00.000Z', ends_at: null, status: 'active' as const,
  created_by_user_id: 'organizer', created_at: '2098-01-01T00:00:00.000Z', source: 'organizer',
  suggestedBy: 'Organizer', availableCount: 0, maybeCount: 0, unavailableCount: 0, preferredCount: 0,
  viewerAvailability: null, viewerPreferred: false, isCurrentlyBest: true, isTied: false, otherResponseCount: 0,
  ...changes,
})
const selectingData = (changes = {}) => ({
  ...fixedDateFixture, dateMode: 'selecting', selectionStatus: 'open', selectedDateOptionId: null,
  viewerAttendanceStatus: 'pending_date_selection', viewerTaskComplete: false,
  confirmedCount: 0, respondedCount: 0, memberCount: 2, missingResponseNames: ['Arvydas'],
  options: [dateOption()], votingDeadlineAt: '2099-01-01T00:00:00.000Z',
  suggestionsCloseAt: '2098-12-01T00:00:00.000Z', ...changes,
})
const renderDate = (data: Record<string, unknown> = selectingData(), props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(dateComponentExports.ProjectDateFinder, {
  projectId: 'fixture', data, viewerUserId: 'user', viewerIsParticipant: true, canManage: true, locale: 'en', ...props,
}))

test('Date range picker: collapsed EN/LT control is one field backed by compatible hidden payload names', () => {
  for (const [locale, label, empty] of [['en', 'Dates', 'Select dates'], ['lt', 'Datos', 'Pasirinkti datas']] as const) {
    const html = renderToStaticMarkup(createElement(datePickerExports.DateRangePicker, {
      value: { startDate: '', endDate: null },
      onChange() {},
      locale,
      startName: 'start_date',
      endName: 'end_date',
      required: true,
    }))
    assert.match(html, new RegExp(label))
    assert.match(html, new RegExp(empty))
    assert.match(html, /name="start_date"/)
    assert.match(html, /name="end_date"/)
    assert.equal((html.match(/data-date-range-picker/g) ?? []).length, 1)
    assert.doesNotMatch(html, /type="date"/)
  }
})

test('Overview: actual page suppresses duplicate priority task when Success Path shows date action', () => {
  const model = derive({ ...selecting(), confirmedParticipants: 0, minParticipants: 2 }, manager)
  const html = renderToStaticMarkup(createElement(moduleObject.exports.ProjectSuccessOverview, { model, projectId: 'fixture' }))
    + renderToStaticMarkup(pageFixture.render!(selectingData(), false, false, true, model))
  assert.equal((html.match(/>Choose dates<\/a>/g) ?? []).length, 1)
  assert.match(html, /Choose your available dates/)
  assert.doesNotMatch(html, /Priority task|Still needed|Final date not selected/)
  assert.equal((html.match(/0 of 2 required participants confirmed/g) ?? []).length, 1)
  assert.match(html, /href="#date-availability"/)
  assert.match(html, /id="date-availability" role="region" aria-label="Choose the dates when you can participate\." tabindex="-1"/)
  assert.match(html, /id="date-availability"[\s\S]*<article[\s\S]*>Available<\/button>/)
})

test('Overview: absent Success Path preserves Date Finder fallback task and direct controls anchor', () => {
  const html = renderDate()
  assert.match(html, /Priority task/)
  assert.equal((html.match(/>Choose dates<\/a>/g) ?? []).length, 1)
  assert.match(html, /href="#date-availability"/)
  assert.doesNotMatch(renderDate(selectingData({ viewerTaskComplete: true })), /Priority task/)
  assert.doesNotMatch(renderDate(selectingData(), { viewerIsParticipant: false }), /Priority task/)
})

test('Overview: unrelated Success Path action does not suppress necessary Date Finder messaging', () => {
  assert.match(renderToStaticMarkup(pageFixture.render!(selectingData(), false, false, true, { nextAction: 'invite_people' })), /Priority task/)
})

test('Date options: one option with zero or nonzero responses never claims to be best', () => {
  assert.doesNotMatch(renderDate(), /Currently best option|<strong>0<\/strong>/)
  assert.doesNotMatch(renderDate(selectingData({ options: [dateOption('a', { availableCount: 1 })] })), /Currently best option/)
})

test('Date options: multiple zero-response options hide badges and empty tallies', () => {
  const html = renderDate(selectingData({ options: [dateOption(), dateOption('b', { isCurrentlyBest: false })] }))
  assert.doesNotMatch(html, /Currently best option|<strong>0<\/strong>/)
})

test('Date options: best badge follows existing ranking, including partial ballots', () => {
  const options = [dateOption(), dateOption('b', { starts_at: '2099-02-02T00:00:00.000Z' })]
  const ranking = dateSelection.rankDateOptions(options, [
    { date_option_id: 'date-a', user_id: 'member', availability: 'available', is_preferred: true },
  ], ['member', 'user'])
  assert.equal(ranking.kind, 'winner')
  const rankedOptions = options.map(option => ({ ...option, ...ranking.tallies.find(tally => tally.id === option.id), isCurrentlyBest: ranking.winnerId === option.id }))
  const before = structuredClone(rankedOptions)
  const html = renderDate(selectingData({ options: rankedOptions, respondedCount: 0 }))
  assert.equal((html.match(/Currently best option/g) ?? []).length, 1)
  assert.match(html, /<strong>1<\/strong> available/)
  assert.match(html, /<strong>1<\/strong> preferred/)
  assert.match(html, /<strong>0<\/strong> maybe/)
  assert.deepEqual(rankedOptions, before)
  assert.doesNotMatch(renderDate(selectingData({ options: rankedOptions.map(option => ({ ...option, isCurrentlyBest: false })) })), /Currently best option/)
})

test('Date options: removed options cannot satisfy comparison or response signal', () => {
  assert.doesNotMatch(renderDate(selectingData({ options: [dateOption(), dateOption('removed', { status: 'removed', availableCount: 2 })] })), /Currently best option/)
})

test('Date options: responses show existing complete breakdown and selected semantics', () => {
  const html = renderDate(selectingData({ options: [dateOption('a', {
    availableCount: 2, maybeCount: 3, unavailableCount: 1, preferredCount: 1,
    viewerAvailability: 'available', viewerPreferred: true,
  })] }))
  for (const count of ['2</strong> available', '3</strong> maybe', '1</strong> unavailable', '1</strong> preferred']) assert.ok(html.includes(count))
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 2)
})

test('Date options: voting, early-finalization, and fixed summaries show derived duration once per rendering', () => {
  const range = dateOption('range', {
    starts_at: '2099-10-09T00:00:00.000Z',
    ends_at: '2099-10-12T00:00:00.000Z',
    availableCount: 2,
  })
  const voting = renderDate(selectingData({ options: [range] }))
  assert.equal((voting.match(/3 nights/g) ?? []).length, 1)
  assert.match(renderDate(selectingData({ options: [dateOption()] })), /1 day/)

  const early = renderDate(selectingData({
    respondedCount: 2,
    memberCount: 2,
    missingResponseNames: [],
    viewerTaskComplete: true,
    options: [range],
  }))
  assert.match(early, /Select final date now/)
  assert.match(early, /3 nights/)

  const fixed = renderPageDate('confirmed', false, false, false, {
    eventStartAt: '2099-10-09T00:00:00.000Z',
    eventEndAt: '2099-10-12T00:00:00.000Z',
    options: [{ ...range, id: 'selected' }],
  })
  assert.match(fixed, /3 nights/)
  assert.match(renderDate(selectingData({ options: [range] }), { locale: 'lt' }), /3 naktys/)
})

test('Fixed date: timezone-adjusted event display keeps duration from the selected calendar option', () => {
  const selectedRange = dateOption('selected', {
    starts_at: '2099-10-09T00:00:00.000Z',
    ends_at: '2099-10-12T00:00:00.000Z',
  })
  const renderTimedRange = (eventStartAt: string, eventEndAt: string | null) => renderPageDate('confirmed', false, false, false, {
    eventStartAt,
    eventEndAt,
    options: [selectedRange],
  })

  // UTC+3 at 01:00 stores the local Oct 9 start on the previous UTC date.
  assert.match(renderTimedRange('2099-10-08T22:00:00.000Z', '2099-10-12T07:00:00.000Z'), /3 nights/)
  // A negative UTC offset can move the stored instant onto the next UTC date.
  assert.match(renderTimedRange('2099-10-10T02:00:00.000Z', '2099-10-13T01:00:00.000Z'), /3 nights/)
  // Start-only time editing leaves the end at its original date-only boundary.
  assert.match(renderTimedRange('2099-10-08T22:00:00.000Z', selectedRange.ends_at), /3 nights/)
  // The visible time still comes from the project event timestamps.
  assert.match(renderTimedRange('2099-10-09T01:00:00.000Z', '2099-10-12T10:00:00.000Z'), /9 Oct 2099, 01:00[\s\S]*12 Oct 2099, 10:00[\s\S]*3 nights/)
  // Spring and autumn offset changes do not alter the selected calendar duration.
  assert.match(renderPageDate('confirmed', false, false, false, {
    eventStartAt: '2099-03-27T23:00:00.000Z',
    eventEndAt: '2099-03-30T08:00:00.000Z',
    options: [dateOption('selected', { starts_at: '2099-03-28T00:00:00.000Z', ends_at: '2099-03-30T00:00:00.000Z' })],
  }), /2 nights/)
  assert.match(renderPageDate('confirmed', false, false, false, {
    eventStartAt: '2099-10-30T22:00:00.000Z',
    eventEndAt: '2099-11-02T09:00:00.000Z',
    options: [dateOption('selected', { starts_at: '2099-10-31T00:00:00.000Z', ends_at: '2099-11-02T00:00:00.000Z' })],
  }), /2 nights/)
})

test('Fixed date: a timed single day stays one day and missing selected option omits duration', () => {
  const singleDay = renderPageDate('confirmed', false, false, false, {
    eventStartAt: '2099-10-08T22:00:00.000Z',
    eventEndAt: null,
    options: [dateOption('selected', { starts_at: '2099-10-09T00:00:00.000Z', ends_at: null })],
  })
  assert.match(singleDay, /1 day/)
  assert.doesNotMatch(singleDay, /0 nights/)

  const missingOption = renderPageDate('confirmed', false, false, false, {
    eventStartAt: '2099-10-08T22:00:00.000Z',
    eventEndAt: '2099-10-12T07:00:00.000Z',
    options: [],
  })
  assert.doesNotMatch(missingOption, /\b(?:day|night|nights)\b/)
})

test('Waiting area: organizer reminder remains, participant and closed voting cannot gain it', () => {
  assert.match(renderDate(), /Missing responses: 1/)
  assert.match(renderDate(), /Arvydas/)
  assert.match(renderDate(), />Send reminder<\/button>/)
  assert.doesNotMatch(renderDate(selectingData(), { canManage: false }), /Send reminder/)
  assert.doesNotMatch(renderDate(selectingData({ missingResponseNames: [] })), /Send reminder|Date voting/)
  assert.doesNotMatch(renderDate(selectingData({ selectionStatus: 'awaiting_organizer_decision' })), /Send reminder|Priority task/)
})

test('Date Finder state: partial responses keep the collecting ballot and organizer reminder', () => {
  const html = renderDate(selectingData({ respondedCount: 1, memberCount: 2 }))
  assert.match(html, /data-date-state="collecting_responses"/)
  assert.match(html, />Available<\/button>/)
  assert.ok(html.includes('Suggest another date</button>'))
  assert.match(html, />Send reminder<\/button>/)
  assert.doesNotMatch(html, /Everyone has responded|data-secondary-controls/)
})

test('Date Finder state: all responses show a leader and preserve valid editing in disclosure', () => {
  const html = renderDate(selectingData({
    respondedCount: 2,
    memberCount: 2,
    missingResponseNames: [],
    viewerTaskComplete: true,
    options: [
      dateOption('a', { availableCount: 2, preferredCount: 1 }),
      dateOption('b', { starts_at: '2099-02-02T00:00:00.000Z', availableCount: 1, isCurrentlyBest: false }),
    ],
  }))
  assert.match(html, /data-date-state="all_responded"/)
  assert.match(html, /Everyone has responded/)
  assert.equal((html.match(/Currently best option/g) ?? []).length, 2)
  assert.match(html, /data-current-result="true"/)
  assert.match(html, /data-secondary-controls="true"/)
  assert.match(html, /Edit responses and date options/)
  assert.match(html, /Select final date now/)
  assert.match(html, /id="early-date-finalization"/)
  assert.match(html, /or wait until voting closes/)
  assert.match(html, />Available<\/button>/)
  assert.ok(html.includes('Suggest another date</button>'))
  assert.doesNotMatch(html, /Priority task|Select this date|Calculate result now/)
})

test('Date Finder disclosure: manager with valid date management retains the edit affordance', () => {
  const html = renderDate(selectingData({
    respondedCount: 2,
    memberCount: 2,
    missingResponseNames: [],
    viewerTaskComplete: true,
  }), { viewerIsParticipant: false, canManage: true })
  assert.match(html, /Edit responses and date options/)
  assert.match(html, /Remove date/)
})

for (const locale of ['en', 'lt'] as const) {
  test(`Date Finder disclosure: ${locale} read-only viewer gets one result and no misleading edit affordance`, () => {
    const html = renderDate(selectingData({
      respondedCount: 2,
      memberCount: 2,
      missingResponseNames: [],
      viewerTaskComplete: true,
    }), { viewerIsParticipant: false, canManage: false, locale })
    const strings = dateStrings.getProjectDateStrings(locale)
    assert.match(html, /data-date-state="all_responded"/)
    assert.equal((html.match(/data-current-result="true"/g) ?? []).length, 1)
    assert.doesNotMatch(html, new RegExp(strings.editResponsesAndOptions))
    assert.doesNotMatch(html, /data-secondary-controls|>Available<\/button>|>Galiu<\/button>|Remove date|Pašalinti datą|Suggest another date|Pasiūlyti kitą datą/)
  })
}

test('Date Finder disclosure: participant cannot edit after voting enters organizer decision', () => {
  const html = renderDate(selectingData({
    selectionStatus: 'awaiting_organizer_decision',
    respondedCount: 2,
    memberCount: 2,
    missingResponseNames: [],
    viewerTaskComplete: true,
    options: [dateOption('a', { isCurrentlyBest: false, isTied: true })],
  }), { canManage: false })
  assert.doesNotMatch(html, /Edit responses and date options|data-secondary-controls|>Available<\/button>|>Galiu<\/button>/)
})

test('Date Finder state: an open exact tie is honest and offers early finalization', () => {
  const tiedOptions = [
    dateOption('a', { availableCount: 2, preferredCount: 1, isCurrentlyBest: false, isTied: true }),
    dateOption('b', { starts_at: '2099-02-02T00:00:00.000Z', availableCount: 2, preferredCount: 1, isCurrentlyBest: false, isTied: true }),
  ]
  const html = renderDate(selectingData({ respondedCount: 2, memberCount: 2, missingResponseNames: [], viewerTaskComplete: true, options: tiedOptions }))
  assert.match(html, /These options are currently tied/)
  assert.equal((html.match(/Currently tied/g) ?? []).length, 4)
  assert.match(html, /Select final date now/)
  assert.doesNotMatch(html, /Currently best option|Select this date|Calculate result now/)
})

test('Date Finder state: partial response and participant views cannot gain early-finalization controls', () => {
  assert.doesNotMatch(renderDate(selectingData({ respondedCount: 1, memberCount: 2 })), /Select final date now/)
  const participant = renderDate(selectingData({
    respondedCount: 2, memberCount: 2, missingResponseNames: [], viewerTaskComplete: true,
  }), { canManage: false })
  assert.match(participant, /The organizer can choose the final date now/)
  assert.doesNotMatch(participant, /Select final date now|Confirm final date|Set this as the final date/)
})

test('Date Finder state: persisted tie gives only the organizer the existing resolution action', () => {
  const decisionData = selectingData({
    selectionStatus: 'awaiting_organizer_decision',
    respondedCount: 2,
    memberCount: 2,
    missingResponseNames: [],
    viewerTaskComplete: true,
    options: [
      dateOption('a', { availableCount: 2, preferredCount: 1, isCurrentlyBest: false, isTied: true }),
      dateOption('b', { starts_at: '2099-02-02T00:00:00.000Z', availableCount: 2, preferredCount: 1, isCurrentlyBest: false, isTied: true }),
    ],
  })
  const organizer = renderDate(decisionData)
  assert.match(organizer, /data-date-state="organizer_decision_required"/)
  assert.equal((organizer.match(/>Select this date<\/button>/g) ?? []).length, 2)
  assert.doesNotMatch(organizer, />Available<\/button>|Suggest another date/)
  const participant = renderDate(decisionData, { canManage: false })
  assert.match(participant, /Waiting for the organizer to choose the final date/)
  assert.doesNotMatch(participant, /Select this date/)
})

test('Date Finder state: closed suggestions do not appear in all-responded editing', () => {
  const html = renderDate(selectingData({
    respondedCount: 2,
    memberCount: 2,
    missingResponseNames: [],
    viewerTaskComplete: true,
    suggestionsCloseAt: '2020-01-01T00:00:00.000Z',
  }))
  assert.match(html, /New suggestions closed/)
  assert.doesNotMatch(html, />Suggest another date<\/button>/)
})

test('Date Finder state: selected date is a compact summary with details and no ballot mutations', () => {
  const html = renderDate({ ...fixedDateFixture, selectionStatus: 'confirmation_open' })
  assert.match(html, /data-date-state="final_date_confirmed"/)
  assert.match(html, />Confirmed</)
  assert.match(html, /Participants confirmed: 2/)
  assert.match(html, /View date details/)
  assert.match(html, /data-secondary-controls="true"/)
  assert.doesNotMatch(html, /Choose project date|Suggest another date|Remove date|>Available<\/button>|>Preferred<\/button>/)
})

test('Success Path: unresolved date cannot be masked by invite guidance', () => {
  const result = derive({ ...selecting({ viewerResponded: true, missingResponses: 0 }), confirmedParticipants: 0 }, manager)
  assert.equal(result.nextAction, null)
  assert.deepEqual(result.blockers, [{ type: 'date' }, { type: 'participants', count: 6 }])
  assert.equal(result.visibleStages.find(stage => stage.id === 'date')?.state, 'current')
  assert.equal(result.visibleStages.find(stage => stage.id === 'participants')?.state, 'upcoming')
})

test('Date Finder state: Lithuanian all-responded and confirmed views stay localized', () => {
  const allResponded = renderDate(selectingData({ respondedCount: 2, memberCount: 2, missingResponseNames: [], viewerTaskComplete: true }), { locale: 'lt' })
  assert.match(allResponded, /Visi atsakė/)
  assert.match(allResponded, /Keisti atsakymus ir datų variantus/)
  assert.match(allResponded, /Pasirinkti galutinę datą dabar/)
  assert.doesNotMatch(allResponded, /Everyone has responded|Current result|Edit responses|Voting closes/)
  const confirmed = renderDate({ ...fixedDateFixture }, { locale: 'lt' })
  assert.match(confirmed, /Patvirtinta|Peržiūrėti datos informaciją/)
  assert.doesNotMatch(confirmed, /View date details|Participants confirmed/)
})

test('Overview: unique finance and organizer-decision blockers stay visible', () => {
  const html = render({ ...selecting(), financeMode: 'managed', confirmedParticipants: 0 }, manager)
  assert.match(html, /Base contributions are not yet settled/)
  const tied = render(selecting({ votingOpen: false, awaitingOrganizer: true, viewerResponded: true }))
  assert.match(tied, /Waiting for the organizer to choose the final date/)
  assert.doesNotMatch(tied, /Still needed/)
})

// Exercise both actual page component expressions, including locale propagation.
let successOverviewExpression = ''
function findSuccessOverview(node: ts.Node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(pageAst) === 'ProjectSuccessOverview') {
    successOverviewExpression = node.getText(pageAst)
  }
  ts.forEachChild(node, findSuccessOverview)
}
findSuccessOverview(pageAst)
assert.ok(successOverviewExpression)
const overviewFixture: { render?: (...args: unknown[]) => React.ReactNode } = {}
new Function('require', 'exports', 'ProjectSuccessOverview', 'ProjectDateFinder', compileFixture(`
export function render(successPath, projectDateData, projectDateLocale, viewerIsCollector = true) {
  const projectId = 'fixture', uid = 'user', isMeParticipant = true, isAborted = false
  return <>{${successOverviewExpression}}{${dateFinderExpression}}</>
}`))(nodeRequire, overviewFixture, moduleObject.exports.ProjectSuccessOverview, dateComponentExports.ProjectDateFinder)

for (const locale of ['en', 'lt'] as const) {
  test(`Localization: actual ${locale} Overview has one localized date CTA and no duplicate task`, () => {
    const model = derive({ ...selecting(), confirmedParticipants: 0, minParticipants: 2 }, manager)
    const html = renderToStaticMarkup(overviewFixture.render!(model, selectingData(), locale))
    const strings = dateStrings.getProjectDateStrings(locale)
    assert.equal((html.match(new RegExp(`>${strings.chooseDates}</a>`, 'g')) ?? []).length, 1)
    assert.match(html, /href="#date-availability"/)
    assert.doesNotMatch(html, new RegExp(strings.priorityTask))
    if (locale === 'lt') {
      assert.match(html, /Projekto būsena/)
      assert.doesNotMatch(html, /Choose your available dates|Your response helps|>Choose dates<|Project status|Needs your attention|Upcoming|Current/)
    } else {
      assert.match(html, /Choose your available dates/)
    }
  })
}

for (const locale of ['en', 'lt'] as const) {
  test(`Localization: ${locale} standalone Date Finder keeps its localized task and one CTA`, () => {
    const strings = dateStrings.getProjectDateStrings(locale)
    const html = renderDate(selectingData(), { locale })
    assert.match(html, new RegExp(strings.priorityTask))
    assert.match(html, new RegExp(strings.chooseDatesHelp))
    assert.equal((html.match(new RegExp(`>${strings.chooseDates}</a>`, 'g')) ?? []).length, 1)
    assert.match(html, /href="#date-availability"/)
    if (locale === 'lt') assert.doesNotMatch(html, /Choose dates|Priority task/)
  })

  test(`Localization: ${locale} progress, health and readiness context stay consistent`, () => {
    const strings = successStrings.getProjectSuccessOverviewStrings(locale)
    const html = render({ ...selecting(), confirmedParticipants: 0, minParticipants: 2, financeMode: 'managed' }, manager, locale)
    for (const text of [strings.projectStatus, strings.region, strings.relevantStages, strings.health.needs_attention,
      strings.stageStates.current, strings.stageStates.upcoming, strings.stages.date, strings.stages.participants,
      strings.stages.finance, strings.stages.ready, strings.participantMinimum(0, 2), strings.details.finance]) {
      assert.ok(html.includes(text), text)
    }
    assert.match(html, new RegExp(`lang="${locale}"`))
    const ready = render(context(), viewer, locale)
    for (const text of [strings.headings.ready, strings.details.ready, strings.stageStates.complete]) assert.ok(ready.includes(text))
    if (locale === 'lt') assert.doesNotMatch(html + ready, /Project status|Needs your attention|Base contributions|participants confirmed|Complete|Upcoming/)
  })

  test(`Localization: ${locale} terminal states retain localized labels and no actions`, () => {
    const strings = successStrings.getProjectSuccessOverviewStrings(locale)
    for (const terminal of ['canceled', 'finalized'] as const) {
      const html = render({ ...selecting(), isCanceled: terminal === 'canceled', isFinalized: terminal === 'finalized' }, manager, locale)
      assert.ok(html.includes(strings.health[terminal]))
      assert.ok(html.includes(strings.headings[terminal]))
      assert.ok(html.includes(strings.details[terminal]))
      assert.doesNotMatch(html, /<a /)
      if (locale === 'lt') assert.doesNotMatch(html, /Project canceled|Project finalized|This project was canceled|participant list/)
    }
  })

  test(`Localization: ${locale} action variants retain their stable destinations`, () => {
    const strings = successStrings.getProjectSuccessOverviewStrings(locale)
    const scenarios = [
      { input: context({ date: { ...context().date, viewerNeedsConfirmation: true } }), actor: viewer, action: 'confirm_attendance', target: '#project-date-finder' },
      { input: selecting({ votingOpen: false, awaitingOrganizer: true }), actor: manager, action: 'resolve_date', target: '#project-date-finder' },
      { input: context({ confirmedParticipants: 0 }), actor: manager, action: 'invite_people', target: '/project/fixture?tab=people' },
      { input: context({ financeMode: 'managed' }), actor: manager, action: 'review_finance', target: '/project/fixture?tab=payments' },
      { input: context({ financeMode: 'managed' }), actor: { ...viewer, canPay: true }, action: 'review_payment', target: '/project/fixture?tab=payments' },
    ] as const
    for (const { input, actor, action, target } of scenarios) {
      const html = render(input, actor, locale)
      assert.equal(derive(input, actor).nextAction, action)
      for (const text of Object.values(strings.actions[action])) assert.ok(html.includes(text), text)
      assert.ok(html.includes(`href="${target}"`))
      if (locale === 'lt') for (const text of Object.values(successStrings.getProjectSuccessOverviewStrings('en').actions[action])) assert.ok(!html.includes(text))
    }
  })

  test(`Localization: ${locale} waiting and no-minimum states include localized numeric context`, () => {
    const strings = successStrings.getProjectSuccessOverviewStrings(locale)
    const dateWaiting = render(selecting({ viewerResponded: true }), viewer, locale)
    for (const text of [strings.headings.waiting, strings.details.date, strings.waitingPeople(3), strings.waitingDates(3)]) assert.ok(dateWaiting.includes(text))
    const attendanceWaiting = render(context({ confirmedParticipants: 0, date: { ...context().date, awaitingAttendance: 2 } }), viewer, locale)
    assert.ok(attendanceWaiting.includes(strings.waitingParticipants(6)))
    assert.ok(attendanceWaiting.includes(strings.waitingAttendance(2)))
    const tieWaiting = render(selecting({ votingOpen: false, awaitingOrganizer: true }), viewer, locale)
    assert.ok(tieWaiting.includes(strings.details.date_tie))
    for (const count of [0, 1, 2, 10, 11, 21]) {
      assert.ok(render(context({ minParticipants: null, confirmedParticipants: count }), viewer, locale).includes(strings.participantNoMinimum(count)))
    }
  })
}

test('Localization: dateActionShown remains a comparison of stable action ID, never display copy', () => {
  let decision: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(pageAst) === 'dateActionShown' && node.initializer && ts.isJsxExpression(node.initializer)) decision = node.initializer.expression
    ts.forEachChild(node, visit)
  }
  visit(pageAst)
  assert.ok(decision && ts.isBinaryExpression(decision))
  assert.equal(decision.operatorToken.kind, ts.SyntaxKind.EqualsEqualsEqualsToken)
  assert.equal(decision.left.getText(pageAst), 'successPath.nextAction')
  assert.ok(ts.isStringLiteral(decision.right))
  assert.equal(decision.right.text, 'choose_dates')
})

test('Localization: all Success Overview JSX text and accessible labels come from copy', () => {
  const ast = ts.createSourceFile('overview.tsx', componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) assert.equal(node.getText(ast).trim(), '')
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'aria-label') assert.ok(node.initializer && ts.isJsxExpression(node.initializer))
    ts.forEachChild(node, visit)
  }
  visit(ast)
})
