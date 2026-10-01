import type { ProjectDateLocale } from './projectDateStrings'

export const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

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
