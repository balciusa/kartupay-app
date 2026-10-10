import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizePaymentRecipientName,
  validateAndNormalizeIban,
  validatePaymentRecipientInput,
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
    { type: 'revolut', recipientName: 'Payment Link', value: 'https://example.test/pay', priority: 2 },
  ])
  assert.deepEqual(options, [{
    type: 'revolut', recipientName: 'Payment Link', label: 'Payment Link', value: 'https://example.test/pay', priority: 2,
  }])
})
