import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const actionsUrl = new URL('../app/project/[id]/actions.ts', import.meta.url)
const unsafeJoinUrl = new URL('../app/project/[id]/joinProject.safe.ts', import.meta.url)
const actions = readFileSync(actionsUrl, 'utf8')

test('PR40 removes the unauthorised organizer and anonymous-user bootstrap action', () => {
  assert.doesNotMatch(actions, /addMeAsOrganizerWithPayment/)
  assert.doesNotMatch(actions, /auth\.admin\.createUser/)
  assert.doesNotMatch(actions, /anon-\$\{randomUUID\(\)\}@temp\.local/)
})

test('PR40 removes the unauthorised direct membership server action', () => {
  assert.equal(existsSync(unsafeJoinUrl), false)
  assert.doesNotMatch(actions, /joinProjectSafe/)
})
