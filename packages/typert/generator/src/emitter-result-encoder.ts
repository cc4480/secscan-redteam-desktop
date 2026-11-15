/**
 * The binary result encoder projected from a modeled type: one encoder body per
 * type node, plus the container helpers the generated code calls.
 *
 * @module @deepseek-ai/dsh-typert-generator/emitter-result-encoder
 */

import { containsBytes, indent, quote } from './emitter-primitives.ts'
import { TypertEmitError } from './emitter-model.ts'
import type { TypeGraphRenderer } from './renderer.ts'
import type { TypeNodeId } from './model.ts'

export class ResultEncoderEmitter {
  private readonly names = new Map<TypeNodeId, string>()
  private readonly bodies = new Map<TypeNodeId, string>()

  constructor(private readonly renderer: TypeGraphRenderer) {}

  reference(id: TypeNodeId): string | undefined {
    if (!containsBytes(this.renderer, id)) return undefined
    const existing = this.names.get(id)
    if (existing !== undefined) return existing
    const name = `$encode${this.names.size}`
    this.names.set(id, name)
    const node = this.renderer.node(id)
    const container = node.kind === 'object' || node.kind === 'array' || node.kind === 'tuple'
    const body = container || node.kind === 'union' || node.kind === 'intersection'
      ? `return $resultContainer(value, path, ancestors, value => {\n${indent(this.body(id), 2)}\n}, ${container})`
      : this.body(id)
    this.bodies.set(id, `const ${name} = (value, writeBytes, path, ancestors) => {\n${indent(body, 2)}\n}`)
    return name
  }

  definitions(): string[] {
    return this.bodies.size === 0 ? [] : [RESULT_SNAPSHOT, ...this.bodies.values()]
  }

  private call(id: TypeNodeId, value: string, path = 'path'): string {
    const reference = this.reference(id)
    return reference === undefined ? value : `${reference}(${value}, writeBytes, ${path}, ancestors)`
  }

  private body(id: TypeNodeId): string {
    const node = this.renderer.node(id)
    switch (node.kind) {
      case 'reference': {
        if (node.target.kind === 'standard' && node.target.name === 'Uint8Array') {
          return 'return value instanceof Uint8Array ? writeBytes(value, path) : value'
        }
        if (node.target.kind === 'declaration') {
          const type = this.renderer.declaration(node.target.symbol).type
          if (type !== undefined) return `return ${this.call(type, 'value')}`
        }
        break
      }
      case 'union':
      case 'intersection': return [
        ...node.types.filter(type => containsBytes(this.renderer, type)).map(type => `value = ${this.call(type, 'value')}`),
        'return value',
      ].join('\n')
      case 'array': return [
        'if (!Array.isArray(value)) return value',
        `for (let index = 0; index < value.length; index++) value[index] = ${this.call(node.element, 'value[index]', '[...path, index]')}`,
        'return value',
      ].join('\n')
      case 'tuple': {
        const lines = ['if (!Array.isArray(value)) return value']
        for (const [index, element] of node.elements.entries()) {
          if (!containsBytes(this.renderer, element.type)) continue
          if (element.rest) {
            const rest = this.renderer.node(element.type)
            if (rest.kind !== 'array') break
            lines.push(`for (let index = ${index}; index < value.length; index++) value[index] = ${this.call(rest.element, 'value[index]', '[...path, index]')}`)
          } else {
            lines.push(`if (value.length > ${index}) value[${index}] = ${this.call(element.type, `value[${index}]`, `[...path, ${index}]`)}`)
          }
        }
        return [...lines, 'return value'].join('\n')
      }
      case 'object': {
        const lines = ["if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) return value"]
        for (const member of node.members) {
          if (member.kind === 'property' && containsBytes(this.renderer, member.type)) {
            const key = quote(member.name)
            lines.push(`if (Object.hasOwn(value, ${key})) value[${key}] = ${this.call(member.type, `value[${key}]`, `[...path, ${key}]`)}`)
          } else if (member.kind === 'index' && containsBytes(this.renderer, member.signature.returns)) {
            lines.push(`for (const key of Object.keys(value)) value[key] = ${this.call(member.signature.returns, 'value[key]', '[...path, key]')}`)
          }
        }
        return [...lines, 'return value'].join('\n')
      }
      default: break
    }
    throw new TypertEmitError(`typert result encoder: ${node.kind} has no binary field projection`)
  }
}

const RESULT_SNAPSHOT = `const $resultSnapshot = (input, path) => {
  if (input === null || typeof input !== 'object' || input instanceof Uint8Array) return input
  const toJSON = input.toJSON
  const value = typeof toJSON === 'function' ? toJSON.call(input, path.at(-1)?.toString() ?? 'value') : input
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return value
  if (Array.isArray(value)) {
    const items = []
    for (let index = 0, length = value.length; index < length; index++) items.push(value[index])
    return items
  }
  const fields = {}
  for (const key of Object.keys(value)) {
    const item = key === 'toJSON' && value === input ? toJSON : value[key]
    if (key === 'toJSON' && typeof item === 'function') continue
    Object.defineProperty(fields, key, { value: item, enumerable: true, writable: true, configurable: true })
  }
  return fields
}
const $resultContainer = (input, path, ancestors, project, snapshot) => {
  if (input === null || typeof input !== 'object') return project(input)
  const owner = !ancestors.has(input)
  if (!owner && ancestors.get(input) !== path.length) throw new TypeError('Remote result contains a circular object')
  if (owner) ancestors.set(input, path.length)
  try { return project(snapshot ? $resultSnapshot(input, path) : input) }
  finally { if (owner) ancestors.delete(input) }
}`
