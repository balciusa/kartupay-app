'use client'

import { useRef, useState } from 'react'
import {
  PAYMENT_RECIPIENT_NAME_MAX_LENGTH,
  validateAndNormalizeIban,
  validatePaymentRecipientName,
  type PaymentRecipientType,
} from '@/lib/paymentRecipient'

type PaymentRecipientFieldsProps = {
  typeName: string
  recipientNameName: string
  valueName: string
  locale?: 'en' | 'lt'
  gridClassName?: string
}

export function PaymentRecipientFields({
  typeName,
  recipientNameName,
  valueName,
  locale = 'en',
  gridClassName = 'grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]',
}: PaymentRecipientFieldsProps) {
  const [type, setType] = useState<PaymentRecipientType>('revolut')
  const [nameError, setNameError] = useState<string | null>(null)
  const [ibanError, setIbanError] = useState<string | null>(null)
  const valueInputRef = useRef<HTMLInputElement>(null)
  const isIban = type === 'iban'

  const checkName = (input: HTMLInputElement) => {
    if (!isIban) return
    try {
      validatePaymentRecipientName(input.value)
      input.setCustomValidity('')
      setNameError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Enter the recipient name'
      input.setCustomValidity(message)
      setNameError(message)
    }
  }

  const checkIban = (input: HTMLInputElement) => {
    if (!isIban) {
      input.setCustomValidity('')
      setIbanError(null)
      return
    }
    try {
      validateAndNormalizeIban(input.value)
      input.setCustomValidity('')
      setIbanError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Enter a valid IBAN'
      input.setCustomValidity(message)
      setIbanError(message)
    }
  }

  return (
    <div className={gridClassName}>
      <label className="space-y-1 text-sm">
        <span className="font-medium text-slate-700">{locale === 'lt' ? 'Mokėjimo būdas' : 'Payment method'}</span>
        <select
          name={typeName}
          className="control-select"
          value={type}
          onChange={event => {
            setType(event.target.value as PaymentRecipientType)
            setNameError(null)
            setIbanError(null)
            valueInputRef.current?.setCustomValidity('')
          }}
          required
        >
          <option value="revolut">Revolut</option>
          <option value="swedbank">Swedbank</option>
          <option value="iban">IBAN</option>
        </select>
      </label>

      {isIban ? (
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">{locale === 'lt' ? 'Gavėjo vardas' : 'Recipient name'}</span>
          <input
            name={recipientNameName}
            className="control-input"
            maxLength={PAYMENT_RECIPIENT_NAME_MAX_LENGTH}
            autoComplete="name"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? `${recipientNameName}-error` : undefined}
            onBlur={event => checkName(event.currentTarget)}
            onChange={event => {
              if (nameError) checkName(event.currentTarget)
            }}
            required
          />
          {nameError && <span id={`${recipientNameName}-error`} role="alert" className="block text-xs text-red-700">{nameError}</span>}
        </label>
      ) : (
        <input type="hidden" name={recipientNameName} value="Payment Link" />
      )}

      <label className={`space-y-1 text-sm ${isIban ? 'sm:col-span-2' : ''}`}>
        <span className="font-medium text-slate-700">{isIban ? 'IBAN' : locale === 'lt' ? 'Mokėjimo nuoroda' : 'Payment link'}</span>
        <input
          ref={valueInputRef}
          name={valueName}
          className="control-input"
          placeholder={isIban ? 'GB82 WEST 1234 5698 7654 32' : 'https://...'}
          autoCapitalize={isIban ? 'characters' : 'none'}
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!ibanError}
          aria-describedby={ibanError ? `${valueName}-error` : undefined}
          onBlur={event => checkIban(event.currentTarget)}
          onChange={event => {
            if (ibanError) checkIban(event.currentTarget)
          }}
          required
        />
        {ibanError && <span id={`${valueName}-error`} role="alert" className="block text-xs text-red-700">{ibanError}</span>}
      </label>
    </div>
  )
}
