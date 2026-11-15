/** Persistence schema suite: explicitly reserved JSON properties and their change classification. */

import { describe, expect, it } from 'vitest'
import { extractPersistenceSchema } from './persistence-schema.ts'
import { classifyPersistenceChange } from './persistence-changes.ts'
import { fixture } from './persistence-schema.spec-helpers.ts'

describe('explicitly reserved JSON properties', () => {
  function extractedEvent(source: string) {
    const model = extractPersistenceSchema(fixture(source))
    const root = model.roots.find(root => root.event === 'test/record')
    if (root === undefined) throw new Error('missing reserved-property fixture event')
    return root
  }

  it('classifies a value added to a reserved field as a changed type', () => {
    const before = extractedEvent('export interface Payload { id: string;\n/** @persistenceReserved */\ntool?: never }')
    const after = extractedEvent('export interface Payload { id: string; tool?: string }')
    expect(classifyPersistenceChange(before, after)).toEqual([expect.objectContaining({
      path: 'event:test/record.data.tool', kind: 'type-changed', requiresVersionBump: true,
    })])
  })

  it.each(['never', 'undefined', 'never | undefined'])('retains a marked optional %s property as never', (value) => {
    const root = extractedEvent(`interface Reserved {\n/** @persistenceReserved */\ntool?: ${value}\n}\nexport interface Payload extends Reserved { id: string }`)
    const reserved = root.schema.nodes.flatMap(node => node.kind === 'object'
      ? node.properties.filter(property => property.name === 'tool').map(property => ({ optional: property.optional, value: root.schema.nodes[property.type] }))
      : [])
    expect(reserved).toEqual([{ optional: true, value: { kind: 'primitive', type: 'never' } }])
  })

  it('keeps unmarked optional never and undefined fields erased', () => {
    const before = extractedEvent('export interface Payload { id: string; tool?: never; missing?: undefined }')
    const after = extractedEvent('export interface Payload { id: string }')
    expect(before).toEqual(after)
  })

  it.each([
    'Required<Reserved>',
    '{ [Key in keyof Reserved]?: string }',
  ])('rejects a reserved property rewritten by %s', (mapped) => {
    expect(() => extractedEvent(`interface Reserved {\n/** @persistenceReserved */\ntool?: never\n}\nexport type Payload = ${mapped} & {id: string}`))
      .toThrow('@persistenceReserved must remain an optional never or undefined property')
  })

  it.each([
    ['required field', 'export interface Payload { id: string;\n/** @persistenceReserved */\ntool: never }'],
    ['string field', 'export interface Payload { id: string;\n/** @persistenceReserved */\ntool?: string }'],
    ['nullable field', 'export interface Payload { id: string;\n/** @persistenceReserved */\ntool?: null }'],
    ['unknown field', 'export interface Payload { id: string;\n/** @persistenceReserved */\ntool?: unknown }'],
    ['tag arguments', 'export interface Payload { id: string;\n/** @persistenceReserved value */\ntool?: never }'],
    ['duplicate tag', 'export interface Payload { id: string;\n/** @persistenceReserved\n * @persistenceReserved */\ntool?: never }'],
    ['non-property tag', '/** @persistenceReserved */\nexport interface Payload { id: string }'],
    ['unreachable misuse', 'interface Unused {\n/** @persistenceReserved */\ntool?: string }\nexport interface Payload { id: string }'],
  ])('rejects %s', (_name, source) => {
    expect(() => extractedEvent(source)).toThrow('@persistenceReserved requires one argument-free marker on an optional never or undefined property')
  })
})
