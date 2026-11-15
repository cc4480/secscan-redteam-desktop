/** Shared error, declaration metadata, and source predicates for persistence schema extraction. */

import { sep } from 'node:path'
import ts from 'typescript'

/** A reachable TypeScript type that cannot be represented as a persisted JSON type. */
export class PersistenceSchemaError extends Error {
  override name = 'PersistenceSchemaError'
}

/** Named and source-located declarations recorded against one extracted schema node. */
export interface DeclarationMetadata {
  readonly names: Set<string>
  readonly sources: Set<string>
}

/**
 * Report whether every arm of a type is `never` or `undefined`.
 * @param type - type to classify.
 * @returns true when no arm carries a persisted value.
 */
export function isNeverOrUndefined(type: ts.Type): boolean {
  return (type.isUnion() ? type.types : [type])
    .every(member => (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Never)) !== 0)
}

/**
 * Report whether a declaration names a type.
 * @param node - declaration to classify.
 * @returns true for type aliases, interfaces, and enums.
 */
export function isNamedTypeDeclaration(node: ts.Node): node is ts.TypeAliasDeclaration | ts.InterfaceDeclaration | ts.EnumDeclaration {
  return ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)
}

/**
 * Read the members of a closed string-literal union.
 * @param type - union type to read.
 * @param name - source name of the union, for diagnostics.
 * @returns the literal member values.
 */
export function stringLiterals(type: ts.Type, name: string): Set<string> {
  if (type.flags & ts.TypeFlags.Never) return new Set()
  const members = type.isUnion() ? type.types : [type]
  if (members.some(member => !(member.flags & ts.TypeFlags.StringLiteral))) throw new PersistenceSchemaError(`persistence schema: ${name} is not a closed string-literal union`)
  return new Set(members.map(member => (member as ts.StringLiteralType).value))
}

/**
 * Render one compiler diagnostic with the schema prefix.
 * @param diagnostic - compiler diagnostic.
 * @returns the prefixed message text.
 */
export function diagnosticText(diagnostic: ts.Diagnostic): string {
  return `persistence schema: TypeScript TS${String(diagnostic.code)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
}

/**
 * Compare two names by code unit for a stable schema order.
 * @param left - first name.
 * @param right - second name.
 * @returns negative, zero, or positive per lexicographic order.
 */
export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Normalize a filesystem path to `/`-separated repository form.
 * @param path - path to normalize.
 * @returns the normalized path.
 */
export function slash(path: string): string {
  return path.split(sep).join('/')
}

/**
 * Report whether a repository-relative path holds persisted schema sources.
 * @param file - `/`-separated repository-relative path.
 * @returns true for tracked non-dependency sources.
 */
export function trackedSource(file: string): boolean {
  return (file.startsWith('packages/') || file.startsWith('vendor/')) && !file.includes('/node_modules/')
}
