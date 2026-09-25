import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  applyDateResponse,
  applyTimeToDateOption,
  attendanceAfterSelection,
  buildSelectionOutcome,
  canRemoveDateOption,
  confirmationStatusAfterDeadline,
  dateAvailabilityTaskForParticipant,
  deriveProjectDatePresentationState,
  financeReadiness,
  fullyRespondedDateParticipantIds,
  haveAllActiveParticipantsResponded,
  isDuplicateDateOption,
  isDateOnlyOption,
  normalizeDateOnlyOption,
  rankDateOptions,
  reenterViaLateJoinFlow,
  type DateOptionLike,
  type DateResponseLike,
} from './projectDateSelection.ts'

const options: DateOptionLike[] = [
  { id: 'a', starts_at: '2026-10-01T10:00:00.000Z', ends_at: null, status: 'active', created_by_user_id: 'u1' },
  { id: 'b', starts_at: '2026-10-02T10:00:00.000Z', ends_at: null, status: 'active', created_by_user_id: 'u2' },
]

const response = (
  date_option_id: string,
  user_id: string,
  availability: DateResponseLike['availability'],
  is_preferred = false
): DateResponseLike => ({ date_option_id, user_id, availability, is_preferred })

test('1. new participant receives an open date-selection priority task', () => {
  assert.deepEqual(dateAvailabilityTaskForParticipant({ dateMode: 'selecting', activeOptionIds: ['a'], responses: [], userId: 'new' }), {
    type: 'date_availability',
    status: 'open',
  })
})

test('2. one user can mark multiple dates available', () => {
  let responses: DateResponseLike[] = []
  responses = applyDateResponse(responses, response('a', 'u1', 'available'))
  responses = applyDateResponse(responses, response('b', 'u1', 'available'))
  assert.equal(responses.filter(item => item.user_id === 'u1' && item.availability === 'available').length, 2)
})

test('3. one user can have only one preferred date', () => {
  let responses = [response('a', 'u1', 'available', true)]
  responses = applyDateResponse(responses, response('b', 'u1', 'available', true))
  assert.deepEqual(responses.filter(item => item.is_preferred).map(item => item.date_option_id), ['b'])
  assert.throws(() => applyDateResponse(responses, response('a', 'u1', 'maybe', true)), /must also be available/)
})

test('4. maybe does not count toward the project minimum', () => {
  const result = financeReadiness({
    participants: [{ attendance_status: 'confirmed' }, { attendance_status: 'awaiting_confirmation' }],
    minimumParticipants: 2,
    hasFinalDate: true,
    paymentsReady: true,
  })
  assert.equal(result.confirmedCount, 1)
  assert.equal(result.minimumReached, false)
  assert.equal(result.ready, false)
})

test('5. an exact duplicate date or range is detected', () => {
  assert.equal(isDuplicateDateOption(options, options[0].starts_at, null), true)
  assert.equal(isDuplicateDateOption(options, '2026-10-03T10:00:00.000Z', null), false)
})

test('6. proposer can remove an untouched option', () => {
  assert.equal(canRemoveDateOption({ option: options[0], actorUserId: 'u1', isOrganizer: false, responses: [], }), true)
})

test('7. proposer cannot remove after another member responds', () => {
  assert.equal(canRemoveDateOption({
    option: options[0],
    actorUserId: 'u1',
    isOrganizer: false,
    responses: [response('a', 'u2', 'maybe')],
  }), false)
})

test('8. highest available count wins', () => {
  const result = rankDateOptions(options, [
    response('a', 'u1', 'available'), response('a', 'u2', 'available'), response('b', 'u1', 'available'),
  ])
  assert.equal(result.kind, 'winner')
  assert.equal(result.winnerId, 'a')
})

test('9. preferred votes break equal available counts', () => {
  const result = rankDateOptions(options, [
    response('a', 'u1', 'available'), response('b', 'u2', 'available', true),
  ])
  assert.equal(result.kind, 'winner')
  assert.equal(result.winnerId, 'b')
})

test('10. exact tie requires organizer decision', () => {
  const result = rankDateOptions(options, [response('a', 'u1', 'available'), response('b', 'u2', 'available')])
  assert.equal(result.kind, 'tie')
  assert.deepEqual(result.tiedOptionIds.sort(), ['a', 'b'])
})

