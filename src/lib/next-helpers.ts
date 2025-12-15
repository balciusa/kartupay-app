export async function readParams<T extends Record<string, any>>(
  paramsOrPromise: T | Promise<T>
): Promise<T> {
  return await paramsOrPromise
}

export async function requireParam<T extends Record<string, any>>(
  paramsOrPromise: T | Promise<T>,
  key: string
): Promise<string> {
  const p = await paramsOrPromise
  const v = p?.[key]
  if (typeof v !== 'string' || !v) {
    throw new Error(`Missing route param: ${key}`)
  }
  return v
}
