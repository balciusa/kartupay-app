import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as finance from './projectFinance.ts'
import * as joinRequests from './projectJoinRequests.ts'
import * as statusUi from './projectStatusUi.ts'
import * as projectInvite from './projectInvite.ts'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>
const nodeRequire = createRequire(import.meta.url)

// Execute the real action/component source with in-memory I/O, without Next or live data.
function compile(relativePath: string) {
  return ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: relativePath,
  }).outputText
}
const actionCode = compile('../app/project/[id]/actions.ts')
const chatCode = compile('../components/Project/Chat.tsx')
const adminPanelCode = compile('../components/Project/AdminPanel.tsx')

function fixture() {
  const tables: Tables = {
    projects: [{ id: 'project', status: 'pending', canceled_at: null, aborted_at: null, finance_mode: 'none', collector_participant_id: 'collector' }],
    participants: [{ id: 'me', project_id: 'project', user_id: 'user', role: 'member', left_at: null }],
    polls: [{ id: 'poll', project_id: 'project', created_by: 'user', title: 'Original' }],
    poll_options: [
      { id: 'option-a', poll_id: 'poll', label: 'A', created_at: '2026-01-01' },
      { id: 'option-b', poll_id: 'poll', label: 'B', created_at: '2026-01-01' },
    ],
    poll_votes: [{ id: 'vote', poll_id: 'poll', option_id: 'option-a', user_id: 'voter' }],
    messages: [], chat_reads: [], join_requests: [],
  }
  const writes: string[] = []
  const failures = new Map<string, { code: string; message: string }>()
  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      const orders: string[] = []
      let operation = 'select'
      let values: Row | Row[] = {}
      let single = false
      let limit = Infinity
      let includeCount = false
      const query = {
        select(_fields?: string, options?: { count?: string }) { includeCount = options?.count === 'exact'; return query },
        eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
        neq(key: string, value: unknown) { filters.push(row => row[key] !== value); return query },
        is(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
        order(key: string) { orders.push(key); return query },
        limit(value: number) { limit = value; return query },
        single() { single = true; return query },
        maybeSingle() { single = true; return query },
        update(value: Row) { operation = 'update'; values = value; return query },
        insert(value: Row | Row[]) { operation = 'insert'; values = value; return query },
        upsert(value: Row) { operation = 'insert'; values = value; return query },
        delete() { operation = 'delete'; return query },
        then(resolve: (result: { data: Row | Row[] | null; error: Row | null; count?: number }) => void) {
          const error = failures.get(table)
          if (error) { resolve({ data: null, error }); return }
          let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
          rows.sort((a, b) => {
            for (const key of orders) {
              const comparison = String(a[key]).localeCompare(String(b[key]))
              if (comparison) return comparison
            }
            return 0
          })
          rows = rows.slice(0, limit)
          if (operation !== 'select') writes.push(`${table}:${operation}`)
          if (operation === 'update') rows.forEach(row => Object.assign(row, values))
          if (operation === 'delete') {
            tables[table] = tables[table].filter(row => !rows.includes(row))
            if (table === 'poll_options') {
              tables.poll_votes = tables.poll_votes.filter(vote => !rows.some(row => row.id === vote.option_id))
            }
          }
          if (operation === 'insert') {
            rows = (Array.isArray(values) ? values : [values]).map((row, i) => ({ id: `new-${i}`, ...row }))
            tables[table].push(...rows)
          }
          resolve({ data: single ? rows[0] ?? null : rows, error: null, count: includeCount ? rows.length : undefined })
        },
      }
      return query
    },
  }
  const modules: Record<string, unknown> = {
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
    '@/lib/supabaseServer': { getCurrentUserId: async () => 'user' },
    '@/lib/activityLog': { recordProjectActivity: async () => {} },
    '@/lib/projectFinance': finance,
    '@/lib/projectJoinRequests': joinRequests,
    '@/lib/projectInvite': projectInvite,
    '@/lib/projectStatusUi': statusUi,
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': { redirect: () => { throw new Error('NEXT_REDIRECT') } },
  }
  const exports = {}
  new Function('require', 'exports', actionCode)((name: string) => modules[name] ?? {}, exports)
  return { tables, writes, failures, actions: exports as typeof import('../app/project/[id]/actions') }
}

