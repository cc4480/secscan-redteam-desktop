/**
 * Consuming the exported-type index: which declarations a text mentions one
 * level deep, and resolving a set of names to the declarations the index holds.
 */

import type { TypeDeclaration } from './slot-walk-types.ts'

/**
 * Names in the type index that seed texts mention, word-bounded — ONE level, not
 * a transitive closure. The catalog expands an owner-props contract exactly one
 * step: the owner interface carries the interaction protocol in its own member
 * documentation, while the shapes its fields reference belong to the subsystems
 * that own them and would otherwise drag the entire session model into a single
 * slot's report.
 * @param seeds - declaration or signature texts to search.
 * @param index - the type index from {@link indexExportedTypes}.
 * @returns the mentioned names, sorted.
 */
export function referencedTypeNames(
  seeds: readonly string[],
  index: ReadonlyMap<string, TypeDeclaration>,
): string[] {
  const found: string[] = []
  for (const name of index.keys()) {
    const pattern = new RegExp(`\\b${name}\\b`)
    if (seeds.some(text => pattern.test(text))) found.push(name)
  }
  return found.sort()
}

/**
 * Resolve declarations by name, dropping names the index does not hold.
 * @param names - type names to resolve.
 * @param index - the type index from {@link indexExportedTypes}.
 * @returns the resolved declarations, sorted by name.
 */
export function declaredTypes(
  names: readonly string[],
  index: ReadonlyMap<string, TypeDeclaration>,
): TypeDeclaration[] {
  return [...names]
    .flatMap(name => index.get(name) ?? [])
    .sort((left, right) => left.name.localeCompare(right.name))
}
