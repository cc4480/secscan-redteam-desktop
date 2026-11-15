/** Primitive validators and canonical-schema parsing for persisted persistence artifacts. */

import { canonicalizeSchema } from './persistence-schema-model.ts'
import { validSourceCompatibility } from './persistence-source-policy.ts'
import { DIGEST_PATTERN, ID_PATTERN } from './persistence-changes.constants.ts'
import type { CanonicalSchema } from './persistence-schema-model.ts'

/** Assert one decoded value is a JSON object.
 * @param value - decoded value to check.
 * @param label - field path named in the failure.
 * @returns the same value typed as a string-keyed object.
 */
export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

/** Assert an object carries exactly the expected fields.
 * @param value - decoded object to check.
 * @param expected - required field names.
 * @param label - field path named in the failure.
 * @param optional - field names that may be present beyond `expected`.
 */
export function keys(value: Record<string, unknown>, expected: readonly string[], label: string, optional: readonly string[] = []): void {
  const missing = expected.find(key => !Object.hasOwn(value, key))
  const unexpected = Object.keys(value).find(key => !expected.includes(key) && !optional.includes(key))
  if (missing !== undefined || unexpected !== undefined) throw new Error(`${label}: ${missing === undefined ? `unknown field ${unexpected}` : `missing field ${missing}`}`)
}

/** Assert one decoded value is an array.
 * @param value - decoded value to check.
 * @param label - field path named in the failure.
 * @returns the same value typed as an array of unknown elements.
 */
export function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

/** Assert one decoded value is a non-empty string.
 * @param value - decoded value to check.
 * @param label - field path named in the failure.
 * @returns the same value typed as a string.
 */
export function textValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

/** Assert one decoded value is a boolean.
 * @param value - decoded value to check.
 * @param label - field path named in the failure.
 * @returns the same value typed as a boolean.
 */
export function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
  return value
}

/** Assert one decoded value is an acknowledgement identifier.
 * @param value - decoded value to check.
 * @param label - field path named in the failure.
 * @returns the validated identifier.
 */
export function identifier(value: unknown, label: string): string {
  const id = textValue(value, label)
  if (!ID_PATTERN.test(id)) throw new Error(`${label} must be YYYY-MM-DD-slug`)
  return id
}

/** Assert one decoded value is a canonical schema digest.
 * @param value - decoded value to check.
 * @param label - field path named in the failure.
 * @returns the validated digest.
 */
export function digest(value: unknown, label: string): string {
  const result = textValue(value, label)
  if (!DIGEST_PATTERN.test(result)) throw new Error(`${label} must be a SHA-256 digest`)
  return result
}

/** Assert one decoded value indexes an existing schema node.
 * @param value - decoded value to check.
 * @param count - number of nodes the reference may address.
 * @param label - field path named in the failure.
 * @returns the validated node index.
 */
export function reference(value: unknown, count: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= count) throw new Error(`${label} references an unknown schema node`)
  return value as number
}

/** Validate one canonical schema graph, its source compatibility, and its canonical form.
 * @param value - decoded schema value.
 * @param label - root key or field path named in failures.
 * @param formatVersion - normalization version of the containing inventory.
 * @returns the validated canonical schema.
 */
export function parseSchema(value: unknown, label: string, formatVersion: 1 | 2): CanonicalSchema {
  const input = record(value, label)
  keys(input, ['root', 'nodes'], label)
  if (input.root !== 0) throw new Error(`${label}.root must be zero`)
  const nodes = array(input.nodes, `${label}.nodes`)
  if (nodes.length === 0) throw new Error(`${label}.nodes must not be empty`)
  const ref = (value: unknown): number => reference(value, nodes.length, label)
  for (const [index, raw] of nodes.entries()) {
    const node = record(raw, `${label}.nodes[${index}]`)
    switch (node.kind) {
      case 'primitive':
        keys(node, ['kind', 'type'], label)
        if (!['null', 'boolean', 'number', 'string', 'never'].includes(String(node.type))) throw new Error(`${label}: invalid primitive`)
        break
      case 'literal':
        keys(node, ['kind', 'value'], label)
        if (!['string', 'boolean', 'number'].includes(typeof node.value)
          || typeof node.value === 'number' && !Number.isFinite(node.value)) throw new Error(`${label}: invalid literal`)
        break
      case 'opaque':
        keys(node, ['kind', 'reason'], label)
        if (!['any', 'unknown'].includes(String(node.reason))) throw new Error(`${label}: invalid opaque reason`)
        break
      case 'array':
        keys(node, ['kind', 'element'], label)
        ref(node.element)
        break
      case 'tuple':
        keys(node, ['kind', 'elements'], label)
        for (const rawElement of array(node.elements, label)) {
          const element = record(rawElement, label)
          keys(element, ['type', 'optional', 'rest'], label)
          ref(element.type)
          bool(element.optional, label)
          bool(element.rest, label)
        }
        break
      case 'object': {
        keys(node, ['kind', 'properties', 'indices'], label)
        const names = new Set<string>()
        for (const rawProperty of array(node.properties, label)) {
          const property = record(rawProperty, label)
          keys(property, ['name', 'type', 'optional'], label, formatVersion === 2 ? ['compatibility'] : [])
          if (property.compatibility !== undefined) {
            const policy = record(property.compatibility, `${label} source compatibility`)
            keys(policy, ['version', 'policy', 'binding', 'discriminator', 'unknownKinds', 'attributionKinds'], label)
            if (policy.version !== 1 || policy.policy !== 'session-source-attribution'
              || !['session.user-message.source', 'session.developer-message.source'].includes(String(policy.binding))
              || policy.discriminator !== 'kind' || policy.unknownKinds !== 'preserve') {
              throw new Error(`${label}: unsupported source compatibility policy`)
            }
            for (const kind of array(policy.attributionKinds, label)) textValue(kind, label)
          }
          if (typeof property.name !== 'string') throw new Error(`${label}: property name must be a string`)
          const name = property.name
          if (names.has(name)) throw new Error(`${label}: duplicate property ${name}`)
          names.add(name)
          ref(property.type)
          bool(property.optional, label)
        }
        for (const rawIndex of array(node.indices, label)) {
          const entry = record(rawIndex, label)
          keys(entry, ['key', 'value'], label)
          ref(entry.key)
          ref(entry.value)
        }
        break
      }
      case 'union':
        keys(node, ['kind', 'types'], label)
        if (array(node.types, label).length === 0) throw new Error(`${label}: empty union`)
        for (const item of node.types as unknown[]) ref(item)
        break
      default:
        throw new Error(`${label}: unknown schema node kind ${String(node.kind)}`)
    }
  }
  const schema = input as unknown as CanonicalSchema
  for (const node of schema.nodes) {
    if (node.kind !== 'object') continue
    for (const property of node.properties) {
      if (property.compatibility !== undefined && !validSourceCompatibility(schema.nodes, node, property)) {
        throw new Error(`${label}: invalid source compatibility binding or attribution kinds`)
      }
    }
  }
  const canonical = canonicalizeSchema(schema.nodes, schema.root)
  if (JSON.stringify(canonical) !== JSON.stringify(schema)) throw new Error(`${label}: schema is not canonical`)
  return schema
}
