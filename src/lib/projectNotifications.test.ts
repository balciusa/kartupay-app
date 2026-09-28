import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import * as joinRequests from './projectJoinRequests.ts'

type Row = Record<string, unknown>

function compile() {
  return ts.transpileModule(readFileSync(new URL('./projectNotifications.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'projectNotifications.ts',
  }).outputText
}

function fixture(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    project_notifications: [],
    participants: [],
    project_date_options: [],
    project_date_responses: [],
    ...initial,
  }
  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      const orders: Array<{ key: string; ascending: boolean }> = []
      let operation: 'select' | 'update' | 'upsert' = 'select'
      let values: Row | Row[] = {}
      let maxRows = Infinity
      const query = {
        select() { return query },
        eq(key: string, value: unknown) {
          filters.push(row => {
            if (key.startsWith('metadata->>')) {
              const metadataKey = key.slice('metadata->>'.length)
              const metadata = row.metadata as Record<string, unknown> | undefined
              return metadata?.[metadataKey] === value
            }
            return row[key] === value
          })
          return query
        },
        is(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
        in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query },
        order(key: string, options?: { ascending?: boolean }) {
          orders.push({ key, ascending: options?.ascending !== false })
          return query
        },
        limit(value: number) { maxRows = value; return query },
        update(value: Row) { operation = 'update'; values = value; return query },
        upsert(value: Row | Row[]) { operation = 'upsert'; values = value; return query },
        then(resolve: (result: { data: Row[]; error: null }) => void) {
          let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
          rows.sort((a, b) => {
            for (const order of orders) {
              const comparison = String(a[order.key]).localeCompare(String(b[order.key]))
              if (comparison) return order.ascending ? comparison : -comparison
            }
            return 0
          })
          rows = rows.slice(0, maxRows)
          if (operation === 'update') rows.forEach(row => Object.assign(row, values))
          if (operation === 'upsert') {
            for (const value of Array.isArray(values) ? values : [values]) {
              if (!tables[table].some(row => row.dedupe_key === value.dedupe_key)) {
                tables[table].push({ id: `notification-${tables[table].length + 1}`, read_at: null, created_at: '2026-09-28T10:00:00.000Z', ...value })
              }
            }
          }
          resolve({ data: rows, error: null })
        },
      }
      return query
    },
  }
  const exports: Record<string, unknown> = {}
  const modules: Record<string, unknown> = {
    'server-only': {},
    '@/lib/projectJoinRequests': joinRequests,
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
  }
  new Function('require', 'exports', compile())((name: string) => modules[name] ?? {}, exports)
  return {
    tables,
    notifications: exports as typeof import('./projectNotifications'),
  }
}

function notification(overrides: Row = {}): Row {
  return {
    id: 'notification',
    project_id: 'project',
    recipient_user_id: 'user',
    notification_type: 'date_confirmation_24h',
    title: 'Stored title',
    body: 'Stored body',
    metadata: {},
    dedupe_key: 'key',
    read_at: null,
    created_at: '2026-09-28T10:00:00.000Z',
    ...overrides,
  }
}

const context = {
  pendingJoinRequestIds: ['request'],
  dateAvailabilityRequired: true,
  attendanceConfirmationRequired: true,
}

