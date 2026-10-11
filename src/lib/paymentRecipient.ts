import { ValidationErrorsIBAN, validateIBAN } from 'ibantools'

export const PAYMENT_RECIPIENT_NAME_MAX_LENGTH = 140

export type PaymentRecipientType = 'revolut' | 'swedbank' | 'iban'

export type PaymentRecipientInput = {
  type: string
  recipientName?: string | null
  value?: string | null
}

export type ValidatedPaymentRecipient = {
  type: PaymentRecipientType
  label: string
  value: string
}

const RECIPIENT_TYPES = new Set<PaymentRecipientType>(['revolut', 'swedbank', 'iban'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u

export function normalizePaymentRecipientName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

export function validatePaymentRecipientName(value: string): string {
  const normalized = normalizePaymentRecipientName(value)
  if (!normalized) throw new Error('Recipient name is required for an IBAN')
  if (CONTROL_CHARACTERS.test(normalized)) throw new Error('Recipient name contains unsupported characters')
  if ([...normalized].length > PAYMENT_RECIPIENT_NAME_MAX_LENGTH) {
    throw new Error(`Recipient name must be ${PAYMENT_RECIPIENT_NAME_MAX_LENGTH} characters or fewer`)
  }
  return normalized
}

export function normalizeIban(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('IBAN is required')
  if (CONTROL_CHARACTERS.test(trimmed)) throw new Error('IBAN contains unsupported characters')

  const normalized = trimmed.replace(/[ \u00a0]+/gu, '').toUpperCase()
  if (!/^[A-Z0-9]+$/u.test(normalized)) {
    throw new Error('IBAN may contain only letters, numbers, and spaces')
  }
  return normalized
}

export function validateAndNormalizeIban(value: string): string {
  const normalized = normalizeIban(value)
  const result = validateIBAN(normalized)
  if (result.valid) return normalized

  if (result.errorCodes.includes(ValidationErrorsIBAN.NoIBANCountry)) {
    throw new Error('IBAN country code is not supported')
  }
  if (result.errorCodes.includes(ValidationErrorsIBAN.WrongBBANLength)) {
    throw new Error('IBAN length does not match its country')
  }
  if (
    result.errorCodes.includes(ValidationErrorsIBAN.WrongIBANChecksum) ||
    result.errorCodes.includes(ValidationErrorsIBAN.ChecksumNotNumber) ||
    result.errorCodes.includes(ValidationErrorsIBAN.WrongAccountBankBranchChecksum)
  ) {
    throw new Error('IBAN checksum is invalid')
  }
  throw new Error('Enter a valid IBAN')
}

export function validatePaymentRecipientInput(input: PaymentRecipientInput): ValidatedPaymentRecipient {
  const type = input.type.trim() as PaymentRecipientType
  if (!RECIPIENT_TYPES.has(type)) throw new Error('Choose a supported payment method')

  const rawValue = String(input.value ?? '')
  if (type === 'iban') {
    return {
      type,
      label: validatePaymentRecipientName(String(input.recipientName ?? '')),
      value: validateAndNormalizeIban(rawValue),
    }
  }

  const value = rawValue.trim()
  if (!value) throw new Error('Payment link is required')
  const label = normalizePaymentRecipientName(String(input.recipientName ?? '')) || 'Payment Link'
  if (CONTROL_CHARACTERS.test(label)) throw new Error('Payment label contains unsupported characters')
  if ([...label].length > PAYMENT_RECIPIENT_NAME_MAX_LENGTH) {
    throw new Error(`Payment label must be ${PAYMENT_RECIPIENT_NAME_MAX_LENGTH} characters or fewer`)
  }
  return { type, label, value }
}

export function validatedPaymentOptionsForStorage<T extends PaymentRecipientInput>(options: T[]) {
  return options.flatMap(option => {
    try {
      const validated = validatePaymentRecipientInput(option)
      return [{ ...option, ...validated }]
    } catch {
      return []
    }
  })
}
