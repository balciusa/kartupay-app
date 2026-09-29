import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

type DatabaseError = { code: string; message: string }

const compile = (path: string) => ts.transpileModule(readFileSync(resolve(path), 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: path,
}).outputText

const fixture = (options: {
  missingColumns?: string[]
  projectError?: DatabaseError
  project?: Record<string, unknown>
  viewer?: { id: string } | null
} = {}) => {
  const missingColumns = new Set(options.missingColumns ?? [])
  const projectSelects: string[] = []
  const project = {
    id: 'project',
    transport_enabled: true,
    date_mode: 'fixed',
    event_start_at: '2026-10-10T10:00:00.000Z',
    event_end_at: '2026-10-10T18:00:00.000Z',
    status: 'pending',
    canceled_at: null,
    aborted_at: null,
    event_location_label: 'Venue',
    event_location_address: 'Address',
    ...options.project,
  }

  const supabaseAdmin = {
    from(table: string) {
      let fields = ''
      const query = {
        select(value: string) { fields = value; return query },
        eq() { return query },
        is() { return query },
        order() { return query },
        maybeSingle() { return query },
        then(done: (value: unknown) => void) {
          if (table === 'projects') {
            projectSelects.push(fields)
            if (options.projectError) return done({ data: null, error: options.projectError })
            const missing = [...missingColumns].find(column => fields.includes(column))
            if (missing) {
              return done({
                data: null,
                error: { code: '42703', message: `column projects.${missing} does not exist` },
              })
            }
            const data = Object.fromEntries(
              fields.split(',').map(field => field.trim()).filter(Boolean).map(field => [field, project[field as keyof typeof project]])
            )
            return done({ data, error: null })
          }
          if (table === 'participants' && fields === 'id') {
            return done({ data: options.viewer === undefined ? { id: 'viewer-participant' } : options.viewer, error: null })
          }
          if (table === 'participants') {
            return done({
              data: [{ id: 'viewer-participant', short_code: 'VIEW', attendance_status: 'confirmed', users: null }],
              error: null,
            })
          }
          return done({ data: [], error: null })
        },
      }
      return query
    },
  }

  const exports: Record<string, unknown> = {}
  const load = (name: string) => {
    if (name === 'server-only') return {}
    if (name === './supabaseAdmin') return { supabaseAdmin }
    if (name === './projectInvite') {
      return {
        isProjectCanceled: (row: { status?: string | null; canceled_at?: string | null; aborted_at?: string | null }) =>
          row.status === 'canceled' || row.status === 'cancelled' || !!row.canceled_at || !!row.aborted_at,
      }
    }
    throw new Error(`Unexpected module: ${name}`)
  }
  new Function('require', 'exports', compile('src/lib/projectTransportServer.ts'))(load, exports)
  return {
    loadProjectTransport: exports.loadProjectTransport as (input: {
      projectId: string
      viewerUserId: string
      locale: 'en' | 'lt'
    }) => Promise<{
      planningReady: boolean
      projectCanceled: boolean
      eventLocation: string | null
    } | null>,
    projectSelects,
  }
}

const input = { projectId: 'project', viewerUserId: 'viewer', locale: 'en' as const }

test('missing aborted_at retries without it and preserves cancellation detection from available fields', async () => {
  const active = fixture({ missingColumns: ['aborted_at'] })
  const snapshot = await active.loadProjectTransport(input)
  assert.ok(snapshot)
  assert.equal(snapshot.projectCanceled, false)
  assert.equal(active.projectSelects.some(fields => fields.includes('aborted_at')), true)
  assert.equal(active.projectSelects.some(fields => !fields.includes('aborted_at')), true)

  const canceled = fixture({ missingColumns: ['aborted_at'], project: { canceled_at: '2026-10-01T00:00:00.000Z' } })
  assert.equal((await canceled.loadProjectTransport(input))?.projectCanceled, true)
})

test('missing optional location columns do not prevent transport loading', async () => {
  const f = fixture({ missingColumns: ['event_location_label', 'event_location_address'] })
  const snapshot = await f.loadProjectTransport(input)
  assert.ok(snapshot)
  assert.equal(snapshot.eventLocation, null)
  assert.equal(f.projectSelects.at(-1)?.includes('event_location_label'), false)
  assert.equal(f.projectSelects.at(-1)?.includes('event_location_address'), false)
})

test('unresolved Date Finder still returns transport data with planning locked', async () => {
  const f = fixture({ project: { date_mode: 'selecting', event_start_at: null } })
  const snapshot = await f.loadProjectTransport(input)
  assert.ok(snapshot)
  assert.equal(snapshot.planningReady, false)
})

test('inactive viewer receives no transport snapshot', async () => {
  const f = fixture({ viewer: null })
  assert.equal(await f.loadProjectTransport(input), null)
})

test('a genuine project query error is not mistaken for an optional-column fallback', async () => {
  const f = fixture({ projectError: { code: 'XX000', message: 'database unavailable' } })
  await assert.rejects(f.loadProjectTransport(input), (error: unknown) =>
    (error as DatabaseError).code === 'XX000' && (error as DatabaseError).message === 'database unavailable')
})
