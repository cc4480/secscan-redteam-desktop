/** Routing-subject search and type-identity comparison over one Events member's payload. */

import ts from 'typescript'
import { dedupeCandidates, hasNonPublicDeclaration, isThisParameter } from './gen-scoped-events-rules.ts'
import type { SubjectCandidate } from './gen-scoped-events-types.ts'

/** Enumerate every payload parameter and every accessible one-level property. */
export function subjectCandidates(checker: ts.TypeChecker, member: ts.MethodSignature): SubjectCandidate[] {
  const candidates: SubjectCandidate[] = []
  let runtimeIndex = 0
  for (const parameter of member.parameters) {
    if (isThisParameter(parameter)) continue
    const directPath = `args[${runtimeIndex}]`
    const parameterType = checker.getTypeAtLocation(parameter)
    candidates.push({ path: directPath, parameter: runtimeIndex, type: parameterType })
    for (const property of checker.getPropertiesOfType(normalizedType(checker, parameterType))) {
      const name = property.getName()
      if (name.startsWith('__@') || hasNonPublicDeclaration(property)) continue
      candidates.push({
        path: `${directPath}.${name}`,
        parameter: runtimeIndex,
        property: name,
        type: checker.getTypeOfSymbolAtLocation(property, parameter),
      })
    }
    runtimeIndex += 1
  }
  return dedupeCandidates(candidates)
}

/** Compare exact Program type identities after removing null and undefined. */
export function typesEquivalent(checker: ts.TypeChecker, left: ts.Type, right: ts.Type): boolean {
  const normalizedLeft = normalizedType(checker, left)
  const normalizedRight = normalizedType(checker, right)
  if (normalizedLeft.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false
  if (normalizedRight.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false
  return normalizedLeft === normalizedRight
}

/** Remove null and undefined from a routing or candidate type. */
export function normalizedType(checker: ts.TypeChecker, type: ts.Type): ts.Type {
  return checker.getNonNullableType(type)
}

/** Render a stable diagnostic type label. */
export function typeText(checker: ts.TypeChecker, type: ts.Type): string {
  return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
}
