/** The current-catalog cases: label resolution, anchors and structural links. */

import { describe, expect, it } from 'vitest'
import {
  canonicalizeSchema, schemaDigest,
  type PersistenceSchemaInventory, type PersistenceType, type SchemaNode,
} from './persistence-schema-model.ts'
import { renderPersistenceSchemaDefinitions, renderPersistenceSchemaIndex } from './render-persistence-schema.ts'
import { render } from './gen-persistence-catalog.ts'
import { classifyPersistenceChange } from './persistence-changes.ts'
import {
  assertLinkedOnce, currentDefinitions, eventRoot, fixture, producerFixture, recursiveFixture,
} from './render-persistence-schema.fixtures-cases.ts'

describe('current persistence schema anchors', () => {
  it('names shared arrays by their declared elements independent of the first reaching root', () => {
    const nodes: SchemaNode[] = [
      { kind: 'array', element: 1 },
      { kind: 'object', properties: [{ name: 'text', type: 2, optional: false }], indices: [] },
      { kind: 'primitive', type: 'string' },
    ]
    const types = new Map<string, PersistenceType>()
    const root = eventRoot('second/event', nodes, types, index => ({ names: index === 1 ? ['ContextSnapshotSection'] : [], sources: [] }))
    const inventory: PersistenceSchemaInventory = { formatVersion: 1, roots: [root], types: [...types.values()] }
    const rendered = currentDefinitions(inventory)
    expect(rendered).toContain('### `ContextSnapshotSection[]`')
    const withEarlierRoot = { ...inventory, roots: [{ ...root, key: 'event:first/event' }, root] }
    expect(currentDefinitions(withEarlierRoot)).toContain('### `ContextSnapshotSection[]`')
    expect(rendered).not.toContain('### `event:second/event`')
    assertLinkedOnce(currentDefinitions(withEarlierRoot))
  })

  it('shows every kind/form arm, including absent, optional, broad and colliding forms', () => {
    const nodes: SchemaNode[] = [
      { kind: 'union', types: [1, 2, 3, 4, 5] },
      { kind: 'object', properties: [{ name: 'kind', type: 6, optional: false }], indices: [] },
      { kind: 'object', properties: [{ name: 'kind', type: 6, optional: false }, { name: 'form', type: 7, optional: false }, { name: 'summary', type: 8, optional: false }], indices: [] },
      { kind: 'object', properties: [{ name: 'kind', type: 6, optional: false }, { name: 'form', type: 7, optional: false }, { name: 'other', type: 8, optional: false }], indices: [] },
      { kind: 'object', properties: [{ name: 'kind', type: 6, optional: false }, { name: 'form', type: 8, optional: true }], indices: [] },
      { kind: 'object', properties: [{ name: 'kind', type: 6, optional: false }, { name: 'form', type: 9, optional: false }], indices: [{ key: 8, value: 8 }] },
      { kind: 'literal', value: 'hook|"quoted' },
      { kind: 'literal', value: 'notice' },
      { kind: 'primitive', type: 'string' },
      { kind: 'union', types: [7, 10] },
      { kind: 'literal', value: 'snapshot' },
    ]
    const types = new Map<string, PersistenceType>()
    const root = eventRoot('source/event', nodes, types, () => ({ names: [], sources: [] }))
    const inventory: PersistenceSchemaInventory = { formatVersion: 1, roots: [root], types: [...types.values()] }
    const rendered = currentDefinitions(inventory)
    expect(rendered).toContain('| `hook\\|"quoted` | not declared | none |')
    expect(rendered).toContain('| `hook\\|"quoted` | `string` (optional) | none |')
    expect(rendered.match(/\| `hook\\\|"quoted` \|/gu)).toHaveLength(5)
    expect(rendered).toContain('index signature')
    expect(rendered).toContain('other }`')
    expect(rendered).toContain('summary }`')
    assertLinkedOnce(rendered)
    const reordered = { ...inventory, types: [...inventory.types].reverse() }
    expect(currentDefinitions(reordered)).toBe(rendered)
  })

  it('falls back to complete unions for optional or broad kind discriminators', () => {
    for (const optional of [true, false]) {
      const nodes: SchemaNode[] = [
        { kind: 'union', types: [1, 2] },
        { kind: 'object', properties: [{ name: 'kind', type: optional ? 3 : 4, optional }], indices: [] },
        { kind: 'object', properties: [{ name: 'kind', type: 3, optional: false }], indices: [] },
        { kind: 'literal', value: 'example' },
        { kind: 'primitive', type: 'string' },
      ]
      const types = new Map<string, PersistenceType>()
      const root = eventRoot('broad/event', nodes, types, () => ({ names: [], sources: [] }))
      const rendered = currentDefinitions({ formatVersion: 1, roots: [root], types: [...types.values()] })
      expect(rendered).toContain('One of:')
      expect(rendered).not.toContain('| kind | Form property |')
      assertLinkedOnce(rendered)
    }
  })

  it('bounds labels for anonymous recursive arrays', () => {
    const schema = canonicalizeSchema([{ kind: 'array', element: 0 }], 0)
    const digest = schemaDigest(schema)
    const rendered = currentDefinitions({ formatVersion: 1, roots: [], types: [{ schema, digest, names: [], sources: [] }] })
    expect(rendered).toContain('### `array[]`')
    assertLinkedOnce(rendered)
    expect(rendered.length).toBeLessThan(1000)
  })

  it('labels empty objects without padding while preserving structural links and historical labels', () => {
    const nodes: SchemaNode[] = [
      { kind: 'object', properties: [{ name: 'type', type: 1, optional: false }, { name: 'data', type: 2, optional: false }], indices: [] },
      { kind: 'literal', value: 'empty/event' },
      { kind: 'array', element: 3 },
      { kind: 'object', properties: [], indices: [] },
    ]
    const types = new Map<string, PersistenceType>()
    const root = eventRoot('empty/event', nodes, types, () => ({ names: [], sources: [] }))
    const inventory: PersistenceSchemaInventory = { formatVersion: 1, roots: [root], types: [...types.values()] }
    const saved = JSON.stringify(inventory)
    const emptyDigest = schemaDigest(canonicalizeSchema(nodes, 3))
    const current = currentDefinitions(inventory)
    expect(current).toContain('### `{}`')
    expect(current).not.toContain('{  }')
    expect(current).toContain('[`{}`](#persistence-type-sha256-' + emptyDigest + ')')
    assertLinkedOnce(current)
    const historical = renderPersistenceSchemaDefinitions(inventory)
    expect(historical).toContain('### `event:empty/event.data.item`')
    expect(historical).toContain('Array of [`event:empty/event.data.item`](#persistence-type-eventemptyeventdataitem).')
    expect(JSON.stringify(inventory)).toBe(saved)
    expect(schemaDigest(root.schema)).toBe(root.digest)
  })

  it('keeps anonymous producer references when siblings and the first owning root change', () => {
    const before = producerFixture(['alpha', 'beta'], ['second/event'])
    const after = producerFixture(['new', 'beta', 'alpha'], ['first/event', 'second/event'])
    const alphaSchema = canonicalizeSchema([
      { kind: 'object', properties: [{ name: 'kind', type: 1, optional: false }], indices: [] },
      { kind: 'literal', value: 'alpha' },
    ], 0)
    const alphaDigest = schemaDigest(alphaSchema)
    const link = '[`{ kind: "alpha" }`](#persistence-type-sha256-' + alphaDigest + ')'
    expect(currentDefinitions(before)).toContain(link)
    expect(currentDefinitions(after)).toContain(link)
    expect(currentDefinitions(after)).not.toContain('.source[')
    assertLinkedOnce(currentDefinitions(after))
    const reordered = { ...after, roots: [...after.roots].reverse(), types: [...after.types].reverse() }
    expect(currentDefinitions(reordered)).toBe(currentDefinitions(after))
  })

  it('retains logical root and named aliases while structural links track changed content', () => {
    const before = fixture()
    const after = fixture(false)
    const old = currentDefinitions(before)
    const updated = currentDefinitions(after)
    for (const definitions of [old, updated]) {
      expect(definitions).toContain('<a id="persistence-type-errorinfo"></a>')
      expect(definitions).toContain('<a id="persistence-type-eventfirstevent"></a>')
    }
    expect(old).not.toBe(updated)
    const document = render([], [], after)
    expect(document).toContain('](#persistence-type-sha256-' + after.roots[0]!.digest + ')')
    assertLinkedOnce(document)
  })

  it('omits ambiguous aliases and keeps colliding labels linked to distinct definitions', () => {
    const complete = fixture()
    const first = complete.types[0] as PersistenceType
    const second = complete.types[1] as PersistenceType
    const inventory = { ...complete, types: complete.types.map(type => type === first
      ? { ...type, names: ['A.B', 'sha256-' + second.digest] }
      : type === second ? { ...type, names: ['AB'] } : type) }
    const definitions = currentDefinitions(inventory)
    expect(definitions).not.toContain('<a id="persistence-type-ab"></a>')
    expect(definitions).toContain('<a id="persistence-type-sha256-' + first.digest + '"></a>')
    expect(definitions).toContain('<a id="persistence-type-sha256-' + second.digest + '"></a>')
    assertLinkedOnce(definitions)
  })

  it('renders recursion once and leaves inventories, digests and classifications unchanged', () => {
    const inventory = recursiveFixture()
    const { schema, digest } = inventory.roots[0]!
    const saved = JSON.stringify(inventory)
    const before = fixture()
    const after = fixture(false)
    const classification = classifyPersistenceChange(before.roots[0]!, after.roots[0]!)
    const rendered = currentDefinitions(inventory)
    expect(rendered.match(/### `Recursive`/gu)).toHaveLength(1)
    expect(rendered).toContain('[`Recursive`](#persistence-type-sha256-' + digest + ')')
    assertLinkedOnce(rendered)
    currentDefinitions(after)
    expect(JSON.stringify(inventory)).toBe(saved)
    expect(schemaDigest(schema)).toBe(digest)
    expect(classifyPersistenceChange(before.roots[0]!, after.roots[0]!)).toEqual(classification)
  })

  it('shows recorded source policies only in the current catalog and preserves their fields', () => {
    const schema = canonicalizeSchema([
      { kind: 'object', properties: [{ name: 'source', type: 1, optional: false, compatibility: {
        version: 1, policy: 'session-source-attribution', binding: 'session.user-message.source',
        discriminator: 'kind', unknownKinds: 'preserve', attributionKinds: ['build-context'],
      } }], indices: [] },
      { kind: 'object', properties: [{ name: 'kind', type: 2, optional: false }], indices: [] },
      { kind: 'literal', value: 'build-context' },
    ], 0)
    const types = schema.nodes.map((_, index) => {
      const nested = canonicalizeSchema(schema.nodes, index)
      return { digest: schemaDigest(nested), schema: nested, names: [], sources: [] }
    })
    const inventory: PersistenceSchemaInventory = { formatVersion: 2, roots: [], types }
    const saved = JSON.stringify(inventory)
    expect(currentDefinitions(inventory)).toContain('Source compatibility: `source` — `session-source-attribution` v1; `session.user-message.source`; `kind`; `preserve`.')
    expect(currentDefinitions(inventory)).toContain('Attribution-only additions: `build-context`.')
    expect(renderPersistenceSchemaDefinitions(inventory, 'zh', undefined, 2, 'current')).toContain('仅表示归属的新增 kind：`build-context`.')
    expect(renderPersistenceSchemaDefinitions(inventory)).not.toContain('Source compatibility:')
    expect(JSON.stringify(inventory)).toBe(saved)
  })

  it('keeps the captured historical Markdown byte-for-byte in both historical call forms', () => {
    const inventory = recursiveFixture(['packages/core/example/src/types.ts'])
    const expected = [
      '### Persistence type fingerprints', '', 'Frozen reference.', '',
      '| Root | Kind | SHA-256 | Resolved type |', '|---|---|---|---|',
      '| `SessionHeader` | header | `c900da63847d1d27572277817e727f3a471d08f0abaf0b61b4984c32ffc6a332` | [`Recursive`](#persistence-type-recursive) |', '',
      '### Resolved persistence types', '',
      'Each definition appears once. References preserve sharing and recursion; the digest beside a definition includes its complete reachable structure. Source names and locations identify its declarations but are excluded from its digest.', '',
      '<a id="persistence-type-recursive"></a>', '', '#### `Recursive`', '',
      'SHA-256: `c900da63847d1d27572277817e727f3a471d08f0abaf0b61b4984c32ffc6a332`', '',
      'Sources: `packages/core/example/src/types.ts`', '',
      '| Property | Presence | Type |', '|---|---|---|',
      '| `next` | optional | [`Recursive`](#persistence-type-recursive) |', '',
    ].join('\n')
    const index = renderPersistenceSchemaIndex(inventory, 'en', ['Frozen reference.'], 3)
    expect(index + '\n' + renderPersistenceSchemaDefinitions(inventory, 'en', () => undefined, 3)).toBe(expected)
    expect(renderPersistenceSchemaIndex(inventory, 'en', ['Frozen reference.'], 3, 'historical') + '\n'
      + renderPersistenceSchemaDefinitions(inventory, 'en', () => undefined, 3, 'historical')).toBe(expected)
  })
})
