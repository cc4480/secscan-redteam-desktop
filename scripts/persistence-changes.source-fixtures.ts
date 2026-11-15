/** Source-compatibility schema fixtures shared by the baseline and attribution specs. */

import { canonicalizeSchema, schemaDigest } from './persistence-schema-model.ts'
import type { PersistenceRoot, SchemaNode, SourceCompatibility } from './persistence-schema-model.ts'

/** One discriminated alternative of an attributed source union. */
export interface SourceAlternative {
  readonly kind: string
  readonly value?: 'string' | 'number'
  readonly extra?: 'required' | 'optional'
}

/** Build the attributed source event root over `alternatives`. */
export function attributedRoot(
  alternatives: readonly SourceAlternative[],
  options: { policy?: SourceCompatibility | null; role?: 'user' | 'developer'; extra?: boolean } = {},
): PersistenceRoot {
  const role = options.role ?? 'user'
  const policy: SourceCompatibility | undefined = options.policy === null ? undefined : options.policy ?? {
    version: 1, policy: 'session-source-attribution', binding: `session.${role}-message.source`,
    discriminator: 'kind', unknownKinds: 'preserve', attributionKinds: [],
  }
  const nodes: SchemaNode[] = [
    { kind: 'object', indices: [], properties: [{ name: 'type', type: 2, optional: false }, { name: 'data', type: 1, optional: false }] },
    { kind: 'object', indices: [], properties: [
      { name: 'role', type: 4, optional: false }, { name: 'source', type: 3, optional: false, ...(policy === undefined ? {} : { compatibility: policy }) },
      ...(options.extra ? [{ name: 'unrelated', type: 5, optional: false }] : []),
    ] },
    { kind: 'literal', value: 'example/source' },
    { kind: 'primitive', type: 'never' },
    { kind: 'literal', value: role },
    { kind: 'primitive', type: 'string' },
    { kind: 'primitive', type: 'number' },
  ]
  const types = alternatives.map((alternative) => {
    const index = nodes.length
    nodes.push({ kind: 'object', indices: [], properties: [
      { name: 'kind', type: index + 1, optional: false },
      ...(alternative.value === undefined ? [] : [{ name: 'value', type: alternative.value === 'string' ? 5 : 6, optional: false }]),
      ...(alternative.extra === undefined ? [] : [{ name: 'extra', type: 5, optional: alternative.extra === 'optional' }]),
    ] }, { kind: 'literal', value: alternative.kind })
    return index
  })
  nodes[3] = { kind: 'union', types }
  const schema = canonicalizeSchema(nodes, 0)
  return { key: 'event:example/source', kind: 'event', event: 'example/source', surface: false, schema, digest: schemaDigest(schema) }
}

/** The recorded source policy promising `kinds` as additive attributions. */
export function attributionPolicy(kinds: readonly string[], role: 'user' | 'developer' = 'user'): SourceCompatibility {
  return { version: 1, policy: 'session-source-attribution', binding: `session.${role}-message.source`,
    discriminator: 'kind', unknownKinds: 'preserve', attributionKinds: kinds }
}

export const EXISTING_SOURCE: SourceAlternative = { kind: 'semantic', value: 'string' }
export const NEW_SOURCE: SourceAlternative = { kind: 'new-attribution', value: 'number' }
