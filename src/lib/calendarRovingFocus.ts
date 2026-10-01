export type CalendarFocusDay = {
  key: string
  inCurrentMonth: boolean
  disabled: boolean
}

export type CalendarNavigationKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'

export const findCalendarRovingFocusIndex = (
  days: CalendarFocusDay[],
  selectedKey: string,
  todayKey: string
) => {
  const selectedIndex = days.findIndex(day => day.key === selectedKey && !day.disabled)
  if (selectedIndex >= 0) return selectedIndex

  const todayIndex = days.findIndex(day => day.key === todayKey && !day.disabled)
  if (todayIndex >= 0) return todayIndex

  const currentMonthIndex = days.findIndex(day => day.inCurrentMonth && !day.disabled)
  if (currentMonthIndex >= 0) return currentMonthIndex

  return days.findIndex(day => !day.disabled)
}

export const getCalendarDayTabIndex = (
  days: CalendarFocusDay[],
  index: number,
  focusIndex: number
) => !days[index]?.disabled && index === focusIndex ? 0 : -1

const findEnabledFrom = (
  days: CalendarFocusDay[],
  startIndex: number,
  direction: -1 | 1,
  boundaryIndex: number
) => {
  for (
    let index = startIndex;
    direction === 1 ? index <= boundaryIndex : index >= boundaryIndex;
    index += direction
  ) {
    if (!days[index]?.disabled) return index
  }
  return -1
}

export const findCalendarNavigationIndex = (
  days: CalendarFocusDay[],
  currentIndex: number,
  key: CalendarNavigationKey
) => {
  if (!days[currentIndex] || days[currentIndex].disabled) return currentIndex

  let nextIndex = -1
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const direction = key === 'ArrowLeft' ? -1 : 1
    nextIndex = findEnabledFrom(
      days,
      currentIndex + direction,
      direction,
      direction === 1 ? days.length - 1 : 0
    )
  } else if (key === 'ArrowUp' || key === 'ArrowDown') {
    const direction = key === 'ArrowUp' ? -1 : 1
    nextIndex = findEnabledFrom(
      days,
      currentIndex + direction * 7,
      direction,
      direction === 1 ? days.length - 1 : 0
    )
  } else {
    const rowStart = currentIndex - (currentIndex % 7)
    const rowEnd = Math.min(rowStart + 6, days.length - 1)
    nextIndex = key === 'Home'
      ? findEnabledFrom(days, rowStart, 1, rowEnd)
      : findEnabledFrom(days, rowEnd, -1, rowStart)
  }

  return nextIndex >= 0 ? nextIndex : currentIndex
}
