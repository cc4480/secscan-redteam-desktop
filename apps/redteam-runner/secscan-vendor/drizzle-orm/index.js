/**
 * Embedded drizzle-orm stand-in for the vendored SecScan engine.
 *
 * The engine imports exactly one symbol, `eq`, and passes the result
 * into the @workspace/db stub chain, where it is never interpreted.
 * Returns an opaque placeholder object.
 */
export function eq(...args) {
  return { embeddedEq: args };
}
