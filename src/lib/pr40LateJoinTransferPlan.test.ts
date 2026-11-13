import assert from 'node:assert/strict'
import test from 'node:test'
import { planPr40LateJoinTransfers, type Pr40LateJoinPlanInput } from './pr40LateJoinTransferPlan.ts'

const before = [
  { id: 'a', active: true, confirmed: true, joinedAt: '2026-01-01T00:00:00Z', countedPayment: true },
  { id: 'b', active: true, confirmed: true, joinedAt: '2026-01-02T00:00:00Z', countedPayment: false },
  { id: 'c', active: true, confirmed: false, joinedAt: '2026-01-03T00:00:00Z', countedPayment: true },
  { id: 'left', active: false, confirmed: true, joinedAt: '2025-01-01T00:00:00Z', countedPayment: true },
]
const input: Pr40LateJoinPlanInput = {
  newcomerId: 'new',
  newcomerJoinedAt: '2026-01-04T00:00:00Z',
  participants: before,
  finalizedAt: null,
  status: 'collecting',
  collectorId: 'a',
  organizerFallbackId: null,
  pricing: { totalCents: 10000, totalIsPerPerson: false, bundleSize: null, bundlePayFor: null },
}

test('collecting: eligible denominator includes unpaid, recipients only counted paid', () => {
  const result = planPr40LateJoinTransfers(input)
  assert.equal(result.priorParticipantCount, 2)
  assert.equal(result.recipientCount, 1)
  assert.deepEqual(result.rows, [{ fromParticipantId: 'new', toParticipantId: 'a', expectedCents: 1667 }])
})

test('finalized: every eligible recipient even without counted payment', () => {
  const result = planPr40LateJoinTransfers({ ...input, finalizedAt: '2026-01-06T00:00:00Z', status: 'closed' })
  assert.equal(result.recipientCount, 2)
  assert.equal(result.rows.length, 2)
})

test('late join window excludes members who joined after newcomer', () => {
  const result = planPr40LateJoinTransfers({
    ...input,
    participants: [...before, { id: 'later', active: true, confirmed: true, joinedAt: '2026-01-08T00:00:00Z', countedPayment: true }],
  })
  assert.equal(result.priorParticipantCount, 2)
  assert.equal(result.rows.length, 1)
})

test('collecting and no counted paid recipients => no transfers despite active members', () => {
  const result = planPr40LateJoinTransfers({
    ...input, participants: before.map(p => ({ ...p, countedPayment: false })),
  })
  assert.equal(result.reason, 'no_recipients')
  assert.deepEqual(result.rows, [])
})

test('bundle threshold can reverse direction and exclude collector as payer', () => {
  const result = planPr40LateJoinTransfers({
    ...input,
    pricing: { totalCents: 3000, totalIsPerPerson: true, bundleSize: 3, bundlePayFor: 2 },
    participants: [
      { id: 'a', active: true, confirmed: true, joinedAt: '2026-01-01T00:00:00Z', countedPayment: true },
      { id: 'b', active: true, confirmed: true, joinedAt: '2026-01-02T00:00:00Z', countedPayment: true },
      { id: 'd', active: true, confirmed: true, joinedAt: '2026-01-03T00:00:00Z', countedPayment: true },
    ],
  })
  assert.equal(result.pricing?.direction, 'existing_to_collector')
  assert.equal(result.rows.length, 2)
  assert.deepEqual(result.rows.map(r => r.fromParticipantId).sort(), ['b', 'd'])
  assert.ok(result.rows.every(r => r.toParticipantId === 'a'))
})

test('missing collector in reverse direction must not produce imaginary payments', () => {
  const result = planPr40LateJoinTransfers({
    ...input,
    collectorId: null,
    organizerFallbackId: null,
    pricing: { totalCents: 3000, totalIsPerPerson: true, bundleSize: 3, bundlePayFor: 2 },
    participants: [
      { id: 'a', active: true, confirmed: true, joinedAt: null, countedPayment: true },
      { id: 'b', active: true, confirmed: true, joinedAt: null, countedPayment: true },
      { id: 'd', active: true, confirmed: true, joinedAt: null, countedPayment: true },
    ],
  })
  assert.equal(result.reason, 'collector_not_found')
})

test('unfinalized pending project has no late-transfer obligations', () => {
  assert.equal(planPr40LateJoinTransfers({ ...input, status: 'pending' }).reason, 'not_collecting_or_finalized')
})

test('per-person flat rate produces zero delta and no rows', () => {
  const result = planPr40LateJoinTransfers({
    ...input,
    pricing: { totalCents: 2000, totalIsPerPerson: true, bundleSize: null, bundlePayFor: null },
  })
  assert.equal(result.reason, 'no_share_change')
  assert.deepEqual(result.rows, [])
})
