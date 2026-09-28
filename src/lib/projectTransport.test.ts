import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  deriveTransportStatuses,
  parseTransportDeparture,
  remainingTransportSeats,
  summarizeTransport,
  type TransportOffer,
  type TransportParticipant,
} from './projectTransport.ts'

const participants: TransportParticipant[] = Array.from({ length: 10 }, (_, index) => ({
  id: `p${index + 1}`,
  name: `Person ${index + 1}`,
  attendanceStatus: 'confirmed',
}))

const offer = (overrides: Partial<TransportOffer> = {}): TransportOffer => ({
  id: 'offer-1', projectId: 'project', direction: 'to_event', driverParticipantId: 'p1',
  locationText: 'Vilnius', departureAt: '2026-10-09T05:00:00.000Z', seatCapacity: 3,
  note: null, createdAt: '2026-09-28T10:00:00.000Z', assignments: [], ...overrides,
})

test('derived state priority is driver, passenger, intent, then not decided', () => {
  const offers = [offer({ assignments: [{
    id: 'assignment', projectId: 'project', direction: 'to_event', offerId: 'offer-1',
    participantId: 'p2', joinedAt: '2026-09-28T11:00:00.000Z',
  }] })]
  const statuses = deriveTransportStatuses({
    participants: participants.slice(0, 5), offers, direction: 'to_event',
    intents: [
      { participantId: 'p1', direction: 'to_event', intent: 'needs_ride' },
      { participantId: 'p2', direction: 'to_event', intent: 'own_arrangement' },
      { participantId: 'p3', direction: 'to_event', intent: 'needs_ride' },
      { participantId: 'p4', direction: 'to_event', intent: 'own_arrangement' },
    ],
  })
  assert.deepEqual(statuses.map(status => status.state), [
    'driver', 'passenger', 'needs_ride', 'own_arrangement', 'not_decided',
  ])
})

test('directions are independent for the same participant', () => {
  const offers = [
    offer(),
    offer({
      id: 'return-offer', direction: 'from_event', driverParticipantId: 'p2',
      assignments: [{
        id: 'return-assignment', projectId: 'project', direction: 'from_event', offerId: 'return-offer',
        participantId: 'p1', joinedAt: '2026-09-28T11:00:00.000Z',
      }],
    }),
  ]
  const toEvent = deriveTransportStatuses({ participants: participants.slice(0, 2), offers, intents: [], direction: 'to_event' })
  const fromEvent = deriveTransportStatuses({ participants: participants.slice(0, 2), offers, intents: [], direction: 'from_event' })
  assert.equal(toEvent.find(status => status.participantId === 'p1')?.state, 'driver')
  assert.equal(fromEvent.find(status => status.participantId === 'p1')?.state, 'passenger')
})

test('definitively non-attending participants are excluded', () => {
  const statuses = deriveTransportStatuses({
    participants: [
      { id: 'confirmed', name: 'Confirmed', attendanceStatus: 'confirmed' },
      { id: 'no', name: 'No', attendanceStatus: 'cannot_attend' },
      { id: 'observer', name: 'Observer', attendanceStatus: 'observer' },
    ], offers: [], intents: [], direction: 'to_event',
  })
  assert.deepEqual(statuses.map(status => status.participantId), ['confirmed'])
})

test('capacity is derived and returns when assignments close', () => {
  const withTwo = offer({ assignments: [
    { id: 'a1', projectId: 'project', direction: 'to_event', offerId: 'offer-1', participantId: 'p2', joinedAt: '2026-09-28T11:00:00Z' },
    { id: 'a2', projectId: 'project', direction: 'to_event', offerId: 'offer-1', participantId: 'p3', joinedAt: '2026-09-28T11:01:00Z' },
  ] })
  assert.equal(remainingTransportSeats(offer()), 3)
  assert.equal(remainingTransportSeats(withTwo), 1)
  assert.equal(remainingTransportSeats(offer({ assignments: [...withTwo.assignments, {
    id: 'a3', projectId: 'project', direction: 'to_event', offerId: 'offer-1', participantId: 'p4', joinedAt: '2026-09-28T11:02:00Z',
  }] })), 0)
  assert.equal(remainingTransportSeats(offer({ assignments: withTwo.assignments.slice(0, 1) })), 2)
})

test('summary counts every eligible participant exactly once', () => {
  const offers = [
    offer({ id: 'o1', driverParticipantId: 'p1', seatCapacity: 2, assignments: [
      { id: 'a1', projectId: 'project', direction: 'to_event', offerId: 'o1', participantId: 'p3', joinedAt: '2026-09-28T11:00:00Z' },
      { id: 'a2', projectId: 'project', direction: 'to_event', offerId: 'o1', participantId: 'p4', joinedAt: '2026-09-28T11:01:00Z' },
    ] }),
    offer({ id: 'o2', driverParticipantId: 'p2', seatCapacity: 4, assignments: [
      { id: 'a3', projectId: 'project', direction: 'to_event', offerId: 'o2', participantId: 'p5', joinedAt: '2026-09-28T11:02:00Z' },
    ] }),
  ]
  const statuses = deriveTransportStatuses({ participants, offers, direction: 'to_event', intents: [
    { participantId: 'p6', direction: 'to_event', intent: 'own_arrangement' },
    { participantId: 'p7', direction: 'to_event', intent: 'needs_ride' },
    { participantId: 'p8', direction: 'to_event', intent: 'needs_ride' },
  ] })
  assert.deepEqual(summarizeTransport({ statuses, offers, direction: 'to_event' }), {
    drivers: 2, passengers: 3, availableSeats: 3, needsRide: 2, ownArrangement: 1, notDecided: 2,
  })
  assert.equal(statuses.length, 10)
})

