import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  changeTime24Part,
  combineTime24,
  getTime24MinuteOptions,
  getTime24Options,
  isPartialTime24,
  isTime24,
  splitTime24,
  TIME_HOURS_24,
  TIME_MINUTE_STEPS,
} from './time24.ts'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '../..')

function compile(path: string) {
  return ts.transpileModule(readFileSync(join(root, path), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: path,
  }).outputText
}

function loadTimePicker() {
  const exports = {}
  const load = (name: string): unknown => {
    if (name === '@/lib/time24') {
      return { getTime24Options, isTime24 }
    }
    return require(name)
  }
  new Function('require', 'exports', compile('src/components/ui/TimePicker24.tsx'))(load, exports)
  return exports as typeof import('../components/ui/TimePicker24')
}

const { TimePicker24 } = loadTimePicker()

function render(value: string, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(TimePicker24, {
    id: 'test-time',
    value,
    onChange: () => {},
    ...props,
  }))
}

test('Event options use 15-minute HH:mm values across the complete day', () => {
  const options = getTime24Options(15)
  assert.equal(options.length, 96)
  assert.deepEqual(options.slice(0, 4), ['00:00', '00:15', '00:30', '00:45'])
  assert.equal(options.at(-1), '23:45')
  assert.equal(options.includes('17:05'), false)
  assert.equal(options.some(value => /(?:AM|PM)/i.test(value)), false)
})