test('loads only the authenticated recipient snapshot, newest first, capped at 20 with an accurate unread count', async () => {
  const rows = Array.from({ length: 25 }, (_, index) => notification({
    id: `own-${index}`,
    dedupe_key: `own-${index}`,
    created_at: `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    read_at: index % 2 === 0 ? null : '2026-09-28T11:00:00.000Z',
  }))
  rows.push(notification({ id: 'other-user', recipient_user_id: 'other', dedupe_key: 'other-user' }))
  rows.push(notification({ id: 'other-project', project_id: 'other', dedupe_key: 'other-project' }))
  const f = fixture({ project_notifications: rows })

  const result = await f.notifications.loadProjectNotifications('project', 'user', 'en', context)
  assert.equal(result.items.length, 20)
  assert.equal(result.items[0].id, 'own-24')
  assert.equal(result.items.at(-1)?.id, 'own-5')
  assert.equal(result.unreadCount, 10)
  assert.ok(result.items.every(item => !item.id.startsWith('other')))
})

test('known types use localized presentation and legacy types safely use stored copy', () => {
  const f = fixture()
  const join = f.notifications.presentProjectNotification(notification({
    notification_type: 'join_request_pending',
    metadata: { join_request_id: 'request' },
  }) as never, 'lt', context)
  assert.equal(join.title, 'Gautas prisijungimo prašymas')
  assert.equal(join.actionLabel, 'Peržiūrėti prašymą')
  assert.equal(join.href, '/project/project?tab=admin&adminModal=requests')

  const legacy = f.notifications.presentProjectNotification(notification({ notification_type: 'date_voting_reminder' }) as never, 'lt', context)
  assert.equal(legacy.title, 'Stored title')
  assert.equal(legacy.body, 'Stored body')
  assert.equal(legacy.href, null)
})

test('stale known notifications become non-actionable history', () => {
  const f = fixture()
  const stale = f.notifications.presentProjectNotification(notification({
    notification_type: 'date_availability_2h',
  }) as never, 'en', { ...context, dateAvailabilityRequired: false })
  assert.equal(stale.body, 'Your date availability is complete.')
  assert.equal(stale.actionLabel, null)
  assert.equal(stale.resolvedLabel, 'Resolved')
})

test('mark one is recipient- and project-scoped, idempotent, and retains history', async () => {
  const rows = [
    notification({ id: 'mine', dedupe_key: 'mine' }),
    notification({ id: 'other-user', recipient_user_id: 'other', dedupe_key: 'other-user' }),
    notification({ id: 'other-project', project_id: 'other', dedupe_key: 'other-project' }),
  ]
  const f = fixture({ project_notifications: rows })
  await f.notifications.markProjectNotificationReadForUser('project', 'mine', 'user')
  await f.notifications.markProjectNotificationReadForUser('project', 'mine', 'user')
  await f.notifications.markProjectNotificationReadForUser('project', 'other-user', 'user')
  await f.notifications.markProjectNotificationReadForUser('project', 'other-project', 'user')

  assert.ok(rows[0].read_at)
  assert.equal(rows[1].read_at, null)
  assert.equal(rows[2].read_at, null)
  assert.equal(rows.length, 3)
})

test('mark all affects only the current user and current project', async () => {
  const rows = [
    notification({ id: 'mine-a', dedupe_key: 'mine-a' }),
    notification({ id: 'mine-b', dedupe_key: 'mine-b' }),
    notification({ id: 'other-user', recipient_user_id: 'other', dedupe_key: 'other-user' }),
    notification({ id: 'other-project', project_id: 'other', dedupe_key: 'other-project' }),
  ]
  const f = fixture({ project_notifications: rows })
  await f.notifications.markAllProjectNotificationsReadForUser('project', 'user')
  assert.ok(rows[0].read_at)
  assert.ok(rows[1].read_at)
  assert.equal(rows[2].read_at, null)
  assert.equal(rows[3].read_at, null)
})

test('join request notifications use the existing private/public manager authority and dedupe by occurrence', async () => {
  const participants = [
    { id: 'organizer', project_id: 'project', user_id: 'organizer-user', role: 'organizer', left_at: null },
    { id: 'collector', project_id: 'project', user_id: 'collector-user', role: 'member', left_at: null },
    { id: 'member', project_id: 'project', user_id: 'member-user', role: 'member', left_at: null },
    { id: 'former-organizer', project_id: 'project', user_id: 'former-user', role: 'organizer', left_at: '2026-09-01' },
  ]
  const f = fixture({ participants })
  const base = {
    projectId: 'project',
    joinRequestId: 'request',
    requestedAt: '2026-09-28T10:00:00.000Z',
    collectorParticipantId: 'collector',
  }

  await f.notifications.enqueueJoinRequestNotifications({ ...base, isPublic: false })
  await f.notifications.enqueueJoinRequestNotifications({ ...base, isPublic: false })
  assert.deepEqual(f.tables.project_notifications.map(row => row.recipient_user_id), ['organizer-user'])

  await f.notifications.enqueueJoinRequestNotifications({ ...base, requestedAt: '2026-09-29T10:00:00.000Z', isPublic: true })
  assert.deepEqual(
    f.tables.project_notifications.slice(1).map(row => row.recipient_user_id).sort(),
    ['collector-user', 'organizer-user']
  )
  assert.ok(f.tables.project_notifications.every(row => !JSON.stringify(row).includes('requester-user')))
})

test('resolving a join request marks linked manager notifications read without deleting them', async () => {
  const rows = [
    notification({ id: 'linked-a', notification_type: 'join_request_pending', metadata: { join_request_id: 'request' }, dedupe_key: 'linked-a' }),
    notification({ id: 'linked-b', recipient_user_id: 'manager-b', notification_type: 'join_request_pending', metadata: { join_request_id: 'request' }, dedupe_key: 'linked-b' }),
    notification({ id: 'different', notification_type: 'join_request_pending', metadata: { join_request_id: 'other' }, dedupe_key: 'different' }),
  ]
  const f = fixture({ project_notifications: rows })
  await f.notifications.markJoinRequestNotificationsResolved('project', 'request')
  assert.ok(rows[0].read_at)
  assert.ok(rows[1].read_at)
  assert.equal(rows[2].read_at, null)
  assert.equal(rows.length, 3)
})

test('availability completion resolves reminders only after every active option has a response', async () => {
  const f = fixture({
    project_notifications: [
      notification({ id: '24h', notification_type: 'date_availability_24h', dedupe_key: '24h' }),
      notification({ id: '2h', notification_type: 'date_availability_2h', dedupe_key: '2h' }),
    ],
    project_date_options: [
      { id: 'a', project_id: 'project', status: 'active' },
      { id: 'b', project_id: 'project', status: 'active' },
      { id: 'removed', project_id: 'project', status: 'removed' },
    ],
    project_date_responses: [{ project_id: 'project', user_id: 'user', date_option_id: 'a' }],
  })
  assert.equal(await f.notifications.resolveCompletedDateAvailabilityNotifications('project', 'user'), false)
  assert.equal(f.tables.project_notifications[0].read_at, null)
  f.tables.project_date_responses.push({ project_id: 'project', user_id: 'user', date_option_id: 'b' })
  assert.equal(await f.notifications.resolveCompletedDateAvailabilityNotifications('project', 'user'), true)
  assert.ok(f.tables.project_notifications.every(row => row.read_at))
})
