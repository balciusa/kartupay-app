import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  normalizePaymentRecipientName,
  validateAndNormalizeIban,
  validateAndNormalizePaymentLink,
} from './paymentRecipient.ts'

const candidateSql = readFileSync(
  new URL('../../docs/sql/pr40_managed_approval_candidate.sql', import.meta.url),
  'utf8'
)

test('PR40 TypeScript golden matrix covers supported Revolut forms and URL attacks', () => {
  const accepted = [
    ['@safe-user', 'https://revolut.me/safe-user'],
    ['revolut.me/safe.user', 'https://revolut.me/safe.user'],
    ['https://revolut.me/safe%2Duser', 'https://revolut.me/safe-user'],
  ] as const
  for (const [input, expected] of accepted) {
    assert.equal(validateAndNormalizePaymentLink('revolut', input), expected)
  }

  for (const input of [
    'http://revolut.me/safe-user',
    'https://user:pass@revolut.me/safe-user',
    'https://revolut.me:444/safe-user',
    'https://revolut.me/safe-user?to=other',
    'https://revolut.me/safe-user#other',
    'https://revolut.me.evil.example/safe-user',
  ]) {
    assert.throws(() => validateAndNormalizePaymentLink('revolut', input))
  }
})

test('PR40 TypeScript golden matrix covers Swedbank host, query and URL attacks', () => {
  assert.equal(
    validateAndNormalizePaymentLink('swedbank', 'https://www.swedbank.lt/pay?reference=synthetic'),
    'https://www.swedbank.lt/pay?reference=synthetic'
  )
  for (const input of [
    'http://swedbank.lt/pay',
    'https://user:pass@swedbank.lt/pay',
    'https://swedbank.lt:444/pay',
    'https://swedbank.lt/pay#fragment',
    'https://swedbank.lt.evil.example/pay',
  ]) {
    assert.throws(() => validateAndNormalizePaymentLink('swedbank', input))
  }
})

test('PR40 TypeScript golden matrix covers IBAN checksum, length and Unicode NFC', () => {
  assert.equal(validateAndNormalizeIban('gb82 west 1234 5698 7654 32'), 'GB82WEST12345698765432')
  for (const input of [
    'GB81WEST12345698765432',
    'GB82WEST1234569876543',
    'ZZ82WEST12345698765432',
  ]) {
    assert.throws(() => validateAndNormalizeIban(input))
  }
  assert.equal(normalizePaymentRecipientName('Jose\u0301   García'), 'José García')
})

test('PR40 SQL verifier remains deliberately non-equivalent and therefore blocks runtime cutover', () => {
  assert.match(candidateSql, /Not full JS URL\/NFC parity/)
  assert.match(candidateSql, /unsupported valid encodings fail closed/)
  assert.doesNotMatch(candidateSql, /validateIBAN|WrongIBANChecksum|decodeURIComponent|normalize\('NFC'\)/)
})
