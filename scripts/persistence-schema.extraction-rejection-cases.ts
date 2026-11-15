/** Persistence schema extraction: JSX contributions, unsupported declarations, and digest totals. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectLogEvents } from './gen-persistence-catalog.ts'
import { extractPersistenceSchema } from './persistence-schema.ts'
import { canonicalizeSchema, isArbitraryJsonSchema, schemaDigest } from './persistence-schema-model.ts'
import { event, fixture, put } from './persistence-schema.spec-helpers.ts'

describe('persistent source type extraction', () => {
  it('includes JSX-module events and rejects unsupported inherited declarations there', () => {
    const root = fixture('export interface Payload {id: string}')
    put(root, 'packages/domain/extension/src/index.tsx', `import '@deepseek-ai/dsh-session/types'; declare module '@deepseek-ai/dsh-session/types' {
interface SessionEventMap {
/** A JSX-module event. */
'plugin/tsx': { value: number }
}}
`)
    const config = join(root, 'tsconfig.host.json')
    const settings = JSON.parse(readFileSync(config, 'utf8')) as { include: string[] }
    settings.include.push('packages/**/src/**/*.tsx')
    writeFileSync(config, JSON.stringify(settings))
    expect(extractPersistenceSchema(root).roots.some(root => root.event === 'plugin/tsx')).toBe(true)
    put(root, 'packages/domain/extension/src/index.tsx', `import '@deepseek-ai/dsh-session/types';