test('11. winning option becomes the fixed final project date', () => {
  const result = buildSelectionOutcome({ option: options[0], participantUserIds: ['u1'], responses: [response('a', 'u1', 'available')] })
  assert.equal(result.dateMode, 'fixed')
  assert.equal(result.selectedDateOptionId, 'a')
  assert.equal(result.eventStartAt, options[0].starts_at)
})

test('12. maybe users receive a confirmation task', () => {
  const result = buildSelectionOutcome({ option: options[0], participantUserIds: ['u1', 'u2'], responses: [response('a', 'u1', 'maybe')] })
  assert.deepEqual(result.confirmationTaskUserIds, ['u1'])
  assert.equal(result.attendanceByUserId.u1, 'awaiting_confirmation')
  assert.equal(result.attendanceByUserId.u2, 'unconfirmed')
})

test('13. still-unconfirmed users are excluded after the deadline', () => {
  assert.equal(confirmationStatusAfterDeadline('awaiting_confirmation'), 'unconfirmed')
  assert.equal(attendanceAfterSelection('maybe'), 'awaiting_confirmation')
  assert.equal(financeReadiness({ participants: [{ attendance_status: 'unconfirmed' }], minimumParticipants: 1, hasFinalDate: true, paymentsReady: true }).ready, false)
})

test('14. late confirmation re-enters through the existing late-join delegate', async () => {
  let calls = 0
  const result = await reenterViaLateJoinFlow(
    { attendanceStatus: 'unconfirmed', confirmedCount: 2, maxParticipants: 4 },
    async () => { calls += 1; return 'existing-flow' }
  )
  assert.equal(result, 'existing-flow')
  assert.equal(calls, 1)
})

test('15. finance readiness uses confirmed participants only', () => {
  const result = financeReadiness({
    participants: [
      { attendance_status: 'confirmed' },
      { attendance_status: 'awaiting_confirmation' },
      { attendance_status: 'cannot_attend' },
      { attendance_status: 'unconfirmed' },
    ],
    minimumParticipants: 2,
    hasFinalDate: true,
    paymentsReady: true,
  })
  assert.deepEqual(result, { confirmedCount: 1, minimumReached: false, ready: false })
})

test('16. date-only options normalize without requiring a time', () => {
  const option = normalizeDateOnlyOption('2026-11-07', '2026-11-09')
  assert.deepEqual(option, {
    startsAt: '2026-11-07T00:00:00.000Z',
    endsAt: '2026-11-09T00:00:00.000Z',
  })
  assert.equal(isDateOnlyOption(option.startsAt, option.endsAt), true)
})

test('17. invalid and reversed date-only ranges are rejected', () => {
  assert.throws(() => normalizeDateOnlyOption('2026-02-30', null), /Invalid start date/)
  assert.throws(() => normalizeDateOnlyOption('2026-11-09', '2026-11-07'), /must end after/)
})

test('18. a time can be added after a date-only option is selected', () => {
  assert.deepEqual(applyTimeToDateOption({
    startsAt: '2026-11-07T00:00:00.000Z',
    endsAt: null,
    startTime: '18:30',
    endTime: '21:00',
    timezoneOffsetMinutes: -120,
  }), {
    eventStartAt: '2026-11-07T16:30:00.000Z',
    eventEndAt: '2026-11-07T19:00:00.000Z',
  })
})

test('19. selected-date time validation rejects invalid ranges', () => {
  assert.throws(() => applyTimeToDateOption({
    startsAt: '2026-11-07T00:00:00.000Z',
    startTime: '21:00',
    endTime: '18:00',
    timezoneOffsetMinutes: -120,
  }), /End time must be after/)
})

test('20. Date Finder presentation state follows persisted lifecycle and response completion', () => {
  const base = {
    dateMode: 'selecting' as const,
    selectionStatus: 'open' as const,
    selectedDateOptionId: null,
    respondedCount: 1,
    memberCount: 2,
  }
  assert.equal(deriveProjectDatePresentationState(base), 'collecting_responses')
  assert.equal(deriveProjectDatePresentationState({ ...base, respondedCount: 2 }), 'all_responded')
  assert.equal(deriveProjectDatePresentationState({ ...base, selectionStatus: 'awaiting_organizer_decision' }), 'organizer_decision_required')
  assert.equal(deriveProjectDatePresentationState({
    ...base,
    dateMode: 'fixed',
    selectionStatus: 'confirmation_open',
    selectedDateOptionId: 'a',
  }), 'final_date_confirmed')
})

