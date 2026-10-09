import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const source = (path: string) => readFileSync(join(root, path), 'utf8')

test('migration adds a nullable constrained duration column without rewriting legacy data', () => {
  const migration = source('supabase/migrations/20261001_add_project_event_duration.sql')
  assert.match(migration, /add column if not exists event_duration_nights integer/i)
  assert.match(migration, /event_duration_nights >= 0[\s\S]*event_duration_nights <= 365/i)
  assert.doesNotMatch(migration, /add column[^;]*event_duration_nights[^;]*not null/i)
  assert.doesNotMatch(migration, /add column[^;]*event_duration_nights[^;]*default/i)
  assert.doesNotMatch(migration, /update\s+public\.projects\s+set|delete\s+from/i)
})

test('database rejects direct date-option writes that violate the project duration', () => {
  const migration = source('supabase/migrations/20261001_add_project_event_duration.sql')

  assert.match(migration, /function public\.enforce_project_date_option_duration\(\)/i)
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i)
  assert.match(migration, /before insert or update of project_id, starts_at, ends_at[\s\S]*on public\.project_date_options/i)
  assert.match(migration, /select project\.event_duration_nights[\s\S]*where project\.id = new\.project_id[\s\S]*for update/i)
  assert.match(migration, /if v_duration_nights is null then[\s\S]*return new/i)
  assert.match(migration, /new\.starts_at at time zone 'UTC'[\s\S]*new\.starts_at <> v_start_midnight/i)
  assert.match(migration, /v_duration_nights = 0[\s\S]*new\.ends_at is not null[\s\S]*raise exception/i)
  assert.match(migration, /::date \+ v_duration_nights[\s\S]*at time zone 'UTC'/i)
  assert.match(migration, /new\.ends_at is null or new\.ends_at <> v_expected_end/i)
  assert.match(migration, /message = 'Date option does not match project event duration'/i)
  assert.match(migration, /revoke all on function public\.enforce_project_date_option_duration\(\)[\s\S]*from public, anon, authenticated/i)
})

test('database locks duration after option history while leaving fixed projects editable', () => {
  const migration = source('supabase/migrations/20261001_add_project_event_duration.sql')

  assert.match(migration, /function public\.guard_project_event_duration_change\(\)/i)
  assert.match(migration, /exists \([\s\S]*from public\.project_date_options option[\s\S]*option\.project_id = new\.id/i)
  assert.match(migration, /Project event duration cannot change after date options exist/i)
  assert.match(migration, /before update of event_duration_nights[\s\S]*on public\.projects/i)
  assert.match(migration, /when \(old\.event_duration_nights is distinct from new\.event_duration_nights\)/i)
  assert.doesNotMatch(migration, /where option\.project_id = new\.id[\s\S]*raise exception[\s\S]*else[\s\S]*raise exception/i)
})

test('database serializes candidate writes with deadline changes and preserves legacy rows', () => {
  const migration = source('supabase/migrations/20261008_enforce_date_candidate_after_voting_deadline.sql')

  assert.match(migration, /Existing date option violates voting deadline date/i)
  assert.match(migration, /select[\s\S]*date_voting_deadline_at[\s\S]*from public\.projects[\s\S]*for update/i)
  assert.match(migration, /event_duration_nights is null then[\s\S]*return new/i)
  assert.match(migration, /new\.starts_at at time zone 'UTC'[\s\S]*<= \(v_project\.date_voting_deadline_at at time zone 'UTC'\)::date/i)
  assert.match(migration, /message = 'Date option must start after voting deadline date'/i)
  assert.match(migration, /function public\.guard_project_date_candidate_deadline\(\)/i)
  assert.match(migration, /before update of date_voting_deadline_at, date_mode, event_duration_nights/i)
  assert.match(migration, /option\.project_id = new\.id[\s\S]*option\.starts_at at time zone 'UTC'/i)
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i)
  assert.match(migration, /revoke all on function public\.guard_project_date_candidate_deadline\(\)[\s\S]*from public, anon, authenticated/i)
  assert.doesNotMatch(migration, /update\s+public\.project_date_options|delete\s+from\s+public\.project_date_options/i)
})

test('new project UI requires one duration before both date modes and submits start candidates only', () => {
  const form = source('src/components/Project/NewProjectForm.tsx')
  const durationIndex = form.indexOf('<EventDurationField')
  const modeIndex = form.indexOf('name="date_mode"')
  assert.ok(durationIndex >= 0 && durationIndex < modeIndex)
  assert.match(form, /durationBacked[\s\S]*durationNights=\{eventDurationNights\}/)
  assert.match(form, /<EventDateCandidatePicker[\s\S]*max=\{MAX_INITIAL_DATE_OPTIONS\}/)
  assert.doesNotMatch(form, /name="date_option_end_date"/)
})

