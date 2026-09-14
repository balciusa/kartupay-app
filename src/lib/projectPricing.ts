export type BundlePricingConfig = {
  bundleSize: number | null
  bundlePayFor: number | null
}

export type ProjectPricingInput = BundlePricingConfig & {
  totalCents: number
  totalIsPerPerson: boolean
  participantCount: number
}

export type ProjectPricingSummary = {
  participantCount: number
  storedTotalCents: number
  totalCents: number
  perPersonCents: number
  payableUnits: number
  totalIsPerPerson: boolean
  bundleActive: boolean
  bundleSize: number | null
  bundlePayFor: number | null
}

const toWholeNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isInteger(parsed)) return parsed
  }
  return null
}

export function validateBundlePricingConfig(
  totalIsPerPerson: boolean,
  bundleSizeValue: unknown,
  bundlePayForValue: unknown
): BundlePricingConfig {
  const bundleSize = toWholeNumber(bundleSizeValue)
  const bundlePayFor = toWholeNumber(bundlePayForValue)
  const hasBundleSize = bundleSize !== null
  const hasBundlePayFor = bundlePayFor !== null

  if (!hasBundleSize && !hasBundlePayFor) {
    return { bundleSize: null, bundlePayFor: null }
  }
  if (!totalIsPerPerson) {
    throw new Error('Bundle pricing is only available for per-person projects')
  }
  if (!hasBundleSize || !hasBundlePayFor) {
    throw new Error('Bundle pricing requires both bundle size and pay-for values')
  }
  if (bundleSize < 2) {
    throw new Error('Bundle size must be at least 2')
  }
  if (bundlePayFor < 1) {
    throw new Error('Bundle pay-for value must be at least 1')
  }
  if (bundlePayFor >= bundleSize) {
    throw new Error('Bundle pay-for value must be smaller than the bundle size')
  }

  return { bundleSize, bundlePayFor }
}

export function normalizeBundlePricingConfig(
  totalIsPerPerson: boolean,
  bundleSizeValue: unknown,
  bundlePayForValue: unknown
): BundlePricingConfig & { bundleActive: boolean } {
  if (!totalIsPerPerson) {
    return { bundleSize: null, bundlePayFor: null, bundleActive: false }
  }

  const bundleSize = toWholeNumber(bundleSizeValue)
  const bundlePayFor = toWholeNumber(bundlePayForValue)
  const bundleActive =
    bundleSize !== null &&
    bundlePayFor !== null &&
    bundleSize >= 2 &&
    bundlePayFor >= 1 &&
    bundlePayFor < bundleSize

  return {
    bundleSize: bundleActive ? bundleSize : null,
    bundlePayFor: bundleActive ? bundlePayFor : null,
    bundleActive,
  }
}

export function calculateProjectPricing(input: ProjectPricingInput): ProjectPricingSummary {
  const participantCount = Math.max(1, Math.trunc(Number(input.participantCount) || 0))
  const storedTotalCents = Math.max(0, Math.trunc(Number(input.totalCents) || 0))
  const totalIsPerPerson = input.totalIsPerPerson === true
  const bundleConfig = normalizeBundlePricingConfig(totalIsPerPerson, input.bundleSize, input.bundlePayFor)

  if (!totalIsPerPerson) {
    return {
      participantCount,
      storedTotalCents,
      totalCents: storedTotalCents,
      perPersonCents: Math.floor(storedTotalCents / participantCount),
      payableUnits: participantCount,
      totalIsPerPerson,
      bundleActive: false,
      bundleSize: null,
      bundlePayFor: null,
    }
  }

  const payableUnits = bundleConfig.bundleActive
    ? Math.floor(participantCount / (bundleConfig.bundleSize as number)) * (bundleConfig.bundlePayFor as number) +
      (participantCount % (bundleConfig.bundleSize as number))
    : participantCount
  const totalCents = storedTotalCents * payableUnits
  const perPersonCents = Math.floor(totalCents / participantCount)

  return {
    participantCount,
    storedTotalCents,
    totalCents,
    perPersonCents,
    payableUnits,
    totalIsPerPerson,
    bundleActive: bundleConfig.bundleActive,
    bundleSize: bundleConfig.bundleSize,
    bundlePayFor: bundleConfig.bundlePayFor,
  }
}

export function describeBundlePricing(bundleSize: number | null, bundlePayFor: number | null) {
  if (bundleSize == null || bundlePayFor == null) return null
  return `Buy ${bundleSize}, pay for ${bundlePayFor}`
}
