/**
 * Embedded @workspace/db stand-in for the vendored SecScan engine.
 *
 * eolFetcher.ts (byte-frozen) persists its end-of-life cache through the
 * SecScan service's database: `db.select().from(t).where(...).limit(1)`
 * at startup and `db.insert(t).values(...).onConflictDoUpdate(...)`
 * after a refresh. The embedded build has no database, so every query
 * chain here resolves to an empty result — which is the engine's own
 * documented fallback ("No persisted EOL data in DB yet — bundled
 * fallback active"; DB write errors are logged at WARN and non-fatal).
 *
 * A chain is a callable Proxy: any method call returns the same chain,
 * and awaiting the chain resolves the canned result ([] for reads,
 * undefined for writes). Nothing throws at import time or call time.
 */

function chainable(result) {
  const proxy = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return (resolve) => resolve(result);
      if (typeof prop === "symbol") return undefined;
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

/** The engine reads only `.key` (eq target and upsert conflict target). */
export const eolCacheTable = { key: "key" };

export const db = {
  select: () => chainable([]),
  insert: () => chainable(undefined),
  update: () => chainable(undefined),
  delete: () => chainable(undefined),
};