test('server owns fixed and selecting end derivation and rejects duplicate starts', () => {
  const creation = source('src/app/project/new/actions.ts')
  assert.match(creation, /deriveEndDate\(event_start_date, eventDurationNights\)/)
  assert.match(creation, /deriveDateOptionFromStart[\s\S]*eventDurationNights/)
  assert.match(creation, /initialDateOptions\.map\(option => option\.startsAt\)/)
  assert.match(creation, /event_duration_nights: eventDurationNights/)

  const actions = source('src/app/project/[id]/actions.ts')
  assert.match(actions, /select\('[^']*event_duration_nights[^']*'\)/)
  assert.match(actions, /durationBacked[\s\S]*deriveDateOptionFromStart\(startDateRaw, project\.event_duration_nights\)/)
  assert.match(actions, /durationBacked[\s\S]*await duplicateQuery\.maybeSingle\(\)/)
})

test('legacy NULL loaders and settings retain legacy behavior while selecting duration is immutable', () => {
  const service = source('src/lib/projectDateService.ts')
  assert.match(service, /event_duration_nights: null/)
  assert.match(service, /isMissingDurationColumn/)

  const settings = source('src/components/Project/ProjectSettingsForm.tsx')
  assert.match(settings, /initial\.eventDurationNights !== null/)
  assert.match(settings, /disabled=\{initial\.dateMode === 'selecting' \|\| initial\.dateControlledByFinder\}/)
  assert.match(settings, /durationBacked=\{initial\.eventDurationNights !== null\}/)

  const actions = source('src/app/project/[id]/actions.ts')
  assert.match(actions, /Event duration cannot be changed after a Choose Together project is created/)
  assert.match(actions, /project\.date_mode === 'selecting' \|\| dateControlledByFinder \? project\.event_end_at : eventEndAt/)
})

test('candidate calendar exposes only starts as selections and keeps continuation dates visual', () => {
  const candidate = source('src/components/Project/EventDateCandidatePicker.tsx')
  const calendar = source('src/components/ui/DateRangePicker.tsx')
  assert.match(candidate, /name = 'date_option_start_date'/)
  assert.match(candidate, /selectedDateKeys=\{value\}/)
  assert.match(candidate, /coveredDateKeys=\{coveredDateKeys\}/)
  assert.match(candidate, /value\.includes\(selected\)[\s\S]*value\.filter/)
  assert.match(calendar, /aria-pressed=\{selectedDateKeys \? isCandidateStart : undefined\}/)
  assert.match(calendar, /const isCovered = coveredKeys\.has\(key\) && !isCandidateStart/)
  assert.match(calendar, /getCalendarDayTabIndex\(dayStates, index, focusIndex\)/)
})

test('Date Finder displays the project duration and uses start-only suggestions when available', () => {
  const finder = source('src/components/Project/ProjectDateFinder.tsx')
  assert.match(finder, /formatEventDuration\(data\.eventDurationNights, locale\)/)
  assert.match(finder, /durationNights === null \? \([\s\S]*<DateRangePicker[\s\S]*<EventDateCandidatePicker/)
  assert.match(finder, /name="start_date"[\s\S]*single/)
  assert.match(finder, /votingDeadlineAt=\{data\.votingDeadlineAt\}/)
  assert.match(finder, /min=\{earliestStart\}/)
})

test('dependent deadline UI preserves invalid candidates, reports them, and blocks creation', () => {
  const form = source('src/components/Project/NewProjectForm.tsx')
  const candidate = source('src/components/Project/EventDateCandidatePicker.tsx')

  assert.match(form, /value=\{votingDeadlineDate\}[\s\S]*onChange=\{event => \{[\s\S]*setVotingDeadlineDate/)
  assert.match(form, /min=\{earliestCandidateStart \|\| undefined\}/)
  assert.match(form, /candidateDependencyError[\s\S]*disabled=\{isCreating \|\| hasDependentError\}/)
  assert.match(form, /participantDependencyError[\s\S]*role="alert"/)
  assert.match(form, /sameDayTimeError[\s\S]*aria-invalid/)
  assert.match(candidate, /invalidStarts[\s\S]*data-invalid-candidate/)
  assert.match(candidate, /role="alert"/)
  assert.doesNotMatch(candidate, /onChange\(value\.filter\(candidate => candidate < min/)
})

test('client and server share the explicit UTC voting deadline convention without changing fixed dates', () => {
  const form = source('src/components/Project/NewProjectForm.tsx')
  const creation = source('src/app/project/new/actions.ts')

  assert.match(form, /isVotingDeadlineMoreThan24HoursAway\(votingDeadlineDate, deadlineValidationNow\)/)
  assert.doesNotMatch(form, /new Date\(`\$\{votingDeadlineDate\}T23:59:00`\)/)
  assert.match(creation, /votingDeadlineTimestampUtc\(votingDeadlineDate\)/)
  assert.match(creation, /isVotingDeadlineMoreThan24HoursAway\(votingDeadlineDate\)/)
  assert.match(creation, /date_mode === 'fixed' \? parseEventDateTime\(event_start_date, event_start_time, '09:00'\) : null/)
})
