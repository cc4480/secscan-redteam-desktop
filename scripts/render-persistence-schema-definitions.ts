/** One linked Markdown definition per reachable persistence type. */

import { persistenceCatalogText, type PersistenceCatalogLocale } from './persistence-catalog-text.ts'
import { sourceKindGroups } from './persistence-source-policy.ts'
import { canonicalizeSchema, schemaDigest, type CanonicalSchema } from './persistence-schema-model.ts'
import type { PersistenceSchemaRendering, TypeDisplay } from './render-persistence-schema-displays.ts'
import { assertNever, code, nodeAt, sourcePath } from './render-persistence-schema-nodes.ts'

/**
 * Link one type digest to its definition.
 * @param digest - schema digest of the referenced type.
 * @param entries - displays resolved for the rendering mode.
 * @returns the inline Markdown link.
 */
export function reference(digest: string, entries: ReadonlyMap<string, TypeDisplay>): string {
  const entry = entries.get(digest)
  if (!entry) throw new Error(`persistence catalog: reachable type ${digest} is absent from the inventory`)
  return `[${code(entry.label)}](#${entry.anchor})`
}

/**
 * Render one inline type expression, linking shared and recursive definitions.
 * @param schema - canonical schema owning the node.
 * @param index - node number to express.
 * @param entries - displays resolved for the rendering mode.
 * @param locale - generated document language.
 * @returns the inline expression.
 */
export function typeExpression(
  schema: CanonicalSchema,
  index: number,
  entries: ReadonlyMap<string, TypeDisplay>,
  locale: PersistenceCatalogLocale,
): string {
  const node = nodeAt(schema, index)
  if (node.kind === 'primitive') return code(node.type)
  if (node.kind === 'literal') return code(JSON.stringify(node.value))
  if (node.kind === 'opaque') return `${code(node.reason)}${persistenceCatalogText[locale].opaque}`
  return reference(schemaDigest(canonicalizeSchema(schema.nodes, index)), entries)
}

/**
 * Render the definition block for one type.
 * @param entry - the type being defined.
 * @param entries - displays resolved for the rendering mode.
 * @param locale - generated document language.
 * @param sourceLink - source path to URL; undefined keeps historical locations as text.
 * @param headingLevel - heading depth of this definition.
 * @param rendering - explicit mode; current adds source compatibility and kind groups.
 * @returns Markdown lines for the definition.
 */
export function definition(
  entry: TypeDisplay,
  entries: ReadonlyMap<string, TypeDisplay>,
  locale: PersistenceCatalogLocale,
  sourceLink: (source: string) => string | undefined,
  headingLevel: number,
  rendering: PersistenceSchemaRendering,
): string[] {
  const text = persistenceCatalogText[locale]
  const schema = entry.type.schema
  const node = nodeAt(schema, 0)
  const lines = [...[entry.anchor, ...entry.aliases].flatMap(anchor => [`<a id="${anchor}"></a>`, '']), `${'#'.repeat(headingLevel)} ${code(entry.label)}`, '', `SHA-256: ${code(entry.type.digest)}`, '']
  if (entry.type.sources.length > 0) {
    lines.push(`${text.sources}${entry.type.sources.map((source) => {
      const href = sourceLink(sourcePath(source))
      return href === undefined ? code(source) : `[${code(source)}](${href})`
    }).join(' · ')}`, '')
  }
  const expression = (index: number): string => typeExpression(schema, index, entries, locale)
  switch (node.kind) {
    case 'object':
      if (node.properties.length === 0 && node.indices.length === 0) lines.push(text.emptyObject, '')
      else {
        lines.push(text.propertyColumns, '|---|---|---|')
        for (const property of node.properties) {
          lines.push(`| ${code(property.name)} | ${property.optional ? text.optional : text.required} | ${expression(property.type)} |`)
        }
        for (const index of node.indices) lines.push(`| [${expression(index.key)}] | ${text.index} | ${expression(index.value)} |`)
        lines.push('')
        if (rendering === 'current') {
          for (const property of node.properties) {
            const policy = property.compatibility
            if (policy === undefined) continue
            lines.push(`${text.sourceCompatibility}${code(property.name)} — ${code(policy.policy)} v${String(policy.version)}; ${code(policy.binding)}; ${code(policy.discriminator)}; ${code(policy.unknownKinds)}.`, '',
              `${text.attributionAdditions}${policy.attributionKinds.map(code).join(', ') || code('[]')}.`, '')
          }
        }
      }
      break
    case 'array': lines.push(`${text.arrayPrefix}${expression(node.element)}${text.arraySuffix}`, ''); break
    case 'tuple':
      lines.push(text.positionColumns, '|---|---|---|')
      node.elements.forEach((element, index) => {
        const presence = element.rest ? text.rest : element.optional ? text.optional : text.required
        lines.push(`| ${String(index)} | ${presence} | ${expression(element.type)} |`)
      })
      lines.push('')
      break
    case 'union': {
      const groups = rendering === 'current' ? sourceKindGroups(schema.nodes, 0) : undefined
      if (groups !== undefined) {
        lines.push(text.sourceColumns, '|---|---|---|---|')
        for (const [kind, alternatives] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
          const rows = alternatives.map((index) => {
            const variant = nodeAt(schema, index)
            if (variant.kind !== 'object') throw new Error('persistence catalog: source group must contain objects')
            const form = variant.properties.find(property => property.name === 'form')
            const formLabel = form === undefined ? text.notDeclared
              : `${expression(form.type)}${form.optional ? ` (${text.optional})` : ''}`
            const fields = variant.properties.filter(property => property.name !== 'kind' && property.name !== 'form' && !property.optional)
              .map(property => `${code(property.name)}: ${expression(property.type)}`)
            if (variant.indices.length > 0) fields.push(text.index)
            return { index, formLabel, fields, digest: schemaDigest(canonicalizeSchema(schema.nodes, index)) }
          }).sort((a, b) => a.formLabel.localeCompare(b.formLabel) || a.digest.localeCompare(b.digest))
          for (const row of rows) lines.push(`| ${code(kind)} | ${row.formLabel} | ${row.fields.join('; ') || text.none} | ${expression(row.index)} |`)
        }
        lines.push('')
      } else lines.push(text.oneOf, '', ...node.types.map(index => `- ${expression(index)}`), '')
      break
    }
    case 'primitive': lines.push(code(node.type), ''); break
    case 'literal': lines.push(code(JSON.stringify(node.value)), ''); break
    case 'opaque': lines.push(`${code(node.reason)}${text.opaqueExplanation}`, ''); break
    default: assertNever(node)
  }
  return lines
}
