import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  formatDateFieldValue,
  getDatePickerAnchorDateKey,
  isIsoDate,
} from './dateField.ts'

const root = resolve(import.meta.dirname, '../..')

test('single-date cards display localized friendly dates without changing the ISO value', () => {
  assert.equal(formatDateFieldValue('2026-10-01', 'en'), '1 Oct 2026')
  assert.equal(formatDateFieldValue('2026-10-01', 'lt'), '2026 m. spalio 1 d.')
  assert.equal(formatDateFieldValue('', 'en'), '')
  assert.equal(isIsoDate('2026-10-01'), true)
  assert.equal(isIsoDate('1 Oct 2026'), false)
})

test('DatePickerField reuses the DateRangePicker calendar and keeps canonical hidden submission', () => {
  const source = readFileSync(join(root, 'src/components/ui/DatePickerField.tsx'), 'utf8')
  assert.match(source, /CalendarMonth,[\s\S]*from '@\/components\/ui\/DateRangePicker'/)
  assert.match(source, /type="hidden" name=\{name\} value=\{canonicalValue\}/)
  assert.doesNotMatch(source, /type="date"/)
  assert.match(source, /aria-expanded=\{popupOpen\}/)
  assert.match(source, /aria-haspopup="dialog"/)
  assert.match(source, /event\.key === 'Escape'/)
  assert.match(source, /window\.innerWidth - margin \* 2/)
  assert.match(source, /max-h-\[calc\(100vh-2rem\)\]/)
})

test('empty DatePickerField opens on a future minimum month without changing its value', () => {
  assert.equal(getDatePickerAnchorDateKey('', '2026-12-15', '2026-10-01'), '2026-12-15')
  assert.equal(getDatePickerAnchorDateKey('', '2026-09-15', '2026-10-01'), '2026-10-01')
  assert.equal(getDatePickerAnchorDateKey('', 'invalid', '2026-10-01'), '2026-10-01')
})

test('a valid selected value remains the DatePickerField opening month anchor', () => {
  assert.equal(
    getDatePickerAnchorDateKey('2026-10-10', '2026-12-15', '2026-10-01'),
    '2026-10-10'
  )
})

test('shared calendar provides roving keyboard navigation', () => {
  const source = readFileSync(join(root, 'src/components/ui/DateRangePicker.tsx'), 'utf8')
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
    assert.match(source, new RegExp(key))
  }
  assert.match(source, /data-calendar-index=\{index\}/)
  assert.match(source, /tabIndex=\{getCalendarDayTabIndex\(dayStates, index, focusIndex\)\}/)
  assert.match(source, /findCalendarNavigationIndex/)
})

test('Event date-time fields collapse empty End values and explicitly clear both values', () => {
  const source = readFileSync(join(root, 'src/components/Project/EventDateTimeFields.tsx'), 'utf8')
  assert.match(source, /useState\(\(\) => Boolean\(endDate \|\| endTime\)\)/)
  assert.match(source, /onEndDateChange\(''\)[\s\S]*onEndTimeChange\(''\)[\s\S]*setEndExpanded\(false\)/)
  assert.match(source, /name="event_end_date" value=""/)
  assert.match(source, /name="event_end_time" value=""/)
  assert.match(source, /startRequired/)
  assert.match(source, /Pabaigos data ir laikas/)
})

test('New Project and Settings preserve controlled canonical date values', () => {
  const create = readFileSync(join(root, 'src/components/Project/NewProjectForm.tsx'), 'utf8')
  assert.match(create, /const \[eventStartDate, setEventStartDate\] = useState\(''\)/)
  assert.match(create, /startDate=\{eventStartDate\}/)
  assert.match(create, /onEndDateChange=\{setEventEndDate\}/)
  assert.match(create, /A fixed project needs a confirmed start date and time/)
  assert.match(create, /Event end time requires an end date/)
  assert.match(create, /Event end must be after event start/)

  const settings = readFileSync(join(root, 'src/components/Project/ProjectSettingsForm.tsx'), 'utf8')
  assert.match(settings, /useState\(initial\.eventStartDate\)/)
  assert.match(settings, /useState\(initial\.eventEndDate\)/)
  assert.match(settings, /startDate=\{startDate\}/)
  assert.match(settings, /endDate=\{endDate\}/)
})
