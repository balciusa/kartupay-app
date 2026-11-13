import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateProjectPricing } from './projectPricing.ts'

const sql = readFileSync(
  new URL('../../docs/sql/pr40_managed_approval_candidate.sql', import.meta.url), 'utf8'
)

test('PR40 managed SQL candidate has one project-first transaction and guarded role grants', () => {
  assert.match(sql, /BEGIN;[\s\S]*CREATE OR REPLACE FUNCTION[\s\S]*COMMIT;/)
  assert.match(sql, /FROM public\.projects WHERE id=p_project_id FOR UPDATE/)
  assert.match(sql, /WHERE id=p_request_id AND project_id=p_project_id FOR UPDATE/)
  assert.match(sql, /left_at IS NULL/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.pr40_approve_managed_membership_atomic/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.pr40_approve_managed_membership_atomic[\s\S]*TO service_role/)
})

test('PR40 managed SQL candidate keeps request, membership and money writes together', () => {
  assert.match(sql, /INSERT INTO public\.payment_options/)
  assert.match(sql, /INSERT INTO public\.late_join_transfers/)
  assert.match(sql, /ON CONFLICT \(project_id,from_participant_id,to_participant_id\) DO NOTHING/)
  assert.match(sql, /UPDATE public\.join_requests SET status='approved'/)
  assert.match(sql, /INSERT INTO public\.activity_logs/)
  assert.match(sql, /IF NOT FOUND THEN RAISE EXCEPTION 'Request state changed'/)
  assert.doesNotMatch(sql, /DELETE FROM public\.(payments|late_join_transfers|participant_refund_requests)/)
})

test('PR40 managed SQL candidate treats optional bundles as legacy fallback', () => {
  assert.match(sql, /to_jsonb\(pr\)->>'bundle_size'/)
  assert.match(sql, /to_jsonb\(pr\)->>'bundle_pay_for'/)
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
