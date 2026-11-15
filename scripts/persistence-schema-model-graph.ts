/**
 * Graph traversal, minimization and deterministic numbering for resolved persisted types.
 */

import type { CanonicalSchema, SchemaNode } from './persistence-schema-model-types.ts'

/**
 * Visit direct graph edges in their normalized semantic order.
 * @param node - resolved graph node.
 * @returns referenced node indices, including repeated ordered edges.
 */
export function schemaChildren(node: SchemaNode): number[] {
  switch (node.kind) {
    case 'array': return [node.element]
    case 'tuple': return node.elements.map(element => element.type)
    case 'object': return [...node.properties.map(property => property.type), ...node.indices.flatMap(index => [index.key, index.value])]
    case 'union': return [...node.types]
    case 'primitive':
    case 'literal':
    case 'opaque': return []
    default: return assertNever(node)
  }
}

function mapNode(node: SchemaNode, ref: (id: number) => number): SchemaNode {
  switch (node.kind) {
    case 'array': return { kind: 'array', element: ref(node.element) }
    case 'tuple': return { kind: 'tuple', elements: node.elements.map(element => ({ type: ref(element.type), optional: element.optional, rest: element.rest })) }
    case 'object': return {
      kind: 'object',
      properties: [...node.properties].sort((left, right) => compare(left.name, right.name))
        .map(property => ({ name: property.name, type: ref(property.type), optional: property.optional,
          ...(property.compatibility === undefined ? {} : { compatibility: {
            version: property.compatibility.version, policy: property.compatibility.policy, binding: property.compatibility.binding,
            discriminator: property.compatibility.discriminator, unknownKinds: property.compatibility.unknownKinds,
            attributionKinds: [...new Set(property.compatibility.attributionKinds)].sort(compare),
          } }),
        })),
      indices: node.indices.map(index => ({ key: ref(index.key), value: ref(index.value) }))
        .sort((left, right) => left.key - right.key || left.value - right.value),
    }
    case 'union': return { kind: 'union', types: [...new Set(node.types.map(ref))].sort((left, right) => left - right) }
    case 'primitive': return { kind: 'primitive', type: node.type }
    case 'literal': return { kind: 'literal', value: node.value }
    case 'opaque': return { kind: 'opaque', reason: node.reason }
    default: return assertNever(node)
  }
}

function partition(nodes: readonly SchemaNode[]): number[] {
  let colors = nodes.map(() => 0)
  for (;;) {
    const signatures = nodes.map((node, index) => JSON.stringify([colors[index], mapNode(node, id => colors[id] as number)]))
    const ordered = [...new Set(signatures)].sort(compare)
    const ids = new Map(ordered.map((value, index) => [value, index]))
    const next = signatures.map(value => ids.get(value) as number)
    const unchanged = new Set(next).size === new Set(colors).size
    colors = next
    if (unchanged) return colors
  }
}

/**
 * Minimize bisimilar recursive nodes and number the reachable graph deterministically.
 * @param input - resolved nodes; property and union order may be arbitrary.
 * @param root - index of the requested root.
 * @returns canonical graph excluding unreachable nodes and duplicate structures.
 */
export function canonicalizeSchema(input: readonly SchemaNode[], root: number): CanonicalSchema {
  input = normalizeUnions(input)
  const selected: number[] = []
  const positions = new Map<number, number>()
  const select = (id: number): void => {
    if (!Number.isInteger(id) || id < 0 || id >= input.length) throw new Error(`persistence schema: missing node ${String(id)}`)
    if (positions.has(id)) return
    positions.set(id, selected.length)
    selected.push(id)
    for (const child of schemaChildren(input[id] as SchemaNode)) select(child)
  }
  select(root)
  let nodes = selected.map(id => mapNode(input[id] as SchemaNode, child => positions.get(child) as number))
  let rootIndex = 0
  for (;;) {
    const colors = partition(nodes)
    const representatives = new Map<number, number>()
    colors.forEach((color, index) => { if (!representatives.has(color)) representatives.set(color, index) })
    const aliases = new Map<number, number>()
    nodes.forEach((node, index) => {
      if (node.kind !== 'union') return
      const members = [...new Set(node.types.map(child => colors[child] as number))]
      if (members.length === 1) aliases.set(index, representatives.get(members[0] as number) as number)
    })
    if (aliases.size > 0) {
      const resolve = (id: number): number => {
        const seen = new Set<number>()
        while (aliases.has(id)) {
          if (seen.has(id)) throw new Error('persistence schema: union cycle has no material type')
          seen.add(id)
          id = aliases.get(id) as number
        }
        return id
      }
      rootIndex = resolve(rootIndex)
      nodes = nodes.map((node, index) => aliases.has(index) ? nodes[resolve(index)] as SchemaNode : mapNode(node, resolve))
      continue
    }
    const emitted = new Map<number, number>()
    const result: SchemaNode[] = []
    const visit = (id: number): number => {
      const color = colors[id] as number
      const existing = emitted.get(color)
      if (existing !== undefined) return existing
      const position = result.length
      emitted.set(color, position)
      result.push({ kind: 'primitive', type: 'never' })
      const representative = representatives.get(color) as number
      const colored = mapNode(nodes[representative] as SchemaNode, child => colors[child] as number)
      result[position] = mapNode(colored, child => visit(representatives.get(child) as number))
      return position
    }
    visit(rootIndex)
    return { root: 0, nodes: result }
  }
}

function normalizeUnions(input: readonly SchemaNode[]): SchemaNode[] {
  const result = [...input]
  const flattened = (id: number, visiting: Set<number>): number[] => {
    const node = input[id]
    if (node === undefined) throw new Error(`persistence schema: missing node ${String(id)}`)
    if (node.kind !== 'union') return [id]
    if (visiting.has(id)) throw new Error('persistence schema: union cycle has no material type')
    const next = new Set(visiting).add(id)
    return node.types.flatMap(child => flattened(child, next))
  }
  for (const [id, node] of input.entries()) {
    if (node.kind !== 'union') continue
    let members = [...new Set(flattened(id, new Set()))]
    const primitives = new Set(members.flatMap((child) => {
      const value = input[child] as SchemaNode
      return value.kind === 'primitive' ? [value.type] : []
    }))
    const literals = members.flatMap((child) => {
      const value = input[child] as SchemaNode
      return value.kind === 'literal' ? [value.value] : []
    })
    if (!primitives.has('boolean') && literals.includes(true) && literals.includes(false)) {
      primitives.add('boolean')
      members.push(result.length)
      result.push({ kind: 'primitive', type: 'boolean' })
    }
    members = members.filter((child) => {
      const value = result[child] as SchemaNode
      if (value.kind === 'primitive') return value.type !== 'never'
      return value.kind !== 'literal' || !primitives.has(typeof value.value as 'string' | 'number' | 'boolean')
    })
    result[id] = members.length === 0 ? { kind: 'primitive', type: 'never' } : { kind: 'union', types: members }
  }
  return result
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertNever(value: never): never {
  throw new Error(`persistence schema: unsupported node ${JSON.stringify(value)}`)
}
