export const TIME_HOURS_24 = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))
export const TIME_MINUTE_STEPS = Array.from({ length: 12 }, (_, step) => String(step * 5).padStart(2, '0'))

export type Time24Parts = {
  hour: string
  minute: string
}

export const isPartialTime24 = (parts: Time24Parts) =>
  (parts.hour !== '') !== (parts.minute !== '')

export const splitTime24 = (time: string): Time24Parts => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  return match ? { hour: match[1], minute: match[2] } : { hour: '', minute: '' }
}

export const combineTime24 = (hour: string, minute: string) =>
  TIME_HOURS_24.includes(hour) && /^[0-5]\d$/.test(minute) ? `${hour}:${minute}` : ''

export const getTime24MinuteOptions = (minute: string) => {
  const options = new Set(TIME_MINUTE_STEPS)
  if (/^[0-5]\d$/.test(minute)) options.add(minute)
  return Array.from(options).sort((left, right) => Number(left) - Number(right))
}

export const changeTime24Part = (
  parts: Time24Parts,
  part: keyof Time24Parts,
  value: string
) => {
  const nextParts = { ...parts, [part]: value }
  return { parts: nextParts, value: combineTime24(nextParts.hour, nextParts.minute) }
}
