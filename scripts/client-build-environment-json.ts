/** Structural guards for parsed JSON values shared by the client build modules. */

/**
 * Narrow a parsed JSON value to a plain object.
 * @param value - value parsed from JSON or received from an untyped caller.
 * @returns true when the value is a non-null, non-array object.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Report whether an object carries exactly the expected key set.
 * @param value - object whose own enumerable keys are compared.
 * @param expected - expected keys in ascending sort order.
 * @returns true when the key sets are identical.
 */
export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
