/**
 * The source-type declarations the runtime catalog inlines: which exported
 * types the catalogued signatures reference transitively, and how long a
 * declaration may render before it is truncated.
 *
 * @module @deepseek-ai/dsh-typert-generator/cordis-catalog-declarations
 */

/** Declarations longer than this render as a truncated stub. */
export const DEFAULT_MAX_DECL_CHARS = 1_500

/** Resolve and sort the word-bounded transitive type closure referenced by seed text. */
export function referencedTypes(
  seeds: readonly string[],
  declarations: ReadonlyMap<string, string>,
): { name: string; declaration: string }[] {
  const included = new Map<string, string>()
  let frontier = [...seeds]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const [name, declaration] of declarations) {
      if (included.has(name)) continue
      const pattern = new RegExp(`\\b${name}\\b`)
      if (frontier.some(text => pattern.test(text))) {
        included.set(name, declaration)
        next.push(declaration)
      }
    }
    frontier = next
  }
  return [...included]
    .map(([name, declaration]) => ({ name, declaration }))
    .sort((left, right) => left.name.localeCompare(right.name))
}