function pendingJoinFixture(role: string, collectorParticipantId = 'collector') {
  const f = fixture()
  f.tables.projects[0].collector_participant_id = collectorParticipantId
  f.tables.participants[0].role = role
  f.tables.join_requests = [{
    id: 'request',
    project_id: 'project',
    requester_user_id: 'requester',
    status: 'pending',
    created_at: '2026-09-24T10:00:00.000Z',
  }]
  return f
}

function pollForm(options = 'A\nB') {
  const form = new FormData()
  form.set('title', 'Edited title')
  form.set('description', 'Edited description')
  form.set('required_votes', '3')
  form.set('options', options)
  return form
}

test('poll metadata edit preserves vote rows and option IDs', async () => {
  const f = fixture()
  const votes = structuredClone(f.tables.poll_votes)
  const options = structuredClone(f.tables.poll_options)
  await f.actions.updatePoll('project', 'poll', pollForm(' A \r\n\n B '))
  assert.equal(f.tables.polls[0].title, 'Edited title')
  assert.equal(f.tables.polls[0].description, 'Edited description')
  assert.equal(f.tables.polls[0].required_votes, 3)
  assert.deepEqual(f.tables.poll_votes, votes)
  assert.deepEqual(f.tables.poll_options, options)
  assert.deepEqual(f.writes, ['polls:update'])
})

for (const options of ['A\nChanged', 'A', 'A\nB\nC', 'B\nA']) {
  test(`voted poll rejects option change (${JSON.stringify(options)}) before ANY write`, async () => {
    const f = fixture()
    const before = structuredClone(f.tables)
    assert.deepEqual(await f.actions.updatePoll('project', 'poll', pollForm(options)), {
      error: 'Poll options cannot be changed after voting has started.',
    })
    assert.deepEqual(f.writes, [])
    assert.deepEqual(f.tables, before)
  })
}

test('zero-vote poll still allows option replacement', async () => {
  const f = fixture()
  f.tables.poll_votes = []
  await f.actions.updatePoll('project', 'poll', pollForm('New A\nNew B'))
  assert.deepEqual(f.tables.poll_options.map(row => row.label), ['New A', 'New B'])
  assert.equal(f.tables.polls[0].title, 'Edited title')
})

test('poll option/vote read errors fail closed before writes', async () => {
  for (const table of ['poll_options', 'poll_votes']) {
    const f = fixture()
    f.failures.set(table, { code: 'error', message: 'Read failed' })
    await assert.rejects(f.actions.updatePoll('project', 'poll', pollForm('Changed')))
    assert.deepEqual(f.writes, [])
  }
})

test('normal participant can leave', async () => {
  const f = fixture()
  await assert.rejects(f.actions.leaveProject('project'), /NEXT_REDIRECT/)
  assert.equal(typeof f.tables.participants[0].left_at, 'string')
})

test('assigned collector cannot leave, with no membership or financial writes', async () => {
  const f = fixture()
  f.tables.projects[0].collector_participant_id = 'me'
  await assert.rejects(f.actions.leaveProject('project'), /Assign another collector before leaving the project\./)
  assert.equal(f.tables.participants[0].left_at, null)
  assert.deepEqual(f.writes, [])
})

test('sole active organizer cannot leave even when another organizer has left', async () => {
  const f = fixture()
  f.tables.participants[0].role = 'organizer'
  f.tables.participants.push({ id: 'old', project_id: 'project', role: 'organizer', left_at: '2026-01-01' })
  f.tables.participants.push({ id: 'unrelated', project_id: 'other-project', role: 'organizer', left_at: null })
  await assert.rejects(f.actions.leaveProject('project'), /Assign another organizer before leaving the project\./)
  assert.equal(f.tables.participants[0].left_at, null)
  assert.deepEqual(f.writes, [])
})

test('non-collector organizer can leave when another active organizer remains', async () => {
  const f = fixture()
  f.tables.participants[0].role = 'organizer'
  f.tables.participants.push({ id: 'other', project_id: 'project', role: 'organizer', left_at: null })
  await assert.rejects(f.actions.leaveProject('project'), /NEXT_REDIRECT/)
  assert.equal(typeof f.tables.participants[0].left_at, 'string')
  assert.equal(f.tables.participants[1].left_at, null)
})

