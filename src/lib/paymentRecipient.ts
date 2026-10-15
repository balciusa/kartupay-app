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

export type StoredPaymentOption = PaymentRecipientInput & {
  label?: string | null
  priority?: number | null
  is_active?: boolean | null
}

const RECIPIENT_TYPES = new Set<PaymentRecipientType>(['revolut', 'swedbank', 'iban'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const REVOLUT_HANDLE = /^[A-Za-z0-9._-]{2,64}$/u

function parseHttpsUrl(value: string, providerName: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`Enter a valid ${providerName} payment link`)
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw new Error(`${providerName} payment links must use HTTPS`)
  }
  return parsed
}

export function validateAndNormalizePaymentLink(type: Exclude<PaymentRecipientType, 'iban'>, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Payment link is required')
  if (CONTROL_CHARACTERS.test(trimmed)) throw new Error('Payment link contains unsupported characters')

  if (type === 'revolut') {
    const candidate = trimmed.startsWith('@')
      ? `https://revolut.me/${trimmed.slice(1)}`
      : /^revolut\.me\//iu.test(trimmed)
        ? `https://${trimmed}`
        : trimmed
    const parsed = parseHttpsUrl(candidate, 'Revolut')
    if (parsed.hostname.toLowerCase() !== 'revolut.me') {
      throw new Error('Use an official revolut.me payment link')
    }
    const handle = decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/gu, '')
    if (!REVOLUT_HANDLE.test(handle) || parsed.search || parsed.hash) {
      throw new Error('Enter a valid Revolut payment link or @handle')
    }
    return `https://revolut.me/${handle}`
  }

  const parsed = parseHttpsUrl(trimmed, 'Swedbank')
  const hostname = parsed.hostname.toLowerCase()
  if (hostname !== 'swedbank.lt' && !hostname.endsWith('.swedbank.lt')) {
    throw new Error('Use an official swedbank.lt payment link')
  }
  if (parsed.hash) throw new Error('Swedbank payment links cannot contain a fragment')
  return parsed.toString()
}

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

  const value = validateAndNormalizePaymentLink(type, rawValue)
  const label = normalizePaymentRecipientName(String(input.recipientName ?? '')) || 'Payment Link'
  if (CONTROL_CHARACTERS.test(label)) throw new Error('Payment label contains unsupported characters')
  if ([...label].length > PAYMENT_RECIPIENT_NAME_MAX_LENGTH) {
    throw new Error(`Payment label must be ${PAYMENT_RECIPIENT_NAME_MAX_LENGTH} characters or fewer`)
  }
  return { type, label, value }
}

export function validateStoredPaymentOption<T extends StoredPaymentOption>(option: T) {
  return {
    ...option,
    ...validatePaymentRecipientInput({
      type: option.type,
      recipientName: option.label ?? option.recipientName,
      value: option.value,
    }),
  }
}

export function validatedPaymentOptionsForUse<T extends StoredPaymentOption>(options: T[]) {
  return options.flatMap(option => {
    if (option.is_active === false) return []
    try {
      return [validateStoredPaymentOption(option)]
    } catch {
      return []
    }
  })
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
