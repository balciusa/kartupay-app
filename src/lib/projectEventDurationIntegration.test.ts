import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const source = (path: string) => readFileSync(join(root, path), 'utf8')

test('migration adds only a nullable constrained duration column without rewriting legacy data', () => {
  const migration = source('supabase/migrations/20261001_add_project_event_duration.sql')
  assert.match(migration, /add column if not exists event_duration_nights integer/i)
  assert.match(migration, /event_duration_nights >= 0[\s\S]*event_duration_nights <= 365/i)
  assert.doesNotMatch(migration, /not null|default\s+\d|update\s+public\.projects|project_date_options|delete\s+from/i)
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
})
