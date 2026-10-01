import type { ProjectDateLocale } from './projectDateStrings'

export const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

export const isValidIsoDate = (value: string) => {
  if (!isIsoDate(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const getDatePickerAnchorDateKey = (
  value: string,
  min: string | undefined,
  todayKey: string
) => {
  if (isValidIsoDate(value)) return value
  if (min && isValidIsoDate(min) && min > todayKey) return min
  return todayKey
}

export const formatDateFieldValue = (value: string, locale: ProjectDateLocale) => {
  if (!isIsoDate(value)) return ''
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale === 'lt' ? 'lt-LT' : 'en-GB', {
    day: 'numeric',
    month: locale === 'lt' ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
