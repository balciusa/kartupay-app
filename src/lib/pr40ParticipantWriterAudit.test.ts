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

test('all interactive join and approval membership writes use atomic server adapters', () => {
  assert.match(actions, /reserveDirectMembershipFromSession\(projectId\)/)
  assert.match(actions, /approveProjectMembershipFromSession\(requestId\)/)
  const directJoinStart = actions.indexOf("if (getProjectJoinStrategy({ isPublic: project.is_public, financeMode: project.finance_mode }) === 'direct_membership')")
  const directJoin = actions.slice(directJoinStart, actions.indexOf('// Check if there\'s an existing request', directJoinStart))
  const approval = actions.slice(actions.indexOf('export async function approveJoinRequest'), actions.indexOf('export async function rejectJoinRequest'))
  assert.doesNotMatch(directJoin, /\.from\('participants'\)/)
  assert.doesNotMatch(approval, /\.from\('participants'\)/)
})
