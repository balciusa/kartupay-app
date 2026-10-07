import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveDateOptionFromStart,
  deriveCandidateDateKeys,
  deriveEndDate,
  formatEventDuration,
  validateEventDurationNights,
} from './projectEventDuration.ts'

test('derives same-day and multi-night options with date-only UTC arithmetic', () => {
  assert.deepEqual(deriveDateOptionFromStart('2026-10-10', 0), {
    startsAt: '2026-10-10T00:00:00.000Z',
    endsAt: null,
  })
  assert.equal(deriveEndDate('2026-10-10', 1), '2026-10-11')
  assert.equal(deriveEndDate('2026-10-10', 2), '2026-10-12')
})

test('handles month, year, leap-year, and DST boundaries as calendar dates', () => {
  assert.equal(deriveEndDate('2026-10-31', 1), '2026-11-01')
  assert.equal(deriveEndDate('2026-12-31', 2), '2027-01-02')
  assert.equal(deriveEndDate('2027-02-28', 1), '2027-03-01')
  assert.equal(deriveEndDate('2028-02-28', 1), '2028-02-29')
  assert.equal(deriveEndDate('2028-02-29', 1), '2028-03-01')
  assert.equal(deriveEndDate('2026-03-28', 2), '2026-03-30')
  assert.equal(deriveEndDate('2026-10-24', 2), '2026-10-26')
})

test('rejects invalid duration values and invalid calendar dates', () => {
  for (const value of [-1, 366, 1.5, '', 'two', null, undefined]) {
    assert.throws(() => validateEventDurationNights(value))
  }
  assert.throws(() => deriveEndDate('2026-02-30', 1))
})

test('formats English and Lithuanian duration labels', () => {
  assert.equal(formatEventDuration(0, 'en'), 'Same day')
  assert.equal(formatEventDuration(0, 'lt'), 'Tą pačią dieną')
  assert.equal(formatEventDuration(1, 'lt'), '1 naktis')
  assert.equal(formatEventDuration(2, 'lt'), '2 naktys')
  assert.equal(formatEventDuration(10, 'lt'), '10 naktų')
  assert.equal(formatEventDuration(21, 'lt'), '21 naktis')
})

test('candidate coverage keeps one start identity and permits overlapping spans', () => {
  assert.deepEqual(deriveCandidateDateKeys('2026-10-10', 2), [
    '2026-10-10',
    '2026-10-11',
    '2026-10-12',
  ])
  assert.deepEqual(deriveCandidateDateKeys('2026-10-11', 2), [
    '2026-10-11',
    '2026-10-12',
    '2026-10-13',
  ])
})