test('non-collector organizer can reject a pending join request', async () => {
  const f = pendingJoinFixture('organizer')

  await assert.rejects(f.actions.rejectJoinRequest('request'), /NEXT_REDIRECT/)

  assert.equal(f.tables.join_requests[0].status, 'rejected')
  assert.deepEqual(f.writes, ['join_requests:update'])
})

test('assigned collector can still reject a pending join request', async () => {
  const f = pendingJoinFixture('member', 'me')

  await assert.rejects(f.actions.rejectJoinRequest('request'), /NEXT_REDIRECT/)

  assert.equal(f.tables.join_requests[0].status, 'rejected')
})

test('ordinary participant cannot manage a pending join request', async () => {
  const f = pendingJoinFixture('member')

  await assert.rejects(f.actions.rejectJoinRequest('request'), /Not authorized/)

  assert.equal(f.tables.join_requests[0].status, 'pending')
  assert.deepEqual(f.writes, [])
})

test('finance-none direct join reactivates a previous participant immediately', async () => {
  const f = fixture()
  f.tables.participants[0].left_at = '2026-09-01T00:00:00.000Z'

  const result = await f.actions.requestJoin('project')

  assert.deepEqual(result, { ok: true, joined: true })
  assert.equal(f.tables.participants[0].left_at, null)
  assert.match(f.writes.join(','), /participants:update/)
  assert.equal(f.tables.join_requests.length, 0)
})

test('managed join creates a pending request and rejected requests can be resubmitted', async () => {
  const f = fixture()
  f.tables.projects[0].finance_mode = 'managed'
  f.tables.participants = []

  assert.deepEqual(await f.actions.requestJoin('project'), { ok: true, pending: true })
  assert.equal(f.tables.join_requests[0].status, 'pending')

  f.tables.join_requests[0].status = 'rejected'
  assert.deepEqual(await f.actions.requestJoin('project'), { ok: true, pending: true })
  assert.equal(f.tables.join_requests[0].status, 'pending')
})

test('pending join request can still be canceled', async () => {
  const f = fixture()
  f.tables.projects[0].finance_mode = 'managed'
  f.tables.participants = []
  f.tables.join_requests = [{
    id: 'request', project_id: 'project', requester_user_id: 'user', status: 'pending',
  }]

  assert.deepEqual(await f.actions.cancelJoinRequest('project'), { ok: true })
  assert.equal(f.tables.join_requests[0].status, 'canceled')
})

test('finance-none direct join remains blocked at project capacity', async () => {
  const f = fixture()
  f.tables.projects[0].max_participants = 1
  f.tables.participants = [{
    id: 'other', project_id: 'project', user_id: 'other-user', role: 'member', left_at: null,
  }]

  assert.deepEqual(await f.actions.requestJoin('project'), {
    ok: false,
    blocked: true,
    error: 'Project capacity has been reached',
  })
  assert.equal(f.tables.participants.length, 1)
})

for (const canceledState of [
  { status: 'canceled' },
  { status: 'cancelled' },
  { status: ' CANCELLED ' },
  { canceled_at: '2026-09-01T00:00:00.000Z' },
  { aborted_at: '2026-09-01T00:00:00.000Z' },
]) {
  test(`joining is blocked for canceled state ${JSON.stringify(canceledState)}`, async () => {
    const f = fixture()
    f.tables.participants = []
    Object.assign(f.tables.projects[0], canceledState)

    assert.deepEqual(await f.actions.requestJoin('project'), { ok: false, blocked: true })
    assert.deepEqual(f.tables.participants, [])
    assert.deepEqual(f.tables.join_requests, [])
  })
}

test('existing finalized/closed late-join behavior remains available', async () => {
  const f = fixture()
  f.tables.projects[0].status = 'closed'
  f.tables.participants[0].left_at = '2026-09-01T00:00:00.000Z'

  assert.deepEqual(await f.actions.requestJoin('project'), { ok: true, joined: true })
  assert.equal(f.tables.participants[0].left_at, null)
})

