import {
  validatePaymentRecipientInput,
  type PaymentRecipientType,
} from './paymentRecipient.ts'

export type Pr40UserOption = {
  type: string
  label: string | null
  value: string
  priority: number | null
  is_active: boolean | null
}

export type Pr40ExistingOption = {
  type: string
  value: string
}

export type Pr40PaymentOptionInsert = {
  participant_id: string
  type: PaymentRecipientType
  label: string
  value: string
  priority: number
  is_active: true
}

/**
 * Candidate for PR40 finance parity testing ONLY; no runtime consumers.
 * Builds a deterministic and canonicalized clone plan without DB writes.
 * Pair deduplication happens AFTER validation, unlike the legacy caller.
 * A DB transaction or reviewed unique constraint remains mandatory for
 * concurrency safety. Do not treat this pure helper as an atomic write.
 */
export function planPr40PaymentOptionClone(
  participantId: string,
  options: Pr40UserOption[],
  existing: Pr40ExistingOption[]
): Pr40PaymentOptionInsert[] {
  const keys = new Set<string>()
  for (const row of existing) {
    try {
      const parsed = validatePaymentRecipientInput({
        type: row.type,
        value: row.value,
        // Recipient name is required for IBAN; matching an existing
        // IBAN can be safely normalized without validating its label.
        recipientName: row.type === 'iban' ? 'Existing recipient' : '',
      })
      keys.add(JSON.stringify([parsed.type, parsed.value]))
    } catch {
      // Preserve exact values to avoid duplicating pre-existing invalid rows.
      keys.add(JSON.stringify([row.type, row.value]))
    }
  }
  const planned: Pr40PaymentOptionInsert[] = []
  for (const option of options) {
    if (option.is_active !== true) continue
    try {
      const parsed = validatePaymentRecipientInput({
        type: option.type,
        recipientName: option.label,
        value: option.value,
      })
      const key = JSON.stringify([parsed.type, parsed.value])
      if (keys.has(key)) continue
      keys.add(key)
      planned.push({
        participant_id: participantId,
        type: parsed.type,
        label: parsed.label,
        value: parsed.value,
        priority: option.priority ?? 1,
        is_active: true,
      })
    } catch {
      // Match the legacy validatedPaymentOptionsForStorage behavior:
      // invalid recipient options do not become stored rows.
    }
  }
  return planned
}
