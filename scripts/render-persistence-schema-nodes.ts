/** Schema node access and inline Markdown primitives shared by the catalog renderers. */

import type { CanonicalSchema, SchemaNode } from './persistence-schema-model.ts'

/**
 * Wrap text in an inline Markdown code span, escaping code spans and table cells.
 * @param text - literal text to wrap.
 * @returns the escaped code span.
 */
export function code(text: string): string {
  return '`' + text.replaceAll('`', '\\`').replaceAll('|', '\\|') + '`'
}

/**
 * Drop the recorded line and column from a source reference.
 * @param source - recorded source reference, optionally suffixed with positions.
 * @returns the source path alone.
 */
export function sourcePath(source: string): string {
  return source.replace(/:\d+(?::\d+)?$/u, '')
}

/**
 * Read one schema node, refusing an inventory that omits it.
 * @param schema - canonical schema whose node numbers index `nodes`.
 * @param index - node number to read.
 * @returns the addressed node.
 */
export function nodeAt(schema: CanonicalSchema, index: number): SchemaNode {
  const node = schema.nodes[index]
  if (!node) throw new Error(`persistence catalog: missing schema node ${String(index)}`)
  return node
}

/**
 * Name one child position the way its parent reaches it.
 * @param node - parent node.
 * @param position - child position within the parent.
 * @returns the path segment or synthetic child name.
 */
export function childPath(node: SchemaNode, position: number): string {
  switch (node.kind) {
    case 'object': return node.properties[position]?.name ?? `index-${String(position - node.properties.length)}`
    case 'array': return 'item'
    case 'tuple': return `item-${String(position)}`
    case 'union': return `variant-${String(position)}`
    case 'primitive':
    case 'literal':
    case 'opaque': return String(position)
    default: return assertNever(node)
  }
}

/**
 * Refuse a schema node kind outside the closed union.
 * @param value - the unhandled node kind.
 * @returns never; the call throws.
 */
export function assertNever(value: never): never {
  throw new Error(`persistence catalog: unsupported type ${JSON.stringify(value)}`)
}