test('departure parsing preserves the submitted local wall time via its explicit offset', () => {
  assert.equal(parseTransportDeparture('2026-10-09T08:00', -180), '2026-10-09T05:00:00.000Z')
  assert.throws(() => parseTransportDeparture('2026-10-09', -180), /departure date and time/)
  assert.throws(() => parseTransportDeparture('2026-02-31T08:00', -120), /Invalid departure/)
})

test('migration mutation RPCs enforce state, ownership, project, and canceled/toggle/date gates', () => {
  const migration = readFileSync('supabase/migrations/20260928_create_project_transport.sql', 'utf8')
  assert.match(migration, /assert_project_transport_mutation_ready[\s\S]*not v_project\.transport_enabled/i)
  assert.match(migration, /v_project\.date_mode <> 'fixed' or v_project\.event_start_at is null/i)
  assert.match(migration, /status[\s\S]*in \('canceled', 'cancelled'\)/i)
  assert.match(migration, /v_offer\.driver_participant_id <> p_driver_participant_id[\s\S]*Only the driver/i)
  assert.match(migration, /offer\.id = p_offer_id and offer\.project_id = p_project_id/i)
  assert.match(migration, /A driver cannot join their own ride/i)
  assert.match(migration, /A driver cannot join another ride in the same direction/i)
})

test('migration keeps history and implements leave, removal, cancellation, and edit invariants', () => {
  const migration = readFileSync('supabase/migrations/20260928_create_project_transport.sql', 'utf8')
  assert.match(migration, /leave_project_transport_offer[\s\S]*set left_at = now\(\)/i)
  assert.match(migration, /remove_project_transport_passenger[\s\S]*set left_at = now\(\)[\s\S]*'needs_ride'/i)
  assert.match(migration, /cancel_project_transport_offer[\s\S]*set canceled_at = now\(\)[\s\S]*set left_at = now\(\)[\s\S]*'needs_ride'/i)
  assert.match(migration, /p_seat_capacity < v_passenger_count/i)
  assert.match(migration, /v_passenger_count > 0[\s\S]*p_location_text[\s\S]*p_departure_at/i)
  assert.doesNotMatch(migration, /delete from public\.project_transport_(offers|assignments)/i)
})

test('migration cleanup covers both directions and restores displaced eligible passengers', () => {
  const migration = readFileSync('supabase/migrations/20260928_create_project_transport.sql', 'utf8')
  assert.match(migration, /cleanup_project_transport_participant[\s\S]*driver_participant_id = p_participant_id[\s\S]*canceled_at = now\(\)/i)
  assert.match(migration, /cleanup_project_transport_participant[\s\S]*affected\.participant_id[\s\S]*'needs_ride'/i)
  assert.match(migration, /assignment\.participant_id = p_participant_id[\s\S]*assignment\.left_at is null/i)
  assert.match(migration, /delete from public\.project_transport_intents[\s\S]*participant_id = p_participant_id/i)
  assert.match(migration, /cannot_attend', 'observer'/i)
})

test('migration contains transactional seat lock, unique defenses, RLS, cleanup, and no transport notifications', () => {
  const migration = readFileSync('supabase/migrations/20260928_create_project_transport.sql', 'utf8')
  assert.match(migration, /join_project_transport_offer[\s\S]*for update;/i)
  assert.match(migration, /v_active_count >= v_offer\.seat_capacity/i)
  assert.match(migration, /project_transport_assignments_active_participant_direction_idx[\s\S]*where left_at is null/i)
  assert.match(migration, /project_transport_offers_active_driver_direction_idx[\s\S]*where canceled_at is null/i)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /participant\.user_id = \(select auth\.uid\(\)\)[\s\S]*participant\.left_at is null/i)
  assert.match(migration, /participants_cleanup_project_transport[\s\S]*after update of left_at, attendance_status/i)
  assert.match(migration, /cancel_project_transport_offer[\s\S]*intent[\s\S]*'needs_ride'/i)
  assert.doesNotMatch(migration, /project_notifications/i)
})

test('tab and form sources contain the gated transport surface and default-off toggle', () => {
  const tabs = readFileSync('src/components/Project/ProjectTabs.tsx', 'utf8')
  const page = readFileSync('src/app/project/[id]/page.tsx', 'utf8')
  const form = readFileSync('src/components/Project/NewProjectForm.tsx', 'utf8')
  assert.match(tabs, /key: 'transport'[\s\S]*enabled: !!sections\.transport/)
  assert.match(page, /project\.transport_enabled === true && uid && isMeParticipant/)
  assert.match(page, /transport: transportSnapshot \? <ProjectTransport/)
  assert.match(form, /name="transport_enabled" value="true"/)
  assert.doesNotMatch(form, /name="transport_enabled"[^>]*defaultChecked/)
})