test('organizer join-request panel shows its notification count and approval controls', () => {
  const modules: Record<string, unknown> = {
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/components/Project/ActivityLogTab': { ActivityLogTab: () => null },
    '@/app/project/[id]/actions': {
      abortProject: async () => {},
      approveJoinRequestFromForm: async () => {},
      rejectJoinRequestFromForm: async () => {},
      setCollector: async () => {},
    },
  }
  const exports = {} as { AdminPanel: typeof import('../components/Project/AdminPanel').AdminPanel }
  new Function('require', 'exports', adminPanelCode)((name: string) => modules[name] ?? nodeRequire(name), exports)

  const html = renderToStaticMarkup(createElement(exports.AdminPanel, {
    projectId: 'project',
    participants: [{ id: 'me', user_id: 'user', role: 'organizer', short_code: null }],
    collectorId: 'collector',
    myParticipantId: 'me',
    pendingRequests: [{
      id: 'request',
      requester_user_id: 'requester',
      created_at: '2026-09-24T10:00:00.000Z',
      status: 'pending',
    }],
    pendingCount: 1,
    canManage: false,
    canManageJoinRequests: true,
    canCancel: false,
    openRequestsOnMount: true,
    activityItems: [],
    financeMode: 'managed',
  }))

  assert.match(html, /Manage requests/)
  assert.match(html, />1<\/span>/)
  assert.match(html, />Approve<\/button>/)
  assert.match(html, />Reject<\/button>/)
  assert.doesNotMatch(html, /permission to manage join requests/)
})

for (const role of ['collector', 'organizer']) {
  test(`refund completion cannot bypass ${role} leave protection or change financial history`, async () => {
    const f = fixture()
    f.tables.projects[0].finance_mode = 'managed'
    if (role === 'collector') f.tables.projects[0].collector_participant_id = 'me'
    else f.tables.participants[0].role = 'organizer'
    f.tables.participant_refund_requests = [{ id: 'refund', project_id: 'project', participant_id: 'me', status: 'sent' }]
    const before = structuredClone(f.tables)
    await assert.rejects(f.actions.confirmParticipantRefundReceived('refund'), /Assign another/)
    assert.deepEqual(f.tables, before)
    assert.deepEqual(f.writes, [])
  })
}

for (const status of ['pending', 'collecting', 'closed', 'finalized']) {
  test(`${status} project still permits messages and replies`, async () => {
    const f = fixture()
    f.tables.projects[0].status = status
    await f.actions.postMessage('project', 'Message')
    await f.actions.postMessage('project', 'Reply', 'parent')
    assert.equal(f.tables.messages.length, 2)
    assert.equal(f.tables.messages[1].parent_id, 'parent')
  })
}

for (const project of [
  { status: 'canceled' }, { status: 'cancelled' }, { status: ' CANCELLED ' },
  { canceled_at: '2026-01-01' }, { aborted_at: '2026-01-01' },
]) {
  test(`${JSON.stringify(project)} rejects both messages and replies before insertion`, async () => {
    const f = fixture()
    Object.assign(f.tables.projects[0], project)
    for (const parent of [undefined, 'parent']) {
      await assert.rejects(f.actions.postMessage('project', 'Must not post', parent), /Posting is disabled because this project was canceled\./)
    }
    assert.deepEqual(f.tables.messages, [])
    assert.deepEqual(f.writes, [])
  })
}

test('read-only Chat renders existing messages and replies without any posting controls', () => {
  const exports = {} as { default: typeof import('../components/Project/Chat').default }
  new Function('require', 'exports', chatCode)((name: string) => name.startsWith('@/') ? {} : nodeRequire(name), exports)
  const props = {
    projectId: 'project', canRead: true, canPost: false,
    messages: [
      { id: 'parent', body: 'Existing message', created_at: '2026-01-01T00:00:00Z' },
      { id: 'reply', parent_id: 'parent', body: 'Existing reply', created_at: '2026-01-01T01:00:00Z' },
    ],
  }
  const html = renderToStaticMarkup(createElement(exports.default, props))
  assert.match(html, /Existing message/)
  assert.match(html, /Existing reply/)
  assert.match(html, /Posting is disabled because this project was canceled\./)
  assert.doesNotMatch(html, /<form|<textarea|<button/)
  const active = renderToStaticMarkup(createElement(exports.default, { ...props, canPost: true }))
  assert.match(active, /<form/)
  assert.match(active, />Reply<\/button>/)
})
