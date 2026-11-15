/**
 * Resolved persisted-type vocabulary: JSON type graphs and inventory records.
 * Numeric references are local to one graph; names and source locations are metadata.
 */

/** Recorded reader promise for explicitly attributed source additions. */
export interface SourceCompatibility {
  readonly version: 1
  readonly policy: 'session-source-attribution'
  readonly binding: 'session.user-message.source' | 'session.developer-message.source'
  readonly discriminator: 'kind'
  readonly unknownKinds: 'preserve'
  readonly attributionKinds: readonly string[]
}

/** One JSON property, with absence represented independently of its value type. */
export interface SchemaProperty {
  readonly name: string
  readonly type: number
  readonly optional: boolean
  readonly compatibility?: SourceCompatibility
}

/** One positional tuple element. */
export interface SchemaTupleElement {
  readonly type: number
  readonly optional: boolean
  readonly rest: boolean
}

/** A resolved persisted type; references address nodes in the enclosing graph. */
export type SchemaNode =
  | { readonly kind: 'primitive'; readonly type: 'null' | 'boolean' | 'number' | 'string' | 'never' }
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'opaque'; readonly reason: 'any' | 'unknown' }
  | { readonly kind: 'array'; readonly element: number }
  | { readonly kind: 'tuple'; readonly elements: readonly SchemaTupleElement[] }
  | { readonly kind: 'object'; readonly properties: readonly SchemaProperty[]; readonly indices: readonly { readonly key: number; readonly value: number }[] }
  | { readonly kind: 'union'; readonly types: readonly number[] }

/** A self-contained minimized graph with deterministic root-first node numbering. */
export interface CanonicalSchema {
  readonly root: 0
  readonly nodes: readonly SchemaNode[]
}

/** One independently tracked persistent record vocabulary. */
export interface PersistenceRoot {
  readonly key: string
  readonly kind: 'header' | 'envelope' | 'event'
  readonly event?: string
  readonly surface?: boolean
  readonly digest: string
  readonly schema: CanonicalSchema
}

/** One reachable structural type and its non-fingerprinted source declaration metadata. */
export interface PersistenceType {
  readonly digest: string
  readonly schema: CanonicalSchema
  readonly names: readonly string[]
  readonly sources: readonly string[]
}

/** Complete current-source persistence inventory; version pins normalization too. */
export interface PersistenceSchemaInventory {
  readonly formatVersion: 1 | 2
  readonly roots: readonly PersistenceRoot[]
  readonly types: readonly PersistenceType[]
}
