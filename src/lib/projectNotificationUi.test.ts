import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const component = readFileSync(new URL('../components/Project/ProjectNotificationCenter.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../app/project/[id]/page.tsx', import.meta.url), 'utf8')
const dateFinder = readFileSync(new URL('../components/Project/ProjectDateFinder.tsx', import.meta.url), 'utf8')

test('notification bell is project-level and the Date Finder generic badge is removed', () => {
  const center = page.indexOf('<ProjectNotificationCenter')
  const tabs = page.indexOf('<ProjectTabs')
  assert.ok(center > 0 && center < tabs)
  assert.doesNotMatch(dateFinder, /unreadNotificationCount|Notifications:/)
  assert.equal((page.match(/<ProjectNotificationCenter/g) ?? []).length, 1)
})

test('opening the panel only toggles visibility and does not implicitly mark notifications read', () => {
  assert.match(component, /onClick=\{\(\) => setOpen\(current => !current\)\}/)
  assert.match(component, /onClick=\{markAll\}/)
  assert.match(component, /onClick=\{\(\) => markOne\(item\.id\)\}/)
})

test('notification panel includes unread/read styling, EN/LT copy, and the compact empty state', () => {
  assert.match(component, /unread \? 'bg-indigo-50\/60' : 'bg-white'/)
  assert.match(component, /No notifications yet\./)
  assert.match(component, /Pranešimų nėra\./)
  assert.match(component, /Mark all as read/)
  assert.match(component, /Pažymėti visus kaip skaitytus/)
})

test('mobile panel is viewport-bound, internally scrollable, wrapping, and uses 44px targets', () => {
  assert.match(component, /fixed inset-x-3 top-20/)
  assert.match(component, /max-h-\[calc\(100dvh-6rem\)\]/)
  assert.match(component, /overflow-y-auto/)
  assert.match(component, /break-words/)
  assert.match(component, /min-h-11/)
  assert.match(component, /min-w-11/)
})
