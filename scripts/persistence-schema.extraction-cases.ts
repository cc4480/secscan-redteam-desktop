/** Persistence schema extraction: authored names, canonical ordering, and augmented payload maps. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectLogEvents } from './gen-persistence-catalog.ts'
import { extractPersistenceSchema } from './persistence-schema.ts'
import { parsePersistenceSnapshot } from './persistence-changes.ts'
import { event, fixture, put } from './persistence-schema.spec-helpers.ts'

describe('persistent source type extraction', () => {
  it('keeps authored names and anonymous declaration locations without synthesized traversal names', () => {
    const root = fixture('interface Section { text: string }\nexport interface Payload { inserted: { source: { kind: "hooks-codex"; sections: Section[] } }[] }')
    const inventory = extractPersistenceSchema(root)
    expect(inventory.types.flatMap(type => type.names).every(name => name.includes('#'))).toBe(true)
    expect(inventory.types.some(type => type.names.includes('packages/domain/payload/src/types.ts#Section'))).toBe(true)
    expect(inventory.types.some(type => type.names.length === 0 && type.sources.includes('packages/domain/payload/src/types.ts:2'))).toBe(true)
    expect(inventory.types.some(type => type.schema.nodes[0]?.kind === 'array' && type.names.length === 0)).toBe(true)
    expect(parsePersistenceSnapshot(inventory)).toEqual(inventory)
  })

  it('ignores alias names, files, documentation, readonly, brands and property order', () => {
    const left = fixture('declare const brand: unique symbol; type Id = string & {readonly [brand]: "Id"}; export interface Payload { readonly id: Id; value?: number }')
    const right = fixture('type Renamed = string; /** Different documentation. */ export type Payload = {value?: number; id: Renamed}')
    expect(event(extractPersistenceSchema(left))).toBe(event(extractPersistenceSchema(right)))
  })

  it.each([
    ['nested field order',
      'export interface Payload {\n  id: string\n  detail: {\n    label: string\n    count?: number\n  }\n}',
      'export interface Payload {\n  detail: {\n    count?: number\n    label: string\n  }\n  id: string\n}'],
    ['anonymous union order',
      'export type Payload =\n  { a: string }\n  | { b: number }\n  | { c?: boolean }',
      'export type Payload =\n  { c?: boolean }\n  | { b: number }\n  | { a: string }'],
    ['recursive union order',
      'export type Payload =\n  { a: string; next?: Payload }\n  | { b: number; next?: Payload }\n  | null',
      'export type Payload =\n  null\n  | { next?: Payload; b: number }\n  | { next?: Payload; a: string }'],
    ['intersection and distributed union order',
      'type A = { a: string } | { b: number }; type B = { c: boolean }; export type Payload = A & B',
      'type A = { b: number } | { a: string }; type B = { c: boolean }; export type Payload = B & A'],
    ['index signature order',
      'export interface Payload { [key: string]: string | number; [key: number]: number }',
      'export interface Payload { [key: number]: number; [key: string]: number | string }'],
    ['type declaration order',
      'interface A { a: string }\ninterface B { b: number }\nexport type Payload = A | B',
      'interface B { b: number }\ninterface A { a: string }\nexport type Payload = B | A'],
    ['merged declaration order',
      'export interface Payload { a: string }\nexport interface Payload { b: number }',
      'export interface Payload { b: number }\nexport interface Payload { a: string }'],
    ['mapped key order',
      'export type Payload = { [K in "a" | "b" | "c"]: string }',
      'export type Payload = { [K in "c" | "b" | "a"]: string }'],
    ['explicit enum member order',
      'enum Value {\n  A = "a",\n  B = "b",\n}\nexport interface Payload { value: Value }',
      'enum Value {\n  B = "b",\n  A = "a",\n}\nexport interface Payload { value: Value }'],
  ])('keeps every root and type digest unchanged by %s', (_name, before, after) => {
    const root = fixture(before)
    const inventory = extractPersistenceSchema(root)
    put(root, 'packages/domain/payload/src/types.ts', after)
    const reordered = extractPersistenceSchema(root)
    expect(reordered.roots).toEqual(inventory.roots)
    expect(reordered.types.map(({ digest, schema }) => ({ digest, schema })))
      .toEqual(inventory.types.map(({ digest, schema }) => ({ digest, schema })))
  })

  it.each([
    ['tuple positions', 'export type Payload = [string, number]', 'export type Payload = [number, string]'],
    ['implicit enum values', 'enum Value { A, B }; export interface Payload { value: Value.A }', 'enum Value { B, A }; export interface Payload { value: Value.A }'],
  ])('changes the digest when reordering changes %s', (_name, before, after) => {
    const root = fixture(before)
    const digest = event(extractPersistenceSchema(root))
    put(root, 'packages/domain/payload/src/types.ts', after)
    expect(event(extractPersistenceSchema(root))).not.toBe(digest)
  })

  it('keeps header, envelope and event digests unchanged when root declarations are reordered', () => {
    const record = "  /** One recorded payload. */\n  'test/record': Payload"
    const other = "/** Another recorded payload. */\n  'test/other': { value: number }"
    const root = fixture('export interface Payload { id: string }', {
      surface: "'test/record' | 'test/other'",
      event: other,
    })
    const inventory = extractPersistenceSchema(root)
    const source = readFileSync(join(root, 'packages/core/session/src/types.ts'), 'utf8')
    const reordered = source
      .replace(`${record}\n  ${other}`, `  ${other}\n${record}`)
      .replace('version: 3; id: string; createdAt: number', 'createdAt: number; id: string; version: 3')
      .replace("'test/record' | 'test/other'", "'test/other' | 'test/record'")
      .replace('type: K; seq: number; time: number; data: SessionEventMap[K]', 'data: SessionEventMap[K]; time: number; seq: number; type: K')
    expect(reordered.indexOf("'test/other':")).toBeLessThan(reordered.indexOf("'test/record':"))
    put(root, 'packages/core/session/src/types.ts', reordered)
    put(root, 'packages/session/session-persistence-jsonl/src/format.ts', "interface HeaderLine {delegationDepth: number; id: string; version: number; type: 'session'}\nexport {}\n")
    const result = extractPersistenceSchema(root)
    expect(result.roots).toEqual(inventory.roots)
    expect(result.types.map(({ digest, schema }) => ({ digest, schema })))
      .toEqual(inventory.types.map(({ digest, schema }) => ({ digest, schema })))
  })

  it('materializes generic, conditional and mapped aliases into their concrete properties', () => {
    const generic = fixture('type Box<T> = { [K in keyof T]: T[K] extends string ? string[] : T[K] }; export type Payload = Box<{label: string; count?: number}>')
    const concrete = fixture('export interface Payload {count?: number; label: string[]}')
    expect(event(extractPersistenceSchema(generic))).toBe(event(extractPersistenceSchema(concrete)))
  })

  it('retains transitive recursion without depending on alias factoring', () => {
    const self = fixture('export interface Payload { value: string; next?: Payload }')
    const mutual = fixture('interface Other {next?: Payload; value: string} export interface Payload {value: string; next?: Other}')
    const changed = fixture('interface Other {next?: Payload; value: number} export interface Payload {value: string; next?: Other}')
    const digest = event(extractPersistenceSchema(self))
    expect(event(extractPersistenceSchema(mutual))).toBe(digest)
    expect(event(extractPersistenceSchema(changed))).not.toBe(digest)
  })

  it('includes independent Host modules that augment nested payload maps without event declarations', () => {
    const root = fixture('export interface NestedMap {first: {value: string}}; export type Payload = NestedMap[keyof NestedMap]')
    const before = extractPersistenceSchema(root)
    put(root, 'packages/domain/extension/src/index.ts', "import '@fixture/payload'; declare module '@fixture/payload' {interface NestedMap {second: {value: number}}}")
    const after = extractPersistenceSchema(root)
    expect(collectLogEvents(root)).toHaveLength(1)
    expect(event(after)).not.toBe(event(before))
    const data = after.types.find(item => item.schema.nodes[0]?.kind === 'union' && item.schema.nodes.some(node => node.kind === 'primitive' && node.type === 'number'))
    expect(data).toBeDefined()
  })

  it('discovers plugin event merges and keeps ordinary event additions out of the envelope digest', () => {
    const root = fixture('export interface Payload {id: string}')
    const before = extractPersistenceSchema(root)
    put(root, 'packages/domain/extension/src/index.ts', `import '@deepseek-ai/dsh-session/types'; declare module '@deepseek-ai/dsh-session/types' {
interface SessionEventMap {
/** A plugin event. */
'plugin/new': { optional?: boolean }
}}
`)
    const after = extractPersistenceSchema(root)
    expect(after.roots.some(root => root.event === 'plugin/new')).toBe(true)
    expect(after.roots.find(root => root.kind === 'envelope')?.digest).toBe(before.roots.find(root => root.kind === 'envelope')?.digest)
    expect(event(after)).toBe(event(before))
  })
})
