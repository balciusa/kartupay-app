import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countOccupiedSeats,
  decideSeatReservation,
  isActiveMembership,
  selectedDateDecisionRequirement,
} from './membershipDateFoundation.ts'

test('active membership alone defines seat occupancy', () => {
  assert.equal(isActiveMembership({ left_at: null }), true)
  assert.equal(isActiveMembership({ left_at: '2026-11-12T09:00:00.000Z' }), false)
  assert.equal(countOccupiedSeats([
    { left_at: null },
    { left_at: null },
    { left_at: '2026-11-12T09:00:00.000Z' },
  ]), 2)
})

test('seat reservation is idempotent for an already-active member', () => {
  assert.equal(decideSeatReservation({
    alreadyActive: true,
    occupiedSeats: 10,
    maxParticipants: 10,
  }), 'already_active')
})

test('seat reservation uses the active seat count and project limit', () => {
  assert.equal(decideSeatReservation({
    alreadyActive: false,
    occupiedSeats: 9,
    maxParticipants: 10,
  }), 'reserve')
  assert.equal(decideSeatReservation({
    alreadyActive: false,
    occupiedSeats: 10,
    maxParticipants: 10,
  }), 'full')
  assert.equal(decideSeatReservation({
    alreadyActive: false,
    occupiedSeats: 100,
    maxParticipants: null,
  }), 'reserve')
})

test('only an available vote satisfies the selected-date exception', () => {
  assert.equal(selectedDateDecisionRequirement('available'), 'satisfied_by_available_vote')
  assert.equal(selectedDateDecisionRequirement('maybe'), 'decision_required')
  assert.equal(selectedDateDecisionRequirement('unavailable'), 'decision_required')
  assert.equal(selectedDateDecisionRequirement(null), 'decision_required')
  assert.equal(selectedDateDecisionRequirement(undefined), 'decision_required')
})
