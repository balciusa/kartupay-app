export function splitEvenly(totalCents: number, n: number): number[] {
  if (!n || n <= 0) return []
  const base = Math.floor(totalCents / n)
  const rem = totalCents % n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
}
export function scenarioShares(totalCents: number, count: number) {
  return {
    now: splitEvenly(totalCents, Math.max(count, 1))[0] ?? 0,
    plus1: splitEvenly(totalCents, count + 1)[0] ?? 0,
    plus2: splitEvenly(totalCents, count + 2)[0] ?? 0,
  }
}
