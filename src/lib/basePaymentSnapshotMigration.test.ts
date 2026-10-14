import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../../supabase/migrations/20261014113000_snapshot_base_payment_obligations.sql', import.meta.url),
  'utf8'
)

test('base payment snapshot migration is additive and leaves unknown legacy values untouched', () => {
  assert.match(migration, /add column if not exists amount_cents integer/i)
  assert.match(migration, /add column if not exists collector_participant_id uuid/i)
  assert.match(migration, /payments_counted_snapshot_required[\s\S]*not valid/i)
  assert.doesNotMatch(migration, /update\s+public\.payments/i)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.payments/i)
})

test('base payment snapshots retain their original amount and recipient', () => {
  assert.match(migration, /before update of amount_cents, collector_participant_id/i)
  assert.match(migration, /old\.amount_cents is not null[\s\S]*immutable/i)
  assert.match(migration, /old\.collector_participant_id is not null[\s\S]*immutable/i)
  assert.match(migration, /references public\.participants\(id\)[\s\S]*on delete restrict/i)
})

test('snapshot trigger function is not directly executable by browser roles', () => {
  assert.match(
    migration,
    /revoke all on function public\.protect_counted_payment_snapshot\(\) from public, anon, authenticated/i
  )
  assert.match(
    migration,
    /grant execute on function public\.protect_counted_payment_snapshot\(\) to service_role/i
  )
})
