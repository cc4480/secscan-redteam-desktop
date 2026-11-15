/** Persistence schema suite: source compatibility authoring bindings and producer qualifications. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractPersistenceSchema } from './persistence-schema.ts'
import { classifyPersistenceChange, parsePersistenceSnapshot } from './persistence-changes.ts'
import { fixture, put } from './persistence-schema.spec-helpers.ts'

function sourceFixture(producers: string, role: 'user' | 'developer' = 'user'): string {
  const root = fixture(`export type Payload = import('../../../llm/llm/src/message.js').${role === 'user' ? 'UserMessage' : 'DeveloperMessage'}`)
  put(root, 'packages/llm/llm/src/message.ts', `
export interface MessageSourceMap {
  semantic: {kind: 'semantic'; value: string}
  ${producers}
}
export type MessageSource = MessageSourceMap[keyof MessageSourceMap]
export interface MessageBase {
  /** @persistenceSource user developer */
  source: MessageSource
}
export interface UserMessage extends MessageBase {
  role: 'user'
}
export interface DeveloperMessage extends MessageBase {
  role: 'developer'
}
`)
  return root
}

const ATTRIBUTION = '/** @persistenceAttribution */'

describe('source compatibility authoring', () => {
  it.each(['user', 'developer'] as const)('records the %s binding and qualifies complete wire-kind groups', (role) => {
    const before = extractPersistenceSchema(sourceFixture('', role))
    const after = extractPersistenceSchema(sourceFixture(`${ATTRIBUTION} unrelatedMapKey: {kind: 'attribution'} & ({form?: never} | {form: 'notice'; summary: string})`, role))
    expect(after.formatVersion).toBe(2)
    const root = after.roots.find(root => root.kind === 'event')!
    const property = root.schema.nodes.flatMap(node => node.kind === 'object' ? node.properties : []).find(property => property.compatibility !== undefined)!
    expect(property.compatibility).toEqual({ version: 1, policy: 'session-source-attribution', binding: `session.${role}-message.source`,
      discriminator: 'kind', unknownKinds: 'preserve', attributionKinds: ['attribution'] })
    expect(classifyPersistenceChange(before.roots.find(root => root.kind === 'event')!, root))
      .toEqual([expect.objectContaining({ kind: 'attribution-kind-added', requiresVersionBump: false })])
    expect(parsePersistenceSnapshot({ ...after, types: [] })).toEqual({ ...after, types: [] })
  })

  it('binds inherited source declarations only on explicitly eligible required roles', () => {
    const root = sourceFixture("system: {kind: 'system-prompt'}; model: {kind: 'model'}; tool: {kind: 'tool'}")
    const core = 'packages/llm/llm/src/message.ts'
    put(root, core, readFileSync(join(root, core), 'utf8') + `
export interface SystemMessage extends MessageBase {role: 'system'; source: MessageSourceMap['system']}
export interface AssistantMessage extends MessageBase {role: 'assistant'; source: MessageSourceMap['model']}
export interface ToolMessage extends MessageBase {role: 'tool'; source: MessageSourceMap['tool']}
export interface UnlistedRole extends MessageBase {role: 'other'}
export interface OptionalRole extends MessageBase {role?: 'user'}
export interface BroadRole extends MessageBase {role: 'user' | 'developer'}
export interface OverriddenUser extends MessageBase {role: 'user'; source: MessageSource}
`)
    put(root, 'packages/domain/payload/src/types.ts', `
import type * as M from '../../../llm/llm/src/message.js'
export interface Payload {
  user: M.UserMessage
  developer: M.DeveloperMessage
  system: M.SystemMessage
  assistant: M.AssistantMessage
  tool: M.ToolMessage
  bare: M.MessageBase
  unlisted: M.UnlistedRole
  optional: M.OptionalRole
  broad: M.BroadRole
  override: M.OverriddenUser
  unrelated: {role: 'user'; source: M.MessageSource}
}
`)
    const schema = extractPersistenceSchema(root).roots.find(root => root.kind === 'event')!.schema
    const payload = schema.nodes.find(node => node.kind === 'object' && node.properties.some(property => property.name === 'unrelated'))!
    if (payload.kind !== 'object') throw new Error('missing payload fixture')
    const bindings = Object.fromEntries(payload.properties.map((property) => {
      const message = schema.nodes[property.type]
      if (message?.kind !== 'object') throw new Error('missing message fixture')
      return [property.name, message.properties.find(property => property.name === 'source')?.compatibility?.binding]
    }))
    expect(bindings).toEqual({
      user: 'session.user-message.source', developer: 'session.developer-message.source',
      system: undefined, assistant: undefined, tool: undefined, bare: undefined, unlisted: undefined,
      optional: undefined, broad: undefined, override: undefined, unrelated: undefined,
    })
  })

  it('keeps roles outside the annotation list strict', () => {
    const root = sourceFixture('', 'developer')
    const core = 'packages/llm/llm/src/message.ts'
    put(root, core, readFileSync(join(root, core), 'utf8').replace('@persistenceSource user developer', '@persistenceSource user'))
    const schema = extractPersistenceSchema(root)
    expect(schema.formatVersion).toBe(1)
    expect(schema.roots.flatMap(root => root.schema.nodes).flatMap(node => node.kind === 'object' ? node.properties : [])
      .every(property => property.compatibility === undefined)).toBe(true)
  })

  it.each(['', 'user user', 'assistant', 'user developer tool'])('rejects invalid eligible role list %s', (roles) => {
    const root = sourceFixture('')
    const core = 'packages/llm/llm/src/message.ts'
    put(root, core, readFileSync(join(root, core), 'utf8').replace('@persistenceSource user developer', `@persistenceSource ${roles}`))
    expect(() => extractPersistenceSchema(root)).toThrow('invalid @persistenceSource binding')
  })

  it('keeps qualification independent of map-key spelling, source order and union-arm order', () => {
    const left = sourceFixture(`${ATTRIBUTION} left: {kind: 'attribution'} & ({form?: never} | {form: 'notice'; summary: string})`)
    const right = sourceFixture(`${ATTRIBUTION} right: ({summary: string; form: 'notice'} | {form?: never}) & {kind: 'attribution'}`)
    expect(extractPersistenceSchema(left).roots).toEqual(extractPersistenceSchema(right).roots)
  })

  it('finds producer-owned qualifications in independently compiled module augmentations', () => {
    const root = sourceFixture('')
    const before = extractPersistenceSchema(root)
    put(root, 'packages/llm/llm/src/producer.ts', `import './message.js'
