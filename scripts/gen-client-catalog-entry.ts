/**
 * One slot declaration projected into the catalog entry a model reads: the
 * register options its cardinality accepts, the owner share's declarations and
 * the shapes they only reference, who already occupies the seat, what replacing
 * it costs, and a runnable registration example.
 */

import ts from 'typescript'
import { KIND_EXAMPLE, MAX_DECL_CHARS, REGISTER_OPTIONS } from './gen-client-catalog-contract.ts'
import type { KINDS, SlotEntry } from './gen-client-catalog-contract.ts'
import { blockTag, docProse, firstSentence } from './gen-client-catalog-prose.ts'
import { declaredTypes, referencedTypeNames } from './slot-walk.ts'
import type { SlotDeclaration, SlotRegistration, TypeDeclaration } from './slot-walk.ts'

/** Resolve one declaration into its catalog entry. */
export function entryOf(
  declaration: SlotDeclaration,
  registrations: readonly SlotRegistration[],
  declaredBy: SlotRegistration | undefined,
  types: ReadonlyMap<string, TypeDeclaration>,
  kits: ReadonlyMap<string, readonly string[]>,
): SlotEntry {
  const occupants = registrations.filter(registration =>
    registration.factory !== true && registration.key === declaration.key)
  const cellOccupied = occupants.some(occupant =>
    declaration.kind === 'single' || occupant.entryKey !== undefined)
  const doc = docProse(declaration.jsDoc)
  const owner = ownerShapes(declaration.ownerType, types)
  return {
    key: declaration.key,
    kind: declaration.kind,
    scope: declaration.scope,
    summary: firstSentence(doc),
    doc,
    registerOptions: REGISTER_OPTIONS[declaration.kind as (typeof KINDS)[number]],
    ownerProps: owner.declarations.map(type => truncate(type.text)),
    ownerPropsReferences: owner.references,
    standardProps: kits.get(declaration.scope) ?? [],
    keyDomain: keyDomainOf(declaration, occupants),
    hookContext: declaration.hookContext ?? '',
    slotInject: declaration.injectType ?? '',
    declaredBy: declaredBy === undefined
      ? 'the runtime itself (built in; always present)'
      : declaredBy.factory === true
        ? `factory '${declaredBy.key}' (${shortPackage(declaredBy.package)}), so it exists while that definition is registered`
        : `an entry in '${declaredBy.key}' (${shortPackage(declaredBy.package)}), so it exists while that entry is mounted`,
    occupants: occupants.map(occupant => [
      shortPackage(occupant.package),
      occupant.component,
      ...occupant.id === undefined ? [] : [`id '${occupant.id}'`],
      ...occupant.entryKey === undefined ? [] : [`key '${occupant.entryKey}'`],
    ].join(' ')),
    replaceRisk: cellOccupied && (declaration.kind === 'single' || declaration.kind === 'keyed')
      ? 'shadows-shipped-ui'
      : 'none',
    example: exampleOf(declaration),
    source: declaration.source,
  }
}

/**
 * Owner declarations include the aliases that compose their top-level fields.
 * Field value types remain references so one slot does not expand the Session graph.
 */
function ownerShapes(
  ownerType: string | undefined,
  types: ReadonlyMap<string, TypeDeclaration>,
): { declarations: TypeDeclaration[]; references: string[] } {
  if (ownerType === undefined) return { declarations: [], references: [] }
  const own = new Map(declaredTypes(referencedTypeNames([ownerType], types), types)
    .map(declaration => [declaration.name, declaration]))
  for (const declaration of own.values()) {
    const source = ts.createSourceFile(declaration.source, declaration.text, ts.ScriptTarget.Latest, true)
    const alias = source.statements.find(ts.isTypeAliasDeclaration)
    if (alias === undefined) continue
    for (const composed of declaredTypes(ownerCompositionNames(alias.type), types)) {
      own.set(composed.name, composed)
    }
  }
  const declarations = [...own.values()].sort((left, right) => left.name.localeCompare(right.name))
  const references = referencedTypeNames(declarations.map(declaration => declaration.text), types)
    .filter(name => !own.has(name))
  return { declarations, references }
}

/** Top-level composition excludes nested field values and generic arguments. */
function ownerCompositionNames(type: ts.TypeNode): string[] {
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) return type.types.flatMap(ownerCompositionNames)
  if (ts.isParenthesizedTypeNode(type)) return ownerCompositionNames(type.type)
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeArguments === undefined) {
    return [type.typeName.text]
  }
  return []
}

/** How a keyed slot's key domain is constrained, '' for the other kinds. */
function keyDomainOf(declaration: SlotDeclaration, occupants: readonly SlotRegistration[]): string {
  if (declaration.kind !== 'keyed') return ''
  const taken = [...new Set(occupants.flatMap(occupant => occupant.entryKey === undefined ? [] : [occupant.entryKey]))].sort()
  const shipped = taken.length === 0 ? 'none are taken yet' : `already taken: ${taken.join(', ')}`
  return declaration.keyProps === undefined
    ? `open: any string the owner dispatches (no compile-time key set), ${shipped}`
    : `fixed by the owner's key table ${declaration.keyProps}, ${shipped}`
}

/** A runnable minimal registration for one slot, per cardinality. */
function exampleOf(declaration: SlotDeclaration): string {
  const authored = blockTag(declaration.jsDoc, 'example')
  if (authored !== undefined) return authored
  const options = [`name: '${declaration.key}'`, ...KIND_EXAMPLE[declaration.kind] ?? []].join(', ')
  return [
    'return {',
    "  inject: ['slots'],",
    '  apply(ctx) {',
    `    ctx.slots.inject('${declaration.key}', () => ctx.slots.register(`,
    `      { ${options} },`,
    "      () => React.createElement('div', null, 'hello'),",
    '    ))',
    '  },',
    '}',
  ].join('\n')
}

/** Drop the `@deepseek-ai/dsh-` prefix so rows stay readable. */
function shortPackage(name: string): string {
  return name.replace('@deepseek-ai/dsh-', '')
}

/** Truncate an over-long declaration, naming the truncation. */
function truncate(text: string): string {
  return text.length > MAX_DECL_CHARS
    ? `${text.slice(0, MAX_DECL_CHARS)} /* …truncated — full shape in source */`
    : text
}
