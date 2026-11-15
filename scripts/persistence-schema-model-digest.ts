/**
 * Versioned fingerprints and language recognition over canonical persisted-type graphs.
 */

import { createHash } from 'node:crypto'
import { canonicalizeSchema } from './persistence-schema-model-graph.ts'
import type { CanonicalSchema } from './persistence-schema-model-types.ts'

/**
 * Compute the versioned SHA-256 fingerprint of a canonical graph.
 * @param schema - canonical resolved persisted type.
 * @returns lowercase hexadecimal digest.
 */
export function schemaDigest(schema: CanonicalSchema): string {
  const version = schemaHasCompatibility(schema) ? 2 : 1
  return createHash('sha256').update(`dsh-persistence-schema-v${String(version)}\n`).update(JSON.stringify(schema)).digest('hex')
}

/**
 * Identify graphs that require the policy-aware fingerprint domain.
 * @param schema - resolved persisted type.
 * @returns whether any reachable property records compatibility metadata.
 */
export function schemaHasCompatibility(schema: CanonicalSchema): boolean {
  return schema.nodes.some(node => node.kind === 'object' && node.properties.some(property => property.compatibility !== undefined))
}

/**
 * Recognize the complete recursive JSON value language without relying on type names.
 * @param schema - canonical resolved type.
 * @returns whether the type permits arbitrary JSON values.
 */
export function isArbitraryJsonSchema(schema: CanonicalSchema): boolean {
  return schemaDigest(schema) === JSON_VALUE_DIGEST
}

const JSON_VALUE_DIGEST = schemaDigest(canonicalizeSchema([
  { kind: 'union', types: [1, 2, 3, 4, 5, 6] },
  { kind: 'primitive', type: 'null' },
  { kind: 'primitive', type: 'boolean' },
  { kind: 'primitive', type: 'number' },
  { kind: 'primitive', type: 'string' },
  { kind: 'array', element: 0 },
  { kind: 'object', properties: [], indices: [{ key: 4, value: 0 }] },
], 0))
