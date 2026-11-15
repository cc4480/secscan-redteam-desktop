/** Public catalog renderers producing the fingerprints index and the linked definitions. */

import { persistenceCatalogText, type PersistenceCatalogLocale } from './persistence-catalog-text.ts'
import type { PersistenceSchemaInventory } from './persistence-schema-model.ts'
import { definition, reference } from './render-persistence-schema-definitions.ts'
import { displays, type PersistenceSchemaRendering } from './render-persistence-schema-displays.ts'
import { code } from './render-persistence-schema-nodes.ts'

/**
 * Render every tracked root with its exact digest and resolved type reference.
 * @param inventory - complete current-source schemas and declaration metadata.
 * @param locale - generated document language.
 * @param introduction - paragraphs before the root table; defaults to current-source links.
 * @param headingLevel - section depth within the containing reference.
 * @param rendering - explicit current mode selects structural links; omission preserves historical output.
 * @returns Markdown index including the history and contributor workflow links.
 */
export function renderPersistenceSchemaIndex(
  inventory: PersistenceSchemaInventory,
  locale: PersistenceCatalogLocale = 'en',
  introduction: readonly string[] = [persistenceCatalogText[locale].fingerprintsIntro, persistenceCatalogText[locale].historyIntro],
  headingLevel: 2 | 3 = 2,
  rendering: PersistenceSchemaRendering = 'historical',
): string {
  const entries = displays(inventory, rendering)
  const text = persistenceCatalogText[locale]
  return [
    `${'#'.repeat(headingLevel)} ${text.fingerprints}`, '', ...introduction.flatMap(paragraph => [paragraph, '']),
    text.rootColumns, '|---|---|---|---|',
    ...inventory.roots.map(root => `| ${code(root.key)} | ${root.kind} | ${code(root.digest)} | ${reference(root.digest, entries)} |`), '',
  ].join('\n')
}

/**
 * Render every reachable type once, with links for shared and recursive definitions.
 * @param inventory - complete current-source schemas and declaration metadata.
 * @param locale - generated document language.
 * @param sourceLink - source path to URL; undefined keeps historical locations as text.
 * @param headingLevel - section depth; individual definitions use the next heading level.
 * @param rendering - explicit current mode selects structural links and unambiguous logical aliases.
 * @returns linked Markdown definitions; historical mode preserves the original named and owning-path anchors.
 */
export function renderPersistenceSchemaDefinitions(
  inventory: PersistenceSchemaInventory,
  locale: PersistenceCatalogLocale = 'en',
  sourceLink: (source: string) => string | undefined = source => `../${source}`,
  headingLevel: 2 | 3 = 2,
  rendering: PersistenceSchemaRendering = 'historical',
): string {
  const entries = displays(inventory, rendering)
  const text = persistenceCatalogText[locale]
  const sorted = [...entries.values()].sort((left, right) => {
    if (rendering === 'current' && left.label !== right.label) return left.label < right.label ? -1 : 1
    return left.anchor < right.anchor ? -1 : left.anchor > right.anchor ? 1 : 0
  })
  return [
    `${'#'.repeat(headingLevel)} ${text.definitions}`, '', text.definitionsIntro, '',
    ...sorted.flatMap(entry => definition(entry, entries, locale, sourceLink, headingLevel + 1, rendering)),
  ].join('\n')
}
