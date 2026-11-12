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

test('an available vote for another option does not satisfy the selected-date exception', () => {
  assert.equal(selectedDateDecisionRequirement('date-b', {
    date_option_id: 'date-a',
    availability: 'available',
  }), 'decision_required')
})

test('an available vote satisfies the exception only for the selected option', () => {
  assert.equal(selectedDateDecisionRequirement('date-b', {
    date_option_id: 'date-b',
    availability: 'available',
  }), 'satisfied_by_available_vote')
})

test('maybe and unavailable votes for the selected option require a decision', () => {
  assert.equal(selectedDateDecisionRequirement('date-b', {
    date_option_id: 'date-b',
    availability: 'maybe',
  }), 'decision_required')
  assert.equal(selectedDateDecisionRequirement('date-b', {
    date_option_id: 'date-b',
    availability: 'unavailable',
  }), 'decision_required')
})

test('a missing selected-option response requires a decision', () => {
  assert.equal(selectedDateDecisionRequirement('date-b', null), 'decision_required')
  assert.equal(selectedDateDecisionRequirement('date-b', undefined), 'decision_required')
})
