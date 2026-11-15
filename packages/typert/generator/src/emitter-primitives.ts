/**
 * Primitives shared by every generated artifact: TypeScript literal quoting,
 * indentation, identifier safety, and the byte-containment query that selects a
 * binary codec.
 *
 * @module @deepseek-ai/dsh-typert-generator/emitter-primitives
 */

import { childTypeNodeIds } from './model.ts'
import type { TypeNodeId } from './model.ts'
import type { TypeGraphRenderer } from './renderer.ts'

export function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n').replaceAll('\r', '\\r')}'`
}

export function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces)
  return value.split('\n').map(line => `${prefix}${line}`).join('\n')
}

export function safeIdentifier(name: string): string {
  const normalized = name.replace(/[^$\w]/gu, '_')
  if (/^[$A-Z_a-z]/u.test(normalized)) return normalized
  return `_${normalized}`
}

export function containsBytes(
  renderer: TypeGraphRenderer,
  id: TypeNodeId,
  nested = true,
  visited = new Set<TypeNodeId>(),
): boolean {
  if (visited.has(id)) return false
  visited.add(id)
  const node = renderer.node(id)
  if (node.kind === 'reference') {
    if (node.target.kind === 'standard' && node.target.name === 'Uint8Array') return true
    if (node.target.kind === 'declaration') {
      const declaration = renderer.declaration(node.target.symbol)
      if (declaration.type !== undefined && containsBytes(renderer, declaration.type, nested, visited)) return true
    }
    if (!nested) return false
  }
  if (!nested && node.kind !== 'reference' && node.kind !== 'parenthesized'
    && node.kind !== 'union' && node.kind !== 'intersection') return false
  if (node.kind === 'object' && node.members.some(member =>
    containsBytes(renderer, member.kind === 'property' ? member.type : member.signature.returns, nested, visited))) return true
  return childTypeNodeIds(node).some(child => containsBytes(renderer, child, nested, visited))
}