test('21. early finalization requires every active participant to complete every active option', () => {
  const complete = [
    response('a', 'u1', 'available'), response('b', 'u1', 'maybe'),
    response('a', 'u2', 'unavailable'), response('b', 'u2', 'available'),
  ]
  assert.deepEqual(fullyRespondedDateParticipantIds(['a', 'b'], complete, ['u1', 'u2']), ['u1', 'u2'])
  assert.equal(haveAllActiveParticipantsResponded(['a', 'b'], complete, ['u1', 'u2']), true)
  assert.equal(haveAllActiveParticipantsResponded(['a', 'b'], complete.filter(item => !(item.user_id === 'u2' && item.date_option_id === 'b')), ['u1', 'u2']), false)
  assert.equal(haveAllActiveParticipantsResponded(['a', 'b'], [response('a', 'u1', 'available')], ['u1']), false)
})

test('22. removed options and former participants do not block active-scope completion', () => {
  const activeScopeResponses = [response('a', 'u1', 'available')]
  assert.equal(haveAllActiveParticipantsResponded(['a'], activeScopeResponses, ['u1']), true)
  assert.equal(haveAllActiveParticipantsResponded(['a'], activeScopeResponses, ['u1', 'former']), false)
  assert.equal(haveAllActiveParticipantsResponded([], activeScopeResponses, ['u1']), false)
})

test('23. selected-date attendance mapping stays available, maybe, unavailable', () => {
  assert.equal(attendanceAfterSelection('available'), 'confirmed')
  assert.equal(attendanceAfterSelection('maybe'), 'awaiting_confirmation')
  assert.equal(attendanceAfterSelection('unavailable'), 'cannot_attend')
})

const atomicMigration = readFileSync(
  new URL('../../supabase/migrations/20260925_make_early_date_finalization_atomic.sql', import.meta.url),
  'utf8'
)

test('24. atomic early-selection RPC locks before database-time deadline and completion checks', () => {
  const functionStart = atomicMigration.indexOf('create or replace function public.select_project_date_early')
  const projectLock = atomicMigration.indexOf('for update;', functionStart)
  const databaseClock = atomicMigration.indexOf('v_checked_at := clock_timestamp();', functionStart)
  const completion = atomicMigration.indexOf('cross join public.project_date_options option', functionStart)
  const apply = atomicMigration.indexOf('perform public.apply_project_date_selection', functionStart)
  assert.ok(functionStart >= 0)
  assert.ok(projectLock > functionStart)
  assert.ok(databaseClock > projectLock)
  assert.ok(completion > databaseClock)
  assert.ok(apply > completion)
  assert.match(atomicMigration, /date_voting_deadline_at <= v_checked_at/)
  assert.match(atomicMigration, /participant\.left_at is null/)
  assert.match(atomicMigration, /option\.status = 'active'/)
  assert.match(atomicMigration, /response\.date_option_id = option\.id[\s\S]*response\.user_id = participant\.user_id/)
})

test('25. scope-expanding mutations and response writes share the project-row lock', () => {
  assert.match(atomicMigration, /initialize_project_participant_date_state\(\)[\s\S]*new\.left_at is null[\s\S]*for update;/)
  assert.match(atomicMigration, /project_date_options_lock_open_scope[\s\S]*before insert or update of status/)
  assert.match(atomicMigration, /project_date_responses_lock_open_scope[\s\S]*before insert or update/)
  assert.match(atomicMigration, /lock_open_project_date_scope\(\)[\s\S]*for update;[\s\S]*date_voting_deadline_at <= clock_timestamp\(\)/)
})

test('26. early-selection RPC is service-only and preserves the existing lifecycle implementation', () => {
  assert.match(atomicMigration, /revoke all on function public\.select_project_date_early\(uuid, uuid, timestamptz\)[\s\S]*from public, anon, authenticated/)
  assert.match(atomicMigration, /grant execute on function public\.select_project_date_early\(uuid, uuid, timestamptz\)[\s\S]*to service_role/)
  assert.match(atomicMigration, /perform public\.apply_project_date_selection\([\s\S]*p_project_id,[\s\S]*p_option_id,[\s\S]*p_confirmation_deadline/)
})
