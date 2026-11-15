/** Structural classification of the difference between two root schemas. */

import { canonicalizeSchema, schemaDigest } from './persistence-schema-model.ts'
import { matchingSourceCompatibility, sourceKindGroups, validSourceCompatibility } from './persistence-source-policy.ts'
import { CHANGE_DESCRIPTIONS } from './persistence-changes.record-types.ts'
import type { PersistenceTypeChange, PersistenceTypeChangeKind } from './persistence-changes.record-types.ts'
import type { CanonicalSchema, PersistenceRoot, SchemaNode, SchemaTupleElement } from './persistence-schema-model.ts'

function subDigest(schema: CanonicalSchema, node: number): string {
  return schemaDigest(canonicalizeSchema(schema.nodes, node))
}

/** Assign each candidate row at most one column, preferring a complete assignment.
 * @param candidates - column indices admissible for each row.
 * @returns the chosen column per row, or undefined when no complete assignment exists.
 */
export function matchUnionVariants(candidates: readonly (readonly number[])[]): number[] | undefined {
  const owners = new Map<number, number>()
  function assign(previous: number, visited: Set<number>): boolean {
    for (const next of candidates[previous] ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      const owner = owners.get(next)
      if (owner === undefined || assign(owner, visited)) {
        owners.set(next, previous)
        return true
      }
    }
    return false
  }
  for (let previous = 0; previous < candidates.length; previous += 1) {
    if (!assign(previous, new Set())) return undefined
  }
  const matches: number[] = []
  for (const [next, previous] of owners) matches[previous] = next
  return matches
}

/** Classify structural differences using the reader promises saved with each schema.
 * @param before - predecessor root, or absence for an addition.
 * @param after - successor root, or absence for deletion.
 * @returns concrete changes and their format-bump requirement.
 */
