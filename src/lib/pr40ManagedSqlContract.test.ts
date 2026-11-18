import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateProjectPricing } from './projectPricing.ts'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261116205555_atomic_membership_and_managed_approval.sql', import.meta.url), 'utf8'
)

test('PR40 migration has project-first transactions and service-role-only grants', () => {
  assert.match(sql, /begin;[\s\S]*create or replace function[\s\S]*commit;/i)
  assert.match(sql, /from public\.projects[\s\S]*where id = p_project_id[\s\S]*for update/i)
  assert.match(sql, /where id = p_request_id and project_id = p_project_id[\s\S]*for update/i)
  assert.match(sql, /left_at is null/i)
  assert.match(sql, /revoke all on function public\.approve_managed_membership_atomic/i)
  assert.match(sql, /revoke all on function public\.get_membership_approval_context/i)
  assert.match(sql, /grant execute on function public\.approve_managed_membership_atomic[\s\S]*to service_role/i)
  assert.match(sql, /grant execute on function public\.get_membership_approval_context[\s\S]*to service_role/i)
  assert.doesNotMatch(sql, /to anon|to authenticated/i)
})

test('PR40 managed migration keeps request, membership and money writes together', () => {
  assert.match(sql, /insert into public\.payment_options/i)
  assert.match(sql, /insert into public\.late_join_transfers/i)
  assert.match(sql, /on conflict \(project_id, from_participant_id, to_participant_id\) do nothing/i)
  assert.match(sql, /update public\.join_requests[\s\S]*set status = 'approved'/i)
  assert.match(sql, /insert into public\.activity_logs/i)
  assert.match(sql, /raise exception 'Request state changed'/i)
  assert.doesNotMatch(sql, /delete from public\.(payments|late_join_transfers|participant_refund_requests)/i)
})

test('PR40 managed migration treats optional bundles as legacy fallback', () => {
  assert.match(sql, /to_jsonb\(locked_project\)->>'bundle_size'/)
  assert.match(sql, /to_jsonb\(locked_project\)->>'bundle_pay_for'/)
})

test('PR40 pure pricing golden values at fee and bundle boundaries', () => {
  const cases = [
    [10000, false, 4, null, null, 2500],
    [10000, false, 5, null, null, 2000],
    [3000, true, 2, 3, 2, 3000],
    [3000, true, 3, 3, 2, 2000],
    [3000, true, 4, 3, 2, 2250],
    [1, false, 2, null, null, 0],
  ] as const
  for (const [totalCents,totalIsPerPerson,participantCount,bundleSize,bundlePayFor,expected] of cases) {
    assert.equal(calculateProjectPricing({totalCents,totalIsPerPerson,participantCount,bundleSize,bundlePayFor}).perPersonCents,expected)
  }
})
