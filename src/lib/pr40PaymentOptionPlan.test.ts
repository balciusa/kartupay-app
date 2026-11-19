import assert from 'node:assert/strict'
import test from 'node:test'
import { planPr40PaymentOptionClone } from './pr40PaymentOptionPlan.ts'

const participantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('only active valid user options are copied', () => {
  const result = planPr40PaymentOptionClone(participantId, [
    { type: 'revolut', label: 'My payment', value: '@alice_22', priority: null, is_active: true },
    { type: 'revolut', label: 'Skip', value: '@inactive', priority: 3, is_active: false },
    { type: 'revolut', label: 'Invalid', value: 'https://evil.example/test', priority: 2, is_active: true },
  ], [])
  assert.deepEqual(result, [{
    participant_id: participantId,
    type: 'revolut',
    label: 'My payment',
    value: 'https://revolut.me/alice_22',
    priority: 1,
    is_active: true,
  }])
})

test('normalization deduplicates alternate representations in the same request', () => {
  const result = planPr40PaymentOptionClone(participantId, [
    { type: 'revolut', label: 'Alice', value: '@alice_22', priority: 1, is_active: true },
    { type: 'revolut', label: 'Alice duplicate', value: 'https://revolut.me/alice_22', priority: 5, is_active: true },
  ], [])
  assert.equal(result.length, 1)
})

test('existing participant recipient wins after normalized comparison', () => {
  const result = planPr40PaymentOptionClone(participantId, [
    { type: 'revolut', label: 'Again', value: '@alice_22', priority: 1, is_active: true },
  ], [{ type: 'revolut', value: 'https://revolut.me/alice_22' }])
  assert.deepEqual(result, [])
})

test('IBAN names are required and normalized, not copied blindly', () => {
  const result = planPr40PaymentOptionClone(participantId, [
    { type: 'iban', label: ' Alice  Smith ', value: 'GB82 WEST 1234 5698 7654 32', priority: 2, is_active: true },
    { type: 'iban', label: null, value: 'GB82 WEST 1234 5698 7654 32', priority: 1, is_active: true },
  ], [])
  assert.equal(result.length, 1)
  assert.equal(result[0].label, 'Alice Smith')
  assert.equal(result[0].value, 'GB82WEST12345698765432')
})

test('same type and value, different participant baseline remains a participant-specific plan', () => {
  const one = planPr40PaymentOptionClone(participantId, [
    { type: 'revolut', label: 'Alice', value: '@alice_22', priority: 1, is_active: true },
  ], [])
  const two = planPr40PaymentOptionClone('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [
    { type: 'revolut', label: 'Alice', value: '@alice_22', priority: 1, is_active: true },
  ], [])
  assert.notEqual(one[0].participant_id, two[0].participant_id)
})
