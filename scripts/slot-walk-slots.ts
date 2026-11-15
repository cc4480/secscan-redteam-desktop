/**
 * Reading the declaration side of the surface: every `SlotMap` member a
 * `declare module '@deepseek-ai/dsh-client-ui-slots'` block declares, and the
 * standard-kit interfaces whose members a slot component receives for free.
 */

import ts from 'typescript'
import { collapse, jsDocOf, lineOf, memberName } from './slot-walk-text.ts'
import type { ScannedFile, SlotDeclaration } from './slot-walk-types.ts'

/** The module whose `SlotMap` / standard-kit interfaces every slot owner merges into. */
const SLOTS_MODULE = '@deepseek-ai/dsh-client-ui-slots'

/**
 * Read every `SlotMap` member declared in one scanned file.
 * @param file - a file returned by {@link scanSlotFiles}.
 * @returns the declared slots, in source order.
 */
export function slotDeclarations(file: ScannedFile): SlotDeclaration[] {
  const out: SlotDeclaration[] = []
  for (const body of slotModuleBodies(file.sf)) {
    for (const statement of body.statements) {
      if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== 'SlotMap') continue
      for (const member of statement.members) {
        if (!ts.isPropertySignature(member) || member.type === undefined) continue
        const key = ts.isStringLiteral(member.name) || ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText(file.sf)
        const entry = ts.isTypeLiteralNode(member.type) ? member.type : undefined
        const ownerType = memberTypeText(entry, 'owner', file.sf)
        const keyProps = memberTypeText(entry, 'keyProps', file.sf)
        const hookContext = memberTypeText(entry, 'hookContext', file.sf)
        const injectType = memberTypeText(entry, 'inject', file.sf)
        out.push({
          key,
          kind: literalMember(entry, 'kind'),
          scope: literalMember(entry, 'scope'),
          ...ownerType === undefined ? {} : { ownerType },
          ...keyProps === undefined ? {} : { keyProps },
          ...hookContext === undefined ? {} : { hookContext },
          ...injectType === undefined ? {} : { injectType },
          jsDoc: jsDocOf(member, file.sf),
          package: file.package,
          source: `${file.rel}:${String(lineOf(file.sf, member))}`,
        })
      }
    }
  }
  return out
}

/**
 * Read one standard-kit interface's members from the scanned files: the props
 * a slot component receives for free from the framework at a given scope.
 * @param files - scanned files to search.
 * @param interfaceName - `GlobalStandardProps`, `SessionStandardProps`, or `SessionMaybeStandardProps`.
 * @returns `member: type` texts in declaration order, merged across declaring files.
 */
export function standardKitMembers(files: readonly ScannedFile[], interfaceName: string): string[] {
  const out: string[] = []
  for (const file of files) {
    for (const body of slotModuleBodies(file.sf)) {
      for (const statement of body.statements) {
        if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== interfaceName) continue
        for (const member of statement.members) {
          if (!ts.isPropertySignature(member)) continue
          const type = member.type === undefined ? 'unknown' : member.type.getText(file.sf)
          out.push(`${member.name.getText(file.sf)}${member.questionToken === undefined ? '' : '?'}: ${collapse(type)}`)
        }
      }
    }
  }
  return out
}

/** Every slot-contract module block in one file, in source order. */
function slotModuleBodies(sf: ts.SourceFile): ts.ModuleBlock[] {
  const bodies: ts.ModuleBlock[] = []
  for (const statement of sf.statements) {
    if (!ts.isModuleDeclaration(statement) || !ts.isStringLiteral(statement.name)) continue
    if (statement.name.text !== SLOTS_MODULE) continue
    if (statement.body !== undefined && ts.isModuleBlock(statement.body)) bodies.push(statement.body)
  }
  return bodies
}

/** A type-literal member's string-literal type text, '' when absent or computed. */
function literalMember(entry: ts.TypeLiteralNode | undefined, name: string): string {
  const member = namedMember(entry, name)
  if (member?.type === undefined) return ''
  return ts.isLiteralTypeNode(member.type) && ts.isStringLiteral(member.type.literal)
    ? member.type.literal.text
    : ''
}

/** A type-literal member's type text on one line, absent when the member is. */
function memberTypeText(
  entry: ts.TypeLiteralNode | undefined,
  name: string,
  sf: ts.SourceFile,
): string | undefined {
  const member = namedMember(entry, name)
  return member?.type === undefined ? undefined : collapse(member.type.getText(sf))
}

/** One named property signature of a type literal. */
function namedMember(entry: ts.TypeLiteralNode | undefined, name: string): ts.PropertySignature | undefined {
  if (entry === undefined) return undefined
  for (const member of entry.members) {
    if (ts.isPropertySignature(member) && memberName(member.name) === name) return member
  }
  return undefined
}