interface Extra { 'plugin/inherited': {value: number} }
declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap extends Extra {} }
`)
    expect(() => extractPersistenceSchema(root)).toThrow('uses extends')
  })

  it('rejects an event map whose compiler vocabulary exceeds the discovered source corpus', () => {
    const root = fixture("import '../../../../vendor/events.ts'; export interface Payload {id: string}")
    put(root, 'vendor/events.ts', `import '@deepseek-ai/dsh-session/types'; declare module '@deepseek-ai/dsh-session/types' {
interface SessionEventMap {
/** A contribution outside the package source corpus. */
'outside/event': { value: number }
}}
`)
    expect(() => extractPersistenceSchema(root)).toThrow('omitted: outside/event')
  })

  it('keeps surface metadata strict and optional field additions visible', () => {
    const old = extractPersistenceSchema(fixture('export interface Payload {id: string}'))
    const optional = extractPersistenceSchema(fixture('export interface Payload {id: string; detail?: string}'))
    const surface = extractPersistenceSchema(fixture('export interface Payload {id: string}', { surface: "'test/record'" }))
    expect(event(old)).not.toBe(event(optional))
    expect(event(old)).not.toBe(event(surface))
    expect(surface.roots.find(root => root.event === 'test/record')?.surface).toBe(true)
    expect(surface.roots.find(root => root.kind === 'envelope')?.digest).not.toBe(old.roots.find(root => root.kind === 'envelope')?.digest)
  })

  it('tracks the physical JSONL header independently of the logical Session header', () => {
    const root = fixture('export interface Payload {id: string}')
    const before = extractPersistenceSchema(root)
    put(root, 'packages/session/session-persistence-jsonl/src/format.ts', "interface HeaderLine {type: 'session'; version: number; id: string; delegationDepth: number; marker?: string}\nexport {}\n")
    const after = extractPersistenceSchema(root)
    expect(after.roots.find(root => root.key === 'JsonlHeaderLine')?.digest).not.toBe(before.roots.find(root => root.key === 'JsonlHeaderLine')?.digest)
    expect(after.roots.find(root => root.key === 'SessionHeader')?.digest).toBe(before.roots.find(root => root.key === 'SessionHeader')?.digest)
  })

  it('keeps arbitrary JSON structural while explicitly identifying unknown and any', () => {
    const root = fixture('type Arbitrary = null | boolean | number | string | Arbitrary[] | {[key: string]: Arbitrary}; export interface Payload {json: Arbitrary; opaque: unknown; unsafe: any}')
    const model = extractPersistenceSchema(root)
    expect(model.types.some(item => isArbitraryJsonSchema(item.schema))).toBe(true)
    expect(model.types.filter(item => item.schema.nodes[0]?.kind === 'opaque').map(item => item.schema.nodes[0]))
      .toEqual(expect.arrayContaining([{ kind: 'opaque', reason: 'unknown' }, { kind: 'opaque', reason: 'any' }]))
    put(root, 'packages/domain/payload/src/types.ts', 'type Arbitrary = null | boolean | number | string | Arbitrary[]; export interface Payload {json: Arbitrary; opaque: unknown; unsafe: any}')
    const changed = extractPersistenceSchema(root)
    expect(event(changed)).not.toBe(event(model))
    expect(changed.types.some(item => isArbitraryJsonSchema(item.schema))).toBe(false)
  })

  it('rejects invalid reachable declaration files despite inherited skipLibCheck', () => {
    const root = fixture("export type { Payload } from './declared.js'")
    put(root, 'packages/domain/payload/src/declared.d.ts', 'type Bad = ReturnType<42>; export interface Payload {value: Bad}')
    expect(() => extractPersistenceSchema(root)).toThrow('TS2344')
  })

  it('preserves authored declaration-file any without checking unrelated declarations', () => {
    const root = fixture("export type { Payload } from './declared.js'")
    put(root, 'packages/domain/payload/src/declared.d.ts', 'type Declared = any; export interface Payload {value: Declared}; type Unrelated = ReturnType<42>')
    const model = extractPersistenceSchema(root)
    expect(model.types.some(item => item.schema.nodes[0]?.kind === 'opaque' && item.schema.nodes[0].reason === 'any')).toBe(true)
  })

  it('locates named transitive definitions at their declarations instead of their references', () => {
    const root = fixture("import type { Detail as ImportedDetail } from './detail.js'\nexport interface Payload { first: ImportedDetail; second: ImportedDetail }")
    put(root, 'packages/domain/payload/src/detail.ts', '/** Detailed payload. */\nexport interface Detail { code: string; done: true }\n')
    const model = extractPersistenceSchema(root)
    const detail = model.types.find(item => item.names.includes('packages/domain/payload/src/detail.ts#Detail'))
    expect(detail?.sources).toEqual(['packages/domain/payload/src/detail.ts:2'])
  })

  it('keeps shared scalar declaration metadata at real aliases and omits plain property references', () => {
    const root = fixture([
      'type Label = string',
      "type Done = 'done'",
      'export interface Payload {',
      '  label: Label',
      '  other: string',
      '  state: Done',
      "  fallback: 'done'",
      '  count: number',
      '}',
    ].join('\n'))
    const model = extractPersistenceSchema(root)
    const string = model.types.find(item => item.schema.nodes[0]?.kind === 'primitive' && item.schema.nodes[0].type === 'string')
    const literal = model.types.find(item => item.schema.nodes[0]?.kind === 'literal' && item.schema.nodes[0].value === 'done')
    const number = model.types.find(item => item.schema.nodes[0]?.kind === 'primitive' && item.schema.nodes[0].type === 'number')
    expect(string?.names).toEqual(['packages/domain/payload/src/types.ts#Label'])
    expect(string?.sources).toEqual(['packages/domain/payload/src/types.ts:1'])
    expect(literal?.names).toEqual(['packages/domain/payload/src/types.ts#Done'])
    expect(literal?.sources).toEqual(['packages/domain/payload/src/types.ts:2'])
    expect(number?.names).toEqual([])
    expect(number?.sources).toEqual([])
  })

  it('uses the declaration of an anonymous object literal and never its containing property', () => {
    const root = fixture('export interface Payload {\n  detail:\n    { code: string }\n}')
    const model = extractPersistenceSchema(root)
    const detail = model.types.find((item) => {
      const node = item.schema.nodes[0]
      return node?.kind === 'object' && node.properties.length === 1 && node.properties[0]?.name === 'code'
    })
    expect(detail?.sources).toEqual(['packages/domain/payload/src/types.ts:3'])
  })

  it.each([
    ['missing type', 'export interface Payload {value: Missing}', 'TS2304'],
    ['callable value', 'export interface Payload {value: () => void}', 'callable data'],
    ['class instance', 'export class Instance {value: string = ""}; export interface Payload {value: Instance}', 'class instances'],
    ['required undefined', 'export interface Payload {value: string | undefined}', 'no supported JSON'],
    ['unresolved template', 'export interface Payload {value: `prefix-${string}`}', 'no supported JSON'],
    ['empty object type', 'export type Payload = {}', 'unconstrained empty object'],
    ['symbol property', 'declare const key: unique symbol; export interface Payload {[key]: string; value: number}', 'symbol-keyed data'],
    ['conflicting merged property', 'export interface Payload {value: string}; export interface Payload {value: number}', 'TS2717'],
    ['class intersection', 'class Instance {value: string = ""}; export type Payload = Instance & {extra: string}', 'class instances'],
    ['invalid generic alias', 'type Bad = ReturnType<42>; export interface Payload {value: Bad}', 'TS2344'],
  ])('rejects %s rather than weakening the schema', (_name, source, error) => {
    expect(() => extractPersistenceSchema(fixture(source))).toThrow(error)
  })

  // Repository-wide TypeScript extraction and reachable-node hashing use the Windows coverage test budget.
  it('includes every real repository event and fingerprints every reachable node', { timeout: 90_000 }, () => {
    const root = resolve(import.meta.dirname, '..')
    const model = extractPersistenceSchema(root)
    expect(model.roots.filter(root => root.kind === 'event').map(root => root.event).sort())
      .toEqual(collectLogEvents(root).map(event => event.name).sort())
    expect(model.roots.some(root => root.kind === 'header')).toBe(true)
    expect(model.roots.some(root => root.kind === 'envelope')).toBe(true)
    const digests = new Set(model.types.map(type => type.digest))
    for (const root of model.roots) {
      expect(schemaDigest(root.schema)).toBe(root.digest)
      for (let node = 0; node < root.schema.nodes.length; node++) {
        expect(digests.has(schemaDigest(canonicalizeSchema(root.schema.nodes, node)))).toBe(true)
      }
    }
  })
})
