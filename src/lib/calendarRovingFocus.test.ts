import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findCalendarNavigationIndex,
  findCalendarRovingFocusIndex,
  getCalendarDayTabIndex,
  type CalendarFocusDay,
  type CalendarNavigationKey,
} from './calendarRovingFocus.ts'

const day = (
  key: string,
  inCurrentMonth = true,
  disabled = false
): CalendarFocusDay => ({ key, inCurrentMonth, disabled })

test('roving focus prefers enabled selected and today dates', () => {
  const days = [
    day('2026-09-28', false),
    day('2026-10-01'),
    day('2026-10-02'),
  ]

  assert.equal(findCalendarRovingFocusIndex(days, '2026-10-02', '2026-10-01'), 2)
  assert.equal(findCalendarRovingFocusIndex(days, '', '2026-10-01'), 1)
})

test('disabled selected and today dates fall back to the first enabled current-month date', () => {
  const days = [
    day('2026-09-28', false),
    day('2026-10-01', true, true),
    day('2026-10-02', true, true),
    day('2026-10-03'),
  ]

  assert.equal(findCalendarRovingFocusIndex(days, '2026-10-02', '2026-10-01'), 3)
})

test('roving focus falls back to an enabled visible day and allows no target when all are disabled', () => {
  const visibleFallback = [
    day('2026-09-28', false, true),
    day('2026-09-29', false),
    day('2026-10-01', true, true),
  ]
  const allDisabled = visibleFallback.map(value => ({ ...value, disabled: true }))

  assert.equal(findCalendarRovingFocusIndex(visibleFallback, '', '2026-09-28'), 1)
  assert.equal(findCalendarRovingFocusIndex(allDisabled, '', '2026-09-28'), -1)
})

test('only one enabled day is tabbable and disabled days always have tabIndex -1', () => {
  const days = [
    day('2026-10-01', true, true),
    day('2026-10-02'),
    day('2026-10-03'),
  ]
  const focusIndex = findCalendarRovingFocusIndex(days, '', '2026-10-01')
  const tabIndexes = days.map((_, index) => getCalendarDayTabIndex(days, index, focusIndex))

  assert.deepEqual(tabIndexes, [-1, 0, -1])
  assert.equal(tabIndexes.filter(value => value === 0).length, 1)
  assert.equal(getCalendarDayTabIndex(days, 0, 0), -1)
})

test('arrow navigation skips disabled dates and never returns a disabled target', () => {
  const days = Array.from({ length: 21 }, (_, index) => day(`day-${index}`))
  days[6].disabled = true
  days[8].disabled = true
  days[14].disabled = true

  const movements: Array<[CalendarNavigationKey, number]> = [
    ['ArrowLeft', 5],
    ['ArrowRight', 9],
    ['ArrowUp', 0],
    ['ArrowDown', 15],
  ]

  for (const [key, expected] of movements) {
    const result = findCalendarNavigationIndex(days, 7, key)
    assert.equal(result, expected)
    assert.equal(days[result].disabled, false)
  }
})

test('Home and End choose enabled dates in the current row or retain current focus', () => {
  const days = Array.from({ length: 14 }, (_, index) => day(`day-${index}`))
  days[7].disabled = true
  days[13].disabled = true

  assert.equal(findCalendarNavigationIndex(days, 10, 'Home'), 8)
  assert.equal(findCalendarNavigationIndex(days, 10, 'End'), 12)

  for (let index = 7; index <= 13; index += 1) days[index].disabled = index !== 10
  assert.equal(findCalendarNavigationIndex(days, 10, 'Home'), 10)
  assert.equal(findCalendarNavigationIndex(days, 10, 'End'), 10)
})

test('DateRangePicker behavior is retained when no dates are disabled', () => {
  const days = Array.from({ length: 14 }, (_, index) =>
    day(`day-${index}`, index >= 2)
  )

  assert.equal(findCalendarRovingFocusIndex(days, 'day-5', 'day-4'), 5)
  assert.equal(findCalendarRovingFocusIndex(days, '', 'day-4'), 4)
  assert.equal(findCalendarRovingFocusIndex(days, '', 'missing'), 2)
  assert.equal(findCalendarNavigationIndex(days, 7, 'ArrowLeft'), 6)
  assert.equal(findCalendarNavigationIndex(days, 7, 'ArrowRight'), 8)
  assert.equal(findCalendarNavigationIndex(days, 7, 'ArrowUp'), 0)
  assert.equal(findCalendarNavigationIndex(days, 0, 'ArrowDown'), 7)
})
