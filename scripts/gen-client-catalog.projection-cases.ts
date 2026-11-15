/** The projection facts a registrant depends on: occupants, replace risk, owner props, examples. */

import { describe, expect, it } from 'vitest'
import { resolveSlotEntries } from './gen-client-catalog.ts'
import { declaration, registration, OWNER_TYPES } from './gen-client-catalog.fixtures-cases.ts'

describe('client slot projection', () => {
  const kits = new Map<string, readonly string[]>([['root', ['useSessions: Hook']]])

  it('warns that a single seat with a shipped occupant is replaced, not shared', () => {
    const [entry] = resolveSlotEntries([declaration()], [registration()], OWNER_TYPES, kits)
    expect(entry?.replaceRisk).toBe('shadows-shipped-ui')
    expect(entry?.occupants).toEqual(['client-demo DemoSeat'])
  })

  it('treats a list seat as additive even when shipped entries exist', () => {
    const [entry] = resolveSlotEntries(
      [declaration({ kind: 'list' })],
      [registration({ id: 'shipped' })],
      OWNER_TYPES,
      kits,
    )
    expect(entry?.replaceRisk).toBe('none')
    expect(entry?.occupants).toEqual(["client-demo DemoSeat id 'shipped'"])
    expect(entry?.registerOptions.map(option => option.name)).toEqual(['id', 'order', 'label'])
  })

  it('names the entry whose mount makes a child seat exist', () => {
    const parent = registration({ key: 'demo.parent', children: ['demo.seat'] })
    const entries = resolveSlotEntries(
      [declaration(), declaration({ key: 'demo.parent' })],
      [parent],
      OWNER_TYPES,
      kits,
    )
    expect(entries.find(entry => entry.key === 'demo.seat')?.declaredBy)
      .toContain("an entry in 'demo.parent' (client-demo)")
    expect(entries.find(entry => entry.key === 'demo.parent')?.declaredBy)
      .toContain('built in')
  })

  it('names the Factory definition that declares an ordinary child seat', () => {
    const factory = registration({ key: 'demo.factory', children: ['demo.seat'], factory: true })
    const [entry] = resolveSlotEntries([declaration()], [factory], OWNER_TYPES, kits)
    expect(entry?.declaredBy)
      .toContain("factory 'demo.factory' (client-demo)")
    expect(entry?.occupants).toEqual([])
  })

  it('reports an open keyed domain and the keys already taken', () => {
    const [entry] = resolveSlotEntries(
      [declaration({ kind: 'keyed' })],
      [registration({ entryKey: 'bash' }), registration({ entryKey: 'read' })],
      OWNER_TYPES,
      kits,
    )
    expect(entry?.keyDomain).toContain('open: any string')
    expect(entry?.keyDomain).toContain('already taken: bash, read')
  })

  it('carries owner-props documentation into the entry, not just the type name', () => {
    const [entry] = resolveSlotEntries([declaration({ ownerType: 'DemoOwnerProps' })], [], OWNER_TYPES, kits)
    expect(entry?.ownerProps.join('\n')).toContain('Column width.')
  })

  it('expands owner props one level and only names the shapes they reference', () => {
    // Transitive expansion once dragged the whole session model into four
    // seats; a registrant needs the fields, not the graph behind them.
    const types = new Map(OWNER_TYPES)
    types.set('Zone', {
      name: 'Zone',
      text: 'export interface Zone {\n  session: BigSnapshot\n}',
      source: 'packages/client/demo/src/client/contract/slots.ts:30',
    })
    types.set('BigSnapshot', {
      name: 'BigSnapshot',
      text: 'export interface BigSnapshot {\n  turns: number\n}',
      source: 'packages/client/demo/src/client/snapshot.ts:1',
    })
    const [entry] = resolveSlotEntries([declaration({ ownerType: 'Zone' })], [], types, kits)
    expect(entry?.ownerProps.join('\n')).toContain('export interface Zone')
    expect(entry?.ownerProps.join('\n')).not.toContain('export interface BigSnapshot')
    expect(entry?.ownerPropsReferences).toEqual(['BigSnapshot'])
  })

  it('offers a runnable registration whose options match the cardinality', () => {
    const [entry] = resolveSlotEntries([declaration({ kind: 'list' })], [], OWNER_TYPES, kits)
    expect(entry?.example).toContain("ctx.slots.inject('demo.seat'")
    expect(entry?.example).toContain("id: 'my-entry'")
  })

  it('expands composed owner aliases without expanding their field value types', () => {
    const types = new Map(OWNER_TYPES)
    for (const [name, text] of [
      ['Phase', "export type Phase = { phase: 'preparing'; block: BigSnapshot } | { phase: 'start'; block: BigSnapshot }"],
      ['Owner', 'export type Owner = DemoOwnerProps & (Phase | Alias)'],
      ['Alias', 'export type Alias = Owner'],
      ['BigSnapshot', 'export interface BigSnapshot { history: string[] }'],
    ] as const) types.set(name, { name, text, source: 'owner.ts:1' })
    const [entry] = resolveSlotEntries([declaration({ ownerType: 'Owner' })], [], types, kits)
    expect(entry?.ownerProps).toHaveLength(4)
    expect(entry?.ownerProps.join('\n')).toContain('width: number')
    expect(entry?.ownerProps.join('\n')).toContain("phase: 'preparing'")
    expect(entry?.ownerProps.join('\n')).not.toContain('history: string[]')
    expect(entry?.ownerPropsReferences).toEqual(['BigSnapshot'])
  })

  it('keeps generic owner arguments as references instead of expanding unselected fields', () => {
    const types = new Map(OWNER_TYPES)
    types.set('Owner', { name: 'Owner', text: "export type Owner = Pick<DemoOwnerProps, 'width'>", source: 'owner.ts:1' })
    const [entry] = resolveSlotEntries([declaration({ ownerType: 'Owner' })], [], types, kits)
    expect(entry?.ownerProps).toHaveLength(1)
    expect(entry?.ownerPropsReferences).toEqual(['DemoOwnerProps'])
  })

  it('uses an authored example when a slot interaction needs more than generic markup', () => {
    const [entry] = resolveSlotEntries([
      declaration({ jsDoc: '/** A seat.\n * @example\n * return { custom: true }\n */' }),
    ], [], OWNER_TYPES, kits)
    expect(entry?.example).toBe('return { custom: true }')
  })
})
