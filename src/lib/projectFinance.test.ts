import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FINANCE_DISABLED_ERROR,
  FINANCE_HISTORY_ERROR,
  assertFinanceModeTransition,
  assertManagedFinance,
  getExtraPresentation,
  getFinanceCapabilities,
  getProjectReadiness,
  getProjectJoinStrategy,
  hasMeaningfulFinancialActivity,
  isManagedFinance,
  normalizeProjectFinanceMode,
  normalizeExtraFinanceInput,
  validateProjectFinanceInput,
} from './projectFinance.ts'

test('1. new project can use finance_mode none', () => {
  assert.equal(validateProjectFinanceInput({ financeMode: 'none' }).financeMode, 'none')
})

test('2. new project can use finance_mode managed', () => {
  assert.equal(validateProjectFinanceInput({ financeMode: 'managed', totalEur: '100' }).financeMode, 'managed')
})

test('3. existing project safely defaults to managed', () => {
  assert.equal(normalizeProjectFinanceMode(undefined), 'managed')
  assert.equal(normalizeProjectFinanceMode(null), 'managed')
})

test('4. non-financial project does not require financial fields', () => {
  assert.deepEqual(validateProjectFinanceInput({ financeMode: 'none' }), {
    financeMode: 'none', totalCents: 0, totalIsPerPerson: false, bundleSize: null, bundlePayFor: null,
  })
})

test('5. managed project validates financial fields', () => {
  assert.throws(() => validateProjectFinanceInput({ financeMode: 'managed', totalEur: '' }), /Invalid total amount/)
  assert.equal(validateProjectFinanceInput({ financeMode: 'managed', totalEur: '12,34' }).totalCents, 1234)
})

test('6. private projects always require approval while public finance-none stays direct', () => {
  assert.equal(getProjectJoinStrategy({ isPublic: false, financeMode: 'none' }), 'approval_request')
  assert.equal(getProjectJoinStrategy({ isPublic: false, financeMode: 'managed' }), 'approval_request')
  assert.equal(getProjectJoinStrategy({ isPublic: true, financeMode: 'none' }), 'direct_membership')
  assert.equal(getProjectJoinStrategy({ isPublic: true, financeMode: 'managed' }), 'approval_request')
})

test('7. non-financial project counts confirmed attendance toward minimum', () => {
  assert.equal(getProjectReadiness({ financeMode: 'none', confirmedParticipants: 3, minParticipants: 3, managedFinanceReady: false }).participationReady, true)
})

test('8. finance readiness is automatically true for none', () => {
  assert.equal(getProjectReadiness({ financeMode: 'none', confirmedParticipants: 1, minParticipants: 1, managedFinanceReady: false }).financeReady, true)
})

test('9. payments tab is hidden for none', () => {
  assert.equal(getFinanceCapabilities('none').showPaymentsTab, false)
})

test('10. non-financial project does not expose payment actions', () => {
  assert.equal(getFinanceCapabilities('none').showPaymentActions, false)
  assert.throws(() => assertManagedFinance('none'), new RegExp(FINANCE_DISABLED_ERROR))
})

test('11. financial operations have a stable domain error', () => {
  assert.equal(FINANCE_DISABLED_ERROR, 'Financial management is not enabled for this project')
})

test('12. Date Finder participation readiness is finance-agnostic', () => {
  const none = getProjectReadiness({ financeMode: 'none', confirmedParticipants: 4, minParticipants: 5, managedFinanceReady: true })
  const managed = getProjectReadiness({ financeMode: 'managed', confirmedParticipants: 4, minParticipants: 5, managedFinanceReady: true })
  assert.equal(none.participationReady, managed.participationReady)
})

test('13. non-financial Extra can omit amount', () => {
  assert.deepEqual(normalizeExtraFinanceInput({ financeMode: 'none' }), {
    amountCents: 0,
    amountIsPerPerson: false,
    collectionMode: 'project_collector',
    dedicatedCollectorParticipantId: null,
  })
})

test('14. non-financial Extra supports Join and Not interested', () => {
  assert.equal(getExtraPresentation('none', false).primaryAction, 'join')
  assert.equal(getExtraPresentation('none', true).primaryAction, 'not_interested')
})

test('15. non-financial Extra hides payment actions', () => {
  assert.equal(getExtraPresentation('none', true).showPaymentActions, false)
})

test('16. managed Extra preserves financial presentation', () => {
  assert.deepEqual(getExtraPresentation('managed', true), {
    showAmount: true, showCollector: true, showPaymentActions: true, primaryAction: 'leave',
  })
  assert.equal(normalizeExtraFinanceInput({ financeMode: 'managed', amountCents: 2500 }).amountCents, 2500)
})

test('17. none to managed transition works', () => {
  assert.equal(assertFinanceModeTransition('none', 'managed'), 'managed')
})

test('18. managed to none works without financial history', () => {
  assert.equal(assertFinanceModeTransition('managed', 'none', {}), 'none')
})

test('19. managed to none is blocked with any financial history', () => {
  assert.equal(hasMeaningfulFinancialActivity({ extraPayments: 1 }), true)
  assert.throws(() => assertFinanceModeTransition('managed', 'none', { extraPayments: 1 }), new RegExp(FINANCE_HISTORY_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('20. managed projects keep financial readiness behavior', () => {
  assert.equal(isManagedFinance('managed'), true)
  assert.equal(getProjectReadiness({ financeMode: 'managed', confirmedParticipants: 2, minParticipants: 2, managedFinanceReady: false }).projectReady, false)
  assert.equal(getProjectReadiness({ financeMode: 'managed', confirmedParticipants: 2, minParticipants: 2, managedFinanceReady: true }).projectReady, true)
})