declare module './message.js' {
  interface MessageSourceMap {
    ${ATTRIBUTION}
    catalogKey: {kind: 'external-producer'}
  }
}`)
    const after = extractPersistenceSchema(root)
    expect(classifyPersistenceChange(before.roots.find(root => root.kind === 'event')!, after.roots.find(root => root.kind === 'event')!))
      .toEqual([expect.objectContaining({ kind: 'attribution-kind-added', requiresVersionBump: false })])
  })

  it('does not qualify unmarked additions or structurally equal unbound fields', () => {
    const before = sourceFixture('')
    const after = sourceFixture("unmarked: {kind: 'new'}")
    expect(classifyPersistenceChange(extractPersistenceSchema(before).roots.find(root => root.kind === 'event')!,
      extractPersistenceSchema(after).roots.find(root => root.kind === 'event')!).some(change => change.requiresVersionBump)).toBe(true)
    const left = fixture("export interface Payload { source: {kind: 'old'} }")
    const right = fixture("export interface Payload { source: {kind: 'old'} | {kind: 'new'} }")
    expect(classifyPersistenceChange(extractPersistenceSchema(left).roots.find(root => root.kind === 'event')!,
      extractPersistenceSchema(right).roots.find(root => root.kind === 'event')!).some(change => change.requiresVersionBump)).toBe(true)
  })

  it.each([
    [`${ATTRIBUTION} broad: {kind: string}`, 'one literal wire kind'],
    [`${ATTRIBUTION} optional: {kind?: 'new'}`, 'one literal wire kind'],
    [`${ATTRIBUTION} ambiguous: {kind: 'a'} | {kind: 'b'}`, 'one literal wire kind'],
    [`${ATTRIBUTION} duplicate: {kind: 'semantic'}`, 'conflicting attribution'],
    [`${ATTRIBUTION} first: {kind: 'same'};\n${ATTRIBUTION} second: {kind: 'same'; value: number}`, 'conflicting attribution'],
    ['broadUnmarked: {kind: string}', 'invalid source compatibility'],
    ...['model', 'tool', 'system-prompt', 'compact-checkpoint', 'dsh-session-title-llm', 'tool-registry', 'runtime-context', 'plugin']
      .map(kind => [`${ATTRIBUTION} forbidden: {kind: '${kind}'}`, 'invalid source compatibility']),
    ["/** @persistenceAttribution yes */ invalid: {kind: 'new'}", 'invalid @persistenceAttribution'],
    ['/** @persistenceAttribution\n * @persistenceAttribution */ duplicateTag: {kind: \'new\'}', 'invalid @persistenceAttribution'],
  ])('rejects invalid producer declaration %s', (producer, error) => {
    expect(() => extractPersistenceSchema(sourceFixture(producer))).toThrow(error)
  })

  it.each(['auto-review', 'compact-basic', 'ptc-mode'])('rejects reserved producer kind %s as new attribution', (kind) => {
    for (const role of ['user', 'developer'] as const) {
      const root = sourceFixture(`${ATTRIBUTION} reintroduced: {kind: '${kind}'}`, role)
      expect(() => extractPersistenceSchema(root)).toThrow('invalid source compatibility')
    }
  })

  it('rejects attribution and binding annotations outside their declared owners', () => {
    const misplaced = sourceFixture('')
    put(misplaced, 'packages/domain/payload/src/types.ts', `${ATTRIBUTION} export interface Payload {kind: 'new'}`)
    expect(() => extractPersistenceSchema(misplaced)).toThrow('must annotate a MessageSourceMap producer property')
    const source = sourceFixture('')
    put(source, 'packages/domain/payload/src/types.ts', "export interface Payload {role: 'user';\n/** @persistenceSource user */\nsource: {kind: 'new'}}")
    expect(() => extractPersistenceSchema(source)).toThrow('invalid @persistenceSource binding')
  })
})