export function classifyPersistenceChange(before: PersistenceRoot | null, after: PersistenceRoot | null): PersistenceTypeChange[] {
  if (before === null) {
    return after === null ? [] : [{ path: after.key, kind: 'root-added', description: 'root added',
      requiresVersionBump: after.kind !== 'event' || after.surface !== false }]
  }
  if (after === null) return [{ path: before.key, kind: 'root-removed', description: 'root removed', requiresVersionBump: true }]
  const key = after.key
  const oldRoot = before
  const newRoot = after
  const describe = (path: string, kind: PersistenceTypeChangeKind, requiresVersionBump = true): PersistenceTypeChange =>
    ({ path, kind, description: CHANGE_DESCRIPTIONS[kind], requiresVersionBump })
  const changes: PersistenceTypeChange[] = []
  if (before.kind !== after.kind || before.surface !== after.surface) changes.push(describe(key, 'root-classification-changed'))
  if (before.digest === after.digest) return changes
  const fingerprints = [new Map<number, string>(), new Map<number, string>()] as const
  const fingerprint = (schema: CanonicalSchema, index: number, side: 0 | 1): string => {
    let result = fingerprints[side].get(index)
    if (result === undefined) { result = subDigest(schema, index); fingerprints[side].set(index, result) }
    return result
  }
  type Scope = 'event' | 'body' | 'strict'
  function compare(
    oldIndex: number, newIndex: number, path: string, scope: Scope, ancestors: ReadonlySet<string>,
  ): PersistenceTypeChange[] {
    if (fingerprint(oldRoot.schema, oldIndex, 0) === fingerprint(newRoot.schema, newIndex, 1)) return []
    const pair = `${oldIndex}:${newIndex}:${scope}`
    if (ancestors.has(pair)) return []
    // Recursive pairs are assumptions for this candidate only. A failed sibling
    // or unmatched union arm cannot leave a cached success for another candidate.
    const active = new Set(ancestors).add(pair)
    const differences: PersistenceTypeChange[] = []
    const add = (path: string, kind: PersistenceTypeChangeKind, requiresVersionBump = true): void => {
      differences.push(describe(path, kind, requiresVersionBump))
    }
    const descend = (oldType: number, newType: number, child: string, childScope: Scope): void => {
      differences.push(...compare(oldType, newType, child, childScope, active))
    }
    const oldNode = oldRoot.schema.nodes[oldIndex] as SchemaNode
    const newNode = newRoot.schema.nodes[newIndex] as SchemaNode
    if (oldRoot.kind === 'event' && oldRoot.surface === false && scope === 'body' && path === `${key}.data`) {
      const oldTypes = oldNode.kind === 'union' ? oldNode.types : [oldIndex]
      const newTypes = newNode.kind === 'union' ? newNode.types : [newIndex]
      const payloadVersion = (schema: CanonicalSchema, index: number): number | undefined => {
        const node = schema.nodes[index]
        if (node?.kind !== 'object') return undefined
        const property = node.properties.find(property => property.name === 'version' && !property.optional)
        const version = schema.nodes[property?.type ?? -1]
        return version?.kind === 'literal' && typeof version.value === 'number'
          && Number.isSafeInteger(version.value) && version.value >= 0 ? version.value : undefined
      }
      const versions = oldTypes.map(index => payloadVersion(oldRoot.schema, index))
      const oldHashes = new Set(oldTypes.map(index => fingerprint(oldRoot.schema, index, 0)))
      const newHashes = new Set(newTypes.map(index => fingerprint(newRoot.schema, index, 1)))
      const added = newTypes.filter(index => !oldHashes.has(fingerprint(newRoot.schema, index, 1)))
      if (versions.every(version => version !== undefined) && added.length > 0
        && [...oldHashes].every(hash => newHashes.has(hash))
        && added.every(index => (payloadVersion(newRoot.schema, index) ?? -1) > Math.max(...versions))) {
        return [describe(path, 'payload-version-added', false)]
      }
    }
    if (oldNode.kind !== newNode.kind) return [describe(path, 'type-changed')]
    if (oldNode.kind === 'object' && newNode.kind === 'object') {
      const oldProps = new Map(oldNode.properties.map(property => [property.name, property]))
      const newProps = new Map(newNode.properties.map(property => [property.name, property]))
      for (const [name, property] of oldProps) {
        const next = newProps.get(name)
        const child = `${path}.${name}`
        if (next === undefined) { add(child, 'property-removed'); continue }
        if (property.optional !== next.optional) add(child, next.optional ? 'property-made-optional' : 'property-made-required', scope !== 'body' || !next.optional)
        const childScope = scope === 'body' || scope === 'event' && name === 'data' ? 'body' : 'strict'
        if (property.compatibility !== undefined || next.compatibility !== undefined) {
          const oldGroups = sourceKindGroups(oldRoot.schema.nodes, property.type)
          const newGroups = sourceKindGroups(newRoot.schema.nodes, next.type)
          if (childScope === 'body' && property.compatibility !== undefined && next.compatibility !== undefined
            && oldGroups !== undefined && newGroups !== undefined
            && validSourceCompatibility(oldRoot.schema.nodes, oldNode, property)
            && validSourceCompatibility(newRoot.schema.nodes, newNode, next)
            && matchingSourceCompatibility(property.compatibility, next.compatibility, oldGroups.keys())) {
            for (const [kind, oldTypes] of oldGroups) {
              const newTypes = newGroups.get(kind)
              if (newTypes === undefined) add(`${child}[kind=${JSON.stringify(kind)}]`, 'union-variants-changed')
              else differences.push(...compareAlternatives(oldTypes, newTypes, `${child}[kind=${JSON.stringify(kind)}]`, childScope, active))
            }
            for (const kind of newGroups.keys()) {
              if (!oldGroups.has(kind)) add(`${child}[kind=${JSON.stringify(kind)}]`,
                next.compatibility.attributionKinds.includes(kind) ? 'attribution-kind-added' : 'union-variants-changed',
                !next.compatibility.attributionKinds.includes(kind))
            }
            continue
          }
          if (JSON.stringify(property.compatibility) !== JSON.stringify(next.compatibility)) add(child, 'source-policy-changed')
        }
        descend(property.type, next.type, child, childScope)
      }
      for (const [name, property] of newProps) {
        if (!oldProps.has(name)) add(`${path}.${name}`, property.optional ? 'optional-property-added' : 'required-property-added', scope !== 'body' || !property.optional)
      }
      const oldIndices = new Map(oldNode.indices.map(entry => [fingerprint(oldRoot.schema, entry.key, 0), entry]))
      const newIndices = new Map(newNode.indices.map(entry => [fingerprint(newRoot.schema, entry.key, 1), entry]))
      if (oldIndices.size !== newIndices.size || [...oldIndices.keys()].some(index => !newIndices.has(index))) add(path, 'index-signature-changed')
      for (const [index, entry] of oldIndices) {
        const next = newIndices.get(index)
        if (next !== undefined) descend(entry.value, next.value, `${path}[*]`, scope === 'body' ? 'body' : 'strict')
      }
      return differences
    }
    if (oldNode.kind === 'array' && newNode.kind === 'array') {
      return compare(oldNode.element, newNode.element, `${path}[]`, scope === 'body' ? 'body' : 'strict', active)
    }
    if (oldNode.kind === 'tuple' && newNode.kind === 'tuple') {
      if (oldNode.elements.length !== newNode.elements.length) return [describe(path, 'tuple-length-changed')]
      for (const [index, element] of oldNode.elements.entries()) {
        const next = newNode.elements[index] as SchemaTupleElement
        if (element.optional !== next.optional || element.rest !== next.rest) add(`${path}[${index}]`, 'tuple-element-cardinality-changed')
        descend(element.type, next.type, `${path}[${index}]`, scope === 'body' ? 'body' : 'strict')
      }
      return differences
    }
    if (oldNode.kind === 'union' && newNode.kind === 'union') {
      return compareAlternatives(oldNode.types, newNode.types, path, scope, active)
    }
    return [describe(path, 'type-changed')]
  }
  function compareAlternatives(
    oldTypes: readonly number[], newTypes: readonly number[], path: string, scope: Scope, active: ReadonlySet<string>,
  ): PersistenceTypeChange[] {
    if (oldTypes.length !== newTypes.length) return [describe(path, 'union-variants-changed')]
    const candidates = oldTypes.map(oldType => newTypes.map(newType => compare(oldType, newType, path, scope, active)))
    const matching = matchUnionVariants(candidates.map(row => row.flatMap((candidate, index) =>
      candidate.every(change => !change.requiresVersionBump) ? [index] : [])))
    if (matching !== undefined) return matching.flatMap((next, previous) => candidates[previous]?.[next] ?? [])
    const oldByHash = new Map(oldTypes.map(index => [fingerprint(oldRoot.schema, index, 0), index]))
    const newByHash = new Map(newTypes.map(index => [fingerprint(newRoot.schema, index, 1), index]))
    const removed = [...oldByHash].filter(([hash]) => !newByHash.has(hash)).map(([, index]) => index)
    const added = [...newByHash].filter(([hash]) => !oldByHash.has(hash)).map(([, index]) => index)
    if (removed.length === 1 && added.length === 1) return compare(removed[0] as number, added[0] as number, path, scope, active)
    return [describe(path, 'union-variants-changed')]
  }
  changes.push(...compare(0, 0, key, before.kind === 'event' ? 'event' : 'strict', new Set()))
  if (changes.length === 0) changes.push(describe(key, 'type-changed'))
  return [...new Map(changes.map(change => [JSON.stringify([change.path, change.kind, change.requiresVersionBump]), change])).values()]
}
