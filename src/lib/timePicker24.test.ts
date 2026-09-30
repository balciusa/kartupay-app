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
      return {
        changeTime24Part,
        combineTime24,
        getTime24MinuteOptions,
        splitTime24,
        TIME_HOURS_24,
      }
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

function selectedOptions(html: string) {
  return Array.from(html.matchAll(/<option value="([^"]*)" selected="">/g), match => match[1])
}

test('TimePicker24 renders empty and representative HH:mm values deterministically', () => {
  assert.deepEqual(selectedOptions(render('')), ['', ''])
  assert.deepEqual(selectedOptions(render('08:05')), ['08', '05'])
  assert.deepEqual(selectedOptions(render('17:30')), ['17', '30'])
  assert.deepEqual(selectedOptions(render('23:55')), ['23', '55'])
  assert.equal(TIME_HOURS_24.length, 24)
  assert.deepEqual(TIME_MINUTE_STEPS, ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'])
})

test('TimePicker24 inserts and selects existing non-step minutes in numeric order', () => {
  for (const minute of ['08', '37']) {
    const html = render(`17:${minute}`)
    assert.deepEqual(selectedOptions(html), ['17', minute])
    const before = String(Number(minute) - (Number(minute) % 5)).padStart(2, '0')
    const after = String(Number(before) + 5).padStart(2, '0')
    assert.ok(html.indexOf(`value="${before}"`) < html.indexOf(`value="${minute}"`))
    assert.ok(html.indexOf(`value="${minute}"`) < html.indexOf(`value="${after}"`))
    assert.deepEqual(getTime24MinuteOptions(minute).filter(value => [before, minute, after].includes(value)), [before, minute, after])
  }
})

test('TimePicker24 changes one part without changing the other and emits padded HH:mm', () => {
  const changedHour = changeTime24Part({ hour: '08', minute: '05' }, 'hour', '17')
  assert.deepEqual(changedHour, { parts: { hour: '17', minute: '05' }, value: '17:05' })
  const changedMinute = changeTime24Part({ hour: '17', minute: '05' }, 'minute', '30')
  assert.deepEqual(changedMinute, { parts: { hour: '17', minute: '30' }, value: '17:30' })
  assert.equal(combineTime24('08', '05'), '08:05')
  assert.equal(combineTime24('17', '08'), '17:08')
  assert.equal(combineTime24('23', '55'), '23:55')
})

test('TimePicker24 has accessible labels, no AM/PM, and no native time input', () => {
  const html = render('19:45')
  assert.match(html, /role="group"/)
  assert.match(html, />Time</)
  assert.match(html, />Hour</)
  assert.match(html, />Minute</)
  assert.doesNotMatch(html, /\b(?:AM|PM)\b/i)
  assert.doesNotMatch(html, /type="time"/)
  assert.match(html, /min-h-11/)
})

test('TimePicker24 supports disabled, required, form name, and validation ARIA', () => {
  const html = render('12:15', {
    name: 'event_start_time',
    required: true,
    disabled: true,
    'aria-describedby': 'time-error',
    'aria-invalid': true,
  })
  assert.equal((html.match(/<select/g) ?? []).length, 2)
  assert.equal((html.match(/ required=""/g) ?? []).length, 2)
  assert.ok((html.match(/ disabled=""/g) ?? []).length >= 3)
  assert.equal((html.match(/aria-describedby="time-error"/g) ?? []).length, 2)
  assert.equal((html.match(/aria-invalid="true"/g) ?? []).length, 2)
  const hidden = html.match(/<input[^>]*type="hidden"[^>]*>/)?.[0] ?? ''
  assert.match(hidden, /name="event_start_time"/)
  assert.match(hidden, /value="12:15"/)
  assert.match(hidden, /disabled=""/)
})

test('event and transport time-entry surfaces all use TimePicker24', () => {
  const surfaces = [
    'src/components/Project/NewProjectForm.tsx',
    'src/components/Project/ProjectSettingsForm.tsx',
    'src/components/Project/ProjectDateFinder.tsx',
    'src/components/Project/ProjectTransport.tsx',
  ]
  for (const path of surfaces) {
    const source = readFileSync(join(root, path), 'utf8')
    assert.match(source, /<TimePicker24/)
    assert.doesNotMatch(source, /type="time"/)
    assert.doesNotMatch(source, /timeOptions/)
  }

  const create = readFileSync(join(root, surfaces[0]), 'utf8')
  assert.match(create, /name="event_start_time"/)
  assert.match(create, /name="event_end_time"/)
  assert.match(create, /A fixed project needs a confirmed start date and time/)
  assert.match(create, /Event end time requires an end date/)
  assert.match(create, /Event end must be after event start/)

  const settings = readFileSync(join(root, surfaces[1]), 'utf8')
  assert.match(settings, /value=\{startTime\}/)
  assert.match(settings, /value=\{endTime\}/)

  const dateFinder = readFileSync(join(root, surfaces[2]), 'utf8')
  assert.match(dateFinder, /name="start_time"/)
  assert.match(dateFinder, /name="end_time"/)
  assert.match(dateFinder, /startName="start_date"/)
  assert.doesNotMatch(dateFinder, /startName="start_date"[\s\S]{0,200}<TimePicker24/)
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
