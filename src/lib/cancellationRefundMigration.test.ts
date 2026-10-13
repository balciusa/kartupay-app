import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../../supabase/migrations/20261012145129_cancellation_refund_workflow.sql', import.meta.url),
  'utf8'
)
const recovery = readFileSync(
  new URL('../../supabase/rollback/20261012145129_cancellation_refund_workflow.rollback.sql', import.meta.url),
  'utf8'
)

test('refund migration preserves history and separates open obligations by recipient', () => {
  assert.match(migration, /on delete restrict/gi)
  assert.doesNotMatch(migration, /on delete cascade/i)
  assert.match(migration, /late_transfer_amount_cents/)
  assert.match(migration, /project_id, participant_id, collector_participant_id/)
  assert.match(migration, /status in \('pending', 'approved', 'sent'\)/)
})

test('refund Data API is read-only for active authenticated members', () => {
  assert.match(migration, /to authenticated[\s\S]+using \(private\.kartupay_is_active_project_member\(project_id\)\)/)
  assert.match(migration.toLowerCase(), /revoke all privileges[^;]+from anon, authenticated/)
  assert.match(migration.toLowerCase(), /grant select[^;]+to authenticated/)
  assert.doesNotMatch(migration, /grant (insert|update|delete|all)[^;]+to authenticated/i)
})

test('emergency recovery retains financial rows and never restores permissive policies', () => {
  assert.doesNotMatch(recovery, /drop table|truncate|delete from/i)
  assert.match(recovery.toLowerCase(), /revoke all privileges[^;]+from anon, authenticated/)
  assert.doesNotMatch(recovery, /for (insert|update|delete)/i)
})
