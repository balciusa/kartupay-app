import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import * as dateSelection from './projectDateSelection.ts'

type Row = Record<string, unknown>

function compile() {
  return ts.transpileModule(readFileSync(new URL('./projectDateService.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'projectDateService.ts',
  }).outputText
}

function project(overrides: Row = {}): Row {
  return {
    id: 'project',
    date_mode: 'selecting',
    date_selection_status: 'open',
    date_voting_deadline_at: '2026-09-29T09:00:00.000Z',
    date_suggestions_close_at: null,
    selected_date_option_id: null,
    confirmation_deadline_at: null,
    event_start_at: null,
    event_end_at: null,
    min_participants: null,
    max_participants: null,
    ...overrides,
  }
}

function fixture(initial: Record<string, Row[]>, options?: { failNotifications?: boolean }) {
  const tables: Record<string, Row[]> = {
    projects: [],
    participants: [],
    project_date_options: [],
    project_date_responses: [],
    project_priority_tasks: [],
    ...initial,
  }
  const notifications: Row[] = []
  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      let operation: 'select' | 'update' = 'select'
      let updateValues: Row = {}
      let single = false
      const query = {
        select() { return query },
        eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
        is(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
        in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query },
        lte(key: string, value: string) { filters.push(row => String(row[key]) <= value); return query },
        order() { return query },
        maybeSingle() { single = true; return query },
        update(value: Row) { operation = 'update'; updateValues = value; return query },
        then(resolve: (result: { data: Row | Row[] | null; error: null }) => void) {
          const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
          if (operation === 'update') rows.forEach(row => Object.assign(row, updateValues))
          resolve({ data: single ? rows[0] ?? null : rows, error: null })
        },
      }
      return query
    },
    rpc: async () => ({ error: null }),
  }
  const modules: Record<string, unknown> = {
    '@/lib/activityLog': { recordProjectActivity: async () => {} },
    '@/lib/projectDateSelection': dateSelection,
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
    '@/lib/projectNotifications': {
      enqueueProjectNotifications: async (rows: Row[]) => {
        if (options?.failNotifications) throw new Error('notification insert failed')
        for (const row of rows) {
          if (!notifications.some(existing => existing.dedupe_key === row.dedupe_key)) notifications.push(row)
        }
      },
    },
  }
  const exports: Record<string, unknown> = {}
  new Function('require', 'exports', compile())((name: string) => modules[name] ?? {}, exports)
  return {
    tables,
    notifications,
    service: exports as typeof import('./projectDateService'),
  }
}

const activeOptions = [
  { id: 'a', project_id: 'project', status: 'active' },
  { id: 'b', project_id: 'project', status: 'active' },
]

const activeParticipants = [
  { id: 'complete', project_id: 'project', user_id: 'complete-user', left_at: null },
  { id: 'incomplete', project_id: 'project', user_id: 'incomplete-user', left_at: null },
  { id: 'former', project_id: 'project', user_id: 'former-user', left_at: '2026-09-01T00:00:00.000Z' },
]

const responses = [
  { project_id: 'project', date_option_id: 'a', user_id: 'complete-user', availability: 'available', is_preferred: true },
  { project_id: 'project', date_option_id: 'b', user_id: 'complete-user', availability: 'maybe', is_preferred: false },
  { project_id: 'project', date_option_id: 'a', user_id: 'incomplete-user', availability: 'available', is_preferred: false },
]

test('availability 24h reminder targets only active participants missing an active-option response', async () => {
  const f = fixture({
    projects: [project()],
    participants: activeParticipants,
    project_date_options: activeOptions,
    project_date_responses: responses,
  })
  await f.service.syncProjectDateSelection('project', new Date('2026-09-28T10:00:00.000Z'))
  assert.equal(f.notifications.length, 1)
  assert.equal(f.notifications[0].recipient_user_id, 'incomplete-user')
  assert.equal(f.notifications[0].notification_type, 'date_availability_24h')
  assert.match(String(f.notifications[0].dedupe_key), /2026-09-29T09:00:00.000Z/)
})

test('availability 2h reminder is deduplicated within a voting cycle', async () => {
  const f = fixture({
    projects: [project({ date_voting_deadline_at: '2026-09-28T11:00:00.000Z' })],
    participants: activeParticipants,
    project_date_options: activeOptions,
    project_date_responses: responses,
  })
  const now = new Date('2026-09-28T10:00:00.000Z')
  await f.service.syncProjectDateSelection('project', now)
  await f.service.syncProjectDateSelection('project', now)
  assert.equal(f.notifications.length, 1)
  assert.equal(f.notifications[0].notification_type, 'date_availability_2h')
})

test('expired, closed, and fixed Date Finder states do not enqueue availability reminders', async () => {
  for (const row of [
    project({ date_voting_deadline_at: '2026-09-28T09:00:00.000Z' }),
    project({ date_selection_status: 'awaiting_organizer_decision' }),
    project({ date_mode: 'fixed', date_selection_status: 'confirmed' }),
  ]) {
    const f = fixture({
      projects: [row],
      participants: activeParticipants,
      project_date_options: [],
      project_date_responses: [],
    })
    await f.service.syncProjectDateSelection('project', new Date('2026-09-28T10:00:00.000Z'))
    assert.equal(f.notifications.length, 0)
  }
})

test('existing attendance 24h and 2h reminders retain their target status rules', async () => {
  for (const [deadline, expectedType] of [
    ['2026-09-29T09:00:00.000Z', 'date_confirmation_24h'],
    ['2026-09-28T11:00:00.000Z', 'date_confirmation_2h'],
  ]) {
    const f = fixture({
      projects: [project({
        date_mode: 'fixed',
        date_selection_status: 'confirmation_open',
        confirmation_deadline_at: deadline,
      })],
      participants: [
        { project_id: 'project', user_id: 'awaiting', left_at: null, attendance_status: 'awaiting_confirmation' },
        { project_id: 'project', user_id: 'unconfirmed', left_at: null, attendance_status: 'unconfirmed' },
        { project_id: 'project', user_id: 'confirmed', left_at: null, attendance_status: 'confirmed' },
        { project_id: 'project', user_id: 'former', left_at: '2026-09-01', attendance_status: 'awaiting_confirmation' },
      ],
    })
    await f.service.syncProjectDateSelection('project', new Date('2026-09-28T10:00:00.000Z'))
    assert.deepEqual(f.notifications.map(row => row.recipient_user_id).sort(), ['awaiting', 'unconfirmed'])
    assert.ok(f.notifications.every(row => row.notification_type === expectedType))
  }
})

test('notification insert failures are isolated from authoritative date processing', async () => {
  const f = fixture({
    projects: [project()],
    participants: activeParticipants,
    project_date_options: activeOptions,
    project_date_responses: responses,
  }, { failNotifications: true })
  await assert.doesNotReject(f.service.syncProjectDateSelection('project', new Date('2026-09-28T10:00:00.000Z')))
  assert.equal(f.tables.projects[0].date_selection_status, 'open')
})

test('hourly due-work scan includes open voting cycles inside the 24h window', async () => {
  const f = fixture({
    projects: [project()],
    participants: activeParticipants,
    project_date_options: activeOptions,
    project_date_responses: responses,
  })
  const result = await f.service.processDueProjectDateWork(new Date('2026-09-28T10:00:00.000Z'))
  assert.deepEqual(result, { checked: 1, changed: 0 })
  assert.equal(f.notifications.length, 1)
})
