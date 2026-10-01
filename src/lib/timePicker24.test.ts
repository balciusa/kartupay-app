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
  isPartialTime24,
  splitTime24,
  TIME_HOURS_24,
  TIME_MINUTE_STEPS,
} from './time24.ts'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '../..')

const getTimePickerProps = (source: string, id: string) => {
  const idIndex = source.indexOf(`id="${id}"`)
  assert.notEqual(idIndex, -1, `Missing TimePicker24 with id ${id}`)
  const start = source.lastIndexOf('<TimePicker24', idIndex)
  const end = source.indexOf('/>', idIndex)
  assert.notEqual(start, -1, `Missing TimePicker24 start for ${id}`)
  assert.notEqual(end, -1, `Missing TimePicker24 end for ${id}`)
  return source.slice(start, end + 2)
}

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
        isPartialTime24,
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

test('TimePicker24 native constraints accept only empty optional or complete selections', () => {
  const states = {
    empty: { hour: '', minute: '' },
    complete: { hour: '18', minute: '30' },
    hourOnly: { hour: '18', minute: '' },
    minuteOnly: { hour: '', minute: '30' },
  }
  const constraint = (parts: { hour: string; minute: string }, required: boolean) => {
    const selectRequired = required || isPartialTime24(parts)
    const valid = !selectRequired || (parts.hour !== '' && parts.minute !== '')
    return { selectRequired, valid }
  }

  assert.deepEqual(constraint(states.empty, false), { selectRequired: false, valid: true })
  assert.deepEqual(constraint(states.complete, false), { selectRequired: false, valid: true })
  assert.deepEqual(constraint(states.hourOnly, false), { selectRequired: true, valid: false })
  assert.deepEqual(constraint(states.minuteOnly, false), { selectRequired: true, valid: false })
  assert.deepEqual(constraint(states.empty, true), { selectRequired: true, valid: false })
  assert.deepEqual(constraint(states.hourOnly, true), { selectRequired: true, valid: false })
  assert.deepEqual(constraint(states.minuteOnly, true), { selectRequired: true, valid: false })
  assert.deepEqual(constraint(states.complete, true), { selectRequired: true, valid: true })
  assert.equal(isPartialTime24(states.empty), false, 'clearing both parts restores optional validity')
})

test('TimePicker24 keeps canonical hidden values empty or complete, never malformed', () => {
  assert.equal(combineTime24('18', '30'), '18:30')
  assert.equal(combineTime24('08', '05'), '08:05')
  assert.equal(combineTime24('', ''), '')
  assert.equal(combineTime24('18', ''), '')
  assert.equal(combineTime24('', '30'), '')
  const component = readFileSync(join(root, 'src/components/ui/TimePicker24.tsx'), 'utf8')
  assert.match(component, /required=\{required \|\| isPartial\}/)
  assert.match(component, /if \(!isPartialTime24\(next\.parts\)\) \{\s*onChange\(next\.value\)/)
})

test('TimePicker24 preserves partial edits until the user completes or clears them', () => {
  const transition = (parts: { hour: string; minute: string }, part: 'hour' | 'minute', value: string) => {
    const next = changeTime24Part(parts, part, value)
    return {
      parts: next.parts,
      emitted: isPartialTime24(next.parts) ? undefined : next.value,
    }
  }

  assert.deepEqual(transition({ hour: '17', minute: '08' }, 'hour', '18'), {
    parts: { hour: '18', minute: '08' },
    emitted: '18:08',
  })
  assert.deepEqual(transition({ hour: '18', minute: '08' }, 'minute', ''), {
    parts: { hour: '18', minute: '' },
    emitted: undefined,
  })
  assert.deepEqual(transition({ hour: '18', minute: '' }, 'hour', ''), {
    parts: { hour: '', minute: '' },
    emitted: '',
  })
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
  assert.match(getTimePickerProps(create, 'new-project-event-start-time'), /required/)
  assert.doesNotMatch(getTimePickerProps(create, 'new-project-event-end-time'), /required/)

  const settings = readFileSync(join(root, surfaces[1]), 'utf8')
  assert.match(settings, /value=\{startTime\}/)
  assert.match(settings, /value=\{endTime\}/)
  assert.doesNotMatch(getTimePickerProps(settings, 'settings-event-start-time'), /required/)
  assert.doesNotMatch(getTimePickerProps(settings, 'settings-event-end-time'), /required/)

  const dateFinder = readFileSync(join(root, surfaces[2]), 'utf8')
  assert.match(dateFinder, /name="start_time"/)
  assert.match(dateFinder, /name="end_time"/)
  assert.match(dateFinder, /startName="start_date"/)
  assert.doesNotMatch(dateFinder, /startName="start_date"[\s\S]{0,200}<TimePicker24/)
  assert.match(getTimePickerProps(dateFinder, 'date-finder-event-start-time'), /required/)
  assert.doesNotMatch(getTimePickerProps(dateFinder, 'date-finder-event-end-time'), /required/)

  const transport = readFileSync(join(root, surfaces[3]), 'utf8')
  assert.match(transport, /id=\{`transport-time-[\s\S]*?required/)
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
