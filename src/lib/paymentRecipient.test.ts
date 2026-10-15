import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizePaymentRecipientName,
  validateAndNormalizeIban,
  validatePaymentRecipientInput,
  validateAndNormalizePaymentLink,
  validatedPaymentOptionsForUse,
  validatePaymentRecipientName,
  validatedPaymentOptionsForStorage,
} from './paymentRecipient.ts'

test('valid international IBANs pass country rules and ISO 13616 checksum validation', () => {
  for (const iban of [
    'DE89370400440532013000',
    'GB82WEST12345698765432',
    'FR1420041010050500013M02606',
    'NL91ABNA0417164300',
    'AE070331234567890123456',
  ]) {
    assert.equal(validateAndNormalizeIban(iban), iban)
  }
})

test('IBAN input accepts spaces and normalizes case for storage', () => {
  assert.equal(validateAndNormalizeIban(' gb82 west 1234 5698 7654 32 '), 'GB82WEST12345698765432')
})

test('IBAN validation rejects country-length and checksum failures', () => {
  assert.throws(() => validateAndNormalizeIban('DE8937040044053201300'), /length does not match its country/)
  assert.throws(() => validateAndNormalizeIban('DE88370400440532013000'), /checksum is invalid/)
  assert.throws(() => validateAndNormalizeIban('ZZ89370400440532013000'), /country code is not supported/)
})

test('IBAN validation rejects missing and malformed data without echoing it', () => {
  assert.throws(() => validateAndNormalizeIban(''), /IBAN is required/)
  const sensitiveValue = 'GB82-WEST-1234'
  assert.throws(
    () => validateAndNormalizeIban(sensitiveValue),
    error => error instanceof Error && /only letters, numbers, and spaces/.test(error.message) && !error.message.includes(sensitiveValue)
  )
})

test('recipient names support international characters and normalize whitespace', () => {
  assert.equal(validatePaymentRecipientName('  Živilė   O’Connor 株式会社  '), 'Živilė O’Connor 株式会社')
  assert.equal(normalizePaymentRecipientName('Jose\u0301  García'), 'José García')
})

test('IBAN recipients require a name and a valid account', () => {
  assert.throws(
    () => validatePaymentRecipientInput({ type: 'iban', recipientName: '', value: 'GB82WEST12345698765432' }),
    /Recipient name is required/
  )
  assert.throws(
    () => validatePaymentRecipientInput({ type: 'iban', recipientName: 'Alice', value: '' }),
    /IBAN is required/
  )
})

test('validated recipients return normalized server storage values', () => {
  assert.deepEqual(validatePaymentRecipientInput({
    type: 'iban',
    recipientName: '  Élodie   Martin ',
    value: 'fr14 2004 1010 0505 0001 3m02 606',
  }), {
    type: 'iban',
    label: 'Élodie Martin',
    value: 'FR1420041010050500013M02606',
  })
})

test('copying stored options omits invalid legacy IBANs without blocking other payment methods', () => {
  const options = validatedPaymentOptionsForStorage([
    { type: 'iban', recipientName: 'Alice', value: 'DE88370400440532013000', priority: 1 },
    { type: 'revolut', recipientName: 'Payment Link', value: 'https://revolut.me/safe-user', priority: 2 },
  ])
  assert.deepEqual(options, [{
    type: 'revolut', recipientName: 'Payment Link', label: 'Payment Link', value: 'https://revolut.me/safe-user', priority: 2,
  }])
})

test('supported payment links are normalized to provider-owned HTTPS destinations', () => {
  assert.equal(validateAndNormalizePaymentLink('revolut', '@safe-user'), 'https://revolut.me/safe-user')
  assert.equal(
    validateAndNormalizePaymentLink('swedbank', 'https://www.swedbank.lt/private/d2d/payments'),
    'https://www.swedbank.lt/private/d2d/payments'
  )
  assert.throws(() => validateAndNormalizePaymentLink('revolut', 'https://evil.example/revolut.me/user'), /official revolut\.me/)
  assert.throws(() => validateAndNormalizePaymentLink('swedbank', 'http://swedbank.lt/pay'), /must use HTTPS/)
})

test('legacy read validation drops malformed entries and preserves valid priority fallback', () => {
  const usable = validatedPaymentOptionsForUse([
    { type: 'iban', label: 'Broken', value: 'IBAN1234', priority: 0, is_active: true },
    { type: 'revolut', label: 'Unsafe', value: 'javascript:alert(1)', priority: 1, is_active: true },
    { type: 'iban', label: 'Élodie', value: 'FR1420041010050500013M02606', priority: 2, is_active: true },
  ])
  assert.deepEqual(usable.map(option => ({ type: option.type, label: option.label, priority: option.priority })), [
    { type: 'iban', label: 'Élodie', priority: 2 },
  ])
})
