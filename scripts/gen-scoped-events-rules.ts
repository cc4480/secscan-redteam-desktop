/** AST predicates, scan-tag parsing, and candidate filtering for the scoped-event analyzer. */

import ts from 'typescript'
import type { ScopeTag, SubjectCandidate } from './gen-scoped-events-types.ts'

/** Return whether an Events interface is inside declare module '@deepseek-ai/cordis'. */
export function isCordisModuleInterface(node: ts.InterfaceDeclaration): boolean {
  const block = node.parent
  const declaration = block.parent
  return ts.isModuleBlock(block)
    && ts.isModuleDeclaration(declaration)
    && ts.isStringLiteral(declaration.name)
    && declaration.name.text === '@deepseek-ai/cordis'
}

/** Return whether a parameter is the explicit TypeScript this receiver. */
export function isThisParameter(parameter: ts.ParameterDeclaration): boolean {
  return ts.isIdentifier(parameter.name) && parameter.name.text === 'this'
}

/** Parse and validate the optional @dshScopeScan unsupported tag. */
export function parseScopeTag(raw: string, where: string, violations: string[]): ScopeTag {
  const tags = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').trim())
    .filter(line => line.startsWith('@dshScopeScan'))
  if (tags.length > 1) violations.push(`${where} has multiple @dshScopeScan tags`)
  if (tags.length === 0) return { present: false, unsupported: false }
  const unsupported = tags[0] === '@dshScopeScan unsupported'
  if (!unsupported) {
    violations.push(
      `${where} has invalid scoped-event scan metadata '${tags[0]}'; expected '@dshScopeScan unsupported'`,
    )
  }
  return { present: true, unsupported }
}

/** Return whether a property has a private or protected declaration. */
export function hasNonPublicDeclaration(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((declaration) => {
    if (!ts.canHaveModifiers(declaration)) return false
    return ts.getModifiers(declaration)?.some((modifier) => {
      return modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword
    }) ?? false
  })
}

/** Deduplicate candidate paths contributed by merged/intersection types. */
export function dedupeCandidates(candidates: readonly SubjectCandidate[]): SubjectCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) return false
    seen.add(candidate.path)
    return true
  })
}