test('Transport options use 5-minute HH:mm values', () => {
  const options = getTime24Options(5)
  assert.equal(options.length, 288)
  assert.equal(options.includes('17:00'), true)
  assert.equal(options.includes('17:05'), true)
  assert.equal(options.includes('23:55'), true)
  assert.deepEqual(TIME_MINUTE_STEPS, ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'])
})

test('custom values are inserted in sorted position and never rounded', () => {
  assert.deepEqual(
    getTime24Options(15, '17:08').filter(value => value >= '17:00' && value <= '17:30'),
    ['17:00', '17:08', '17:15', '17:30']
  )
  assert.deepEqual(
    getTime24Options(5, '17:37').filter(value => value >= '17:30' && value <= '17:40'),
    ['17:30', '17:35', '17:37', '17:40']
  )
  assert.throws(() => getTime24Options(0), /stepMinutes/)
  assert.throws(() => getTime24Options(61), /stepMinutes/)
})

test('legacy time-part validation still accepts only empty optional or complete selections', () => {
  const states = {
    empty: { hour: '', minute: '' },
    complete: { hour: '18', minute: '30' },
    hourOnly: { hour: '18', minute: '' },
    minuteOnly: { hour: '', minute: '30' },
  }
  const valid = (parts: { hour: string; minute: string }, required: boolean) =>
    !(required || isPartialTime24(parts)) || (parts.hour !== '' && parts.minute !== '')

  assert.equal(valid(states.empty, false), true)
  assert.equal(valid(states.complete, false), true)
  assert.equal(valid(states.hourOnly, false), false)
  assert.equal(valid(states.minuteOnly, false), false)
  assert.equal(valid(states.empty, true), false)
  assert.equal(valid(states.hourOnly, true), false)
  assert.equal(valid(states.minuteOnly, true), false)
  assert.equal(valid(states.complete, true), true)
})

test('canonical time utilities preserve exact HH:mm values and partial edits', () => {
  assert.equal(TIME_HOURS_24.length, 24)
  assert.deepEqual(splitTime24('17:08'), { hour: '17', minute: '08' })
  assert.equal(combineTime24('17', '08'), '17:08')
  assert.equal(combineTime24('17', ''), '')
  assert.equal(isTime24('17:37'), true)
  assert.equal(isTime24('5:37'), false)
  assert.deepEqual(getTime24MinuteOptions('08').filter(value => ['05', '08', '10'].includes(value)), ['05', '08', '10'])
  assert.deepEqual(changeTime24Part({ hour: '17', minute: '08' }, 'hour', '18'), {
    parts: { hour: '18', minute: '08' },
    value: '18:08',
  })
})

test('TimePicker24 renders one compact field with a canonical named hidden value', () => {
  const html = render('17:08', { name: 'event_start_time', label: 'Start time', stepMinutes: 15 })
  assert.match(html, /data-time-picker-24/)
  assert.match(html, /data-step-minutes="15"/)
  assert.match(html, /name="event_start_time"/)
  assert.match(html, /type="hidden"[^>]*value="17:08"/)
  assert.match(html, />Start time</)
  assert.match(html, />17:08</)
  assert.equal((html.match(/<select/g) ?? []).length, 0)
  assert.match(html, /pattern="\(\?:\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d"/)
  assert.doesNotMatch(html, /type="time"/)
  assert.doesNotMatch(html, /\b(?:AM|PM)\b/i)
})

test('TimePicker24 empty, required, disabled, localized and ARIA states remain explicit', () => {
  const empty = render('', { locale: 'lt', required: true, 'aria-describedby': 'time-error', 'aria-invalid': true })
  assert.match(empty, /Pasirinkti laiką/)
  assert.match(empty, /required=""/)
  assert.match(empty, /aria-expanded="false"/)
  assert.match(empty, /aria-haspopup="listbox"/)
  assert.match(empty, /aria-describedby="time-error"/)
  assert.match(empty, /aria-invalid="true"/)

  const disabled = render('12:15', { name: 'departure_time', disabled: true })
  assert.ok((disabled.match(/disabled=""/g) ?? []).length >= 3)
})

test('TimePicker24 source provides scroll-to-selection and complete keyboard behavior', () => {
  const source = readFileSync(join(root, 'src/components/ui/TimePicker24.tsx'), 'utf8')
  for (const key of ['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.match(source, new RegExp(`event\\.key === '${key}'`))
  }
  assert.match(source, /scrollIntoView\(\{ block: 'center' \}\)/)
  assert.match(source, /role="listbox"/)
  assert.match(source, /role="option"/)
  assert.match(source, /aria-selected=\{selected\}/)
  assert.match(source, /touch-pan-y/)
  assert.match(source, /max-h-64/)
})

test('all Event and Transport surfaces use the shared component family with correct steps', () => {
  const eventFields = readFileSync(join(root, 'src/components/Project/EventDateTimeFields.tsx'), 'utf8')
  assert.equal((eventFields.match(/<TimePicker24/g) ?? []).length, 2)
  assert.equal((eventFields.match(/stepMinutes=\{15\}/g) ?? []).length, 2)
  assert.match(eventFields, /name="event_start_time"/)
  assert.match(eventFields, /name="event_end_time"/)
  assert.match(eventFields, /onEndDateChange\(''\)[\s\S]*onEndTimeChange\(''\)/)

  for (const path of [
    'src/components/Project/NewProjectForm.tsx',
    'src/components/Project/ProjectSettingsForm.tsx',
  ]) {
    const source = readFileSync(join(root, path), 'utf8')
    assert.match(source, /<EventDateTimeFields/)
    assert.doesNotMatch(source, /type="time"/)
  }

  const dateFinder = readFileSync(join(root, 'src/components/Project/ProjectDateFinder.tsx'), 'utf8')
  assert.equal((dateFinder.match(/stepMinutes=\{15\}/g) ?? []).length, 2)
  assert.match(dateFinder, /name="start_time"/)
  assert.match(dateFinder, /name="end_time"/)

  const transport = readFileSync(join(root, 'src/components/Project/ProjectTransport.tsx'), 'utf8')
  assert.match(transport, /<TimePicker24[\s\S]*stepMinutes=\{5\}/)
  assert.match(transport, /disabled=\{passengerCount > 0\}/)
})

test('event and transport display formatters explicitly suppress AM/PM', () => {
  const projectPage = readFileSync(join(root, 'src/app/project/[id]/page.tsx'), 'utf8')
  const dateSelection = readFileSync(join(root, 'src/lib/projectDateSelection.ts'), 'utf8')
  const transport = readFileSync(join(root, 'src/lib/projectTransport.ts'), 'utf8')
  assert.match(projectPage, /eventStartLocale = formatLocal24/)
  assert.match(projectPage, /hour12: false/)
  assert.match(dateSelection, /hour12: false/)
  assert.match(transport, /hour12: false/)
})
