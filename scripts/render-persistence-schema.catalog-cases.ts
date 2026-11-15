/** The historical-catalog cases: transitive changes and shared definitions. */

import { describe, expect, it } from 'vitest'
import { canonicalizeSchema, schemaDigest, type PersistenceSchemaInventory } from './persistence-schema-model.ts'
import { renderPersistenceSchemaDefinitions, renderPersistenceSchemaIndex } from './render-persistence-schema.ts'
import { fixture, recursiveFixture } from './render-persistence-schema.fixtures-cases.ts'

describe('persistence schema catalog', () => {
  it('shows a shared nested definition once and updates both affected root fingerprints', () => {
    const before = fixture()
    const after = fixture(false)
    const definitions = renderPersistenceSchemaDefinitions(after)
    expect(definitions.match(/### `ErrorInfo`/gu)).toHaveLength(1)
    expect(definitions).toContain('| `reason` | required | `string` |')
    expect(definitions).toContain('[`ErrorInfo`](#persistence-type-errorinfo)')
    const index = renderPersistenceSchemaIndex(after)
    for (const [position, root] of after.roots.entries()) {
      expect(root.digest).not.toBe(before.roots[position]?.digest)
      expect(index).toContain(root.digest)
    }
  })

  it('keeps named definition anchors when their digest changes', () => {
    const before = renderPersistenceSchemaDefinitions(fixture())
    const after = renderPersistenceSchemaDefinitions(fixture(false))
    expect(before).toContain('<a id="persistence-type-errorinfo"></a>')
    expect(after).toContain('<a id="persistence-type-errorinfo"></a>')
    expect(before).not.toBe(after)
  })

  it('renders historical source paths and nested headings within their reference section', () => {
    const current = fixture()
    const inventory = { ...current, types: current.types.map(type => ({ ...type, sources: type.sources.map(source => source.replace(/:\d+$/u, '')) })) }
    const definitions = renderPersistenceSchemaDefinitions(inventory, 'en', () => undefined, 3)
    expect(definitions).toContain('Sources: `packages/core/example/src/types.ts`')
    expect(definitions).not.toContain('types.ts:8')
    expect(definitions).not.toContain('(../packages/')
    expect(definitions).toContain('### Resolved persistence types')
    expect(definitions).toContain('#### `ErrorInfo`')
    const index = renderPersistenceSchemaIndex(inventory, 'en', ['[Historical schema](v0.schema.json)'], 3)
    expect(index).toContain('[Historical schema](v0.schema.json)')
    expect(index).toContain('### Persistence type fingerprints')
    expect(index).not.toContain('(persistence-schema.json)')
    expect(renderPersistenceSchemaDefinitions(current)).toContain('[`packages/core/example/src/types.ts:8`](../packages/core/example/src/types.ts)')
  })

  it('refuses a current inventory that omits a referenced definition', () => {
    const complete = fixture()
    const missing: PersistenceSchemaInventory = { ...complete, types: [] }
    expect(() => renderPersistenceSchemaIndex(missing)).toThrow(/absent from the inventory/u)
  })

  it('renders a recursive definition through a finite self-reference', () => {
    const inventory = recursiveFixture()
    expect(renderPersistenceSchemaDefinitions(inventory)).toContain('| `next` | optional | [`Recursive`](#persistence-type-recursive) |')
  })

  it('uses intrinsic scalar labels even when an alias or reference supplied a name', () => {
    const schema = canonicalizeSchema([{ kind: 'primitive', type: 'string' }], 0)
    const digest = schemaDigest(schema)
    const inventory: PersistenceSchemaInventory = {
      formatVersion: 1,
      roots: [],
      types: [{ digest, schema, names: ['SessionHeader.agentPreset'], sources: [] }],
    }
    const rendered = renderPersistenceSchemaDefinitions(inventory)
    expect(rendered).toContain('### `string`')
    expect(rendered).not.toContain('### `SessionHeader.agentPreset`')
  })
})
