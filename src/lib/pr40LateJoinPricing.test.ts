import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateProjectPricing } from './projectPricing.ts'
import { calculatePr40LateJoinDifference } from './pr40LateJoinPricing.ts'

type Case = {
  title: string
  totalCents: number
  totalIsPerPerson: boolean
  bundleSize: number | null
  bundlePayFor: number | null
  before: number
  expectedDirection: 'newcomer_to_recipients' | 'existing_to_collector' | 'none'
}

const cases: Case[] = [
  { title: 'fixed total 100 EUR 4 to 5', totalCents: 10000, totalIsPerPerson: false, bundleSize: null, bundlePayFor: null, before: 4, expectedDirection: 'newcomer_to_recipients' },
  { title: 'per-person price without bundle', totalCents: 2000, totalIsPerPerson: true, bundleSize: null, bundlePayFor: null, before: 3, expectedDirection: 'none' },
  { title: 'buy 3 pay 2 at bundle boundary', totalCents: 3000, totalIsPerPerson: true, bundleSize: 3, bundlePayFor: 2, before: 2, expectedDirection: 'newcomer_to_recipients' },
  { title: 'buy 3 pay 2 after boundary', totalCents: 3000, totalIsPerPerson: true, bundleSize: 3, bundlePayFor: 2, before: 3, expectedDirection: 'existing_to_collector' },
  { title: 'rounding fixed total 1 cent', totalCents: 1, totalIsPerPerson: false, bundleSize: null, bundlePayFor: null, before: 2, expectedDirection: 'none' },
  { title: 'zero total', totalCents: 0, totalIsPerPerson: true, bundleSize: 5, bundlePayFor: 3, before: 4, expectedDirection: 'none' },
]

for (const input of cases) {
  test('PR40 pricing parity: ' + input.title, () => {
    const pricing = {
      totalCents: input.totalCents,
      totalIsPerPerson: input.totalIsPerPerson,
      bundleSize: input.bundleSize,
      bundlePayFor: input.bundlePayFor,
    }
    const before = calculateProjectPricing({ ...pricing, participantCount: input.before }).perPersonCents
    const after = calculateProjectPricing({ ...pricing, participantCount: input.before + 1 }).perPersonCents
    const actual = calculatePr40LateJoinDifference(pricing, input.before)
    assert.equal(actual.priorShareCents, before)
    assert.equal(actual.nextShareCents, after)
    assert.equal(actual.perPersonCents, Math.abs(before - after))
    assert.equal(actual.direction, input.expectedDirection)
  })
}

test('atomic migration approves only the locked pending request', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20261116205555_atomic_membership_and_managed_approval.sql', import.meta.url),
    'utf8'
  )
  assert.match(migration, /update public\.join_requests[\s\S]*?set status = 'approved'[\s\S]*?where id = request_row\.id and status = 'pending'/i)
  assert.doesNotMatch(migration, /status <> 'approved'/i)
  assert.match(migration, /where id = p_project_id[\s\S]*?for update/i)
  assert.match(migration, /left_at is null/i)
  assert.match(migration, /revoke all on function public\.approve_managed_membership_atomic/i)
})
