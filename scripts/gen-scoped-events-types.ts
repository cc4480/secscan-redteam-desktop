/** Type records shared by the scoped-event analyzer, its candidate search, and its renderer. */

import ts from 'typescript'

/** One resolved `scopeTarget(base, key)` call and the base/key types it establishes. */
export interface ScopeTargetContract {
  baseType: ts.Type
  keyType: ts.Type
  source: string
}

/** One payload parameter, or one accessible property of it, considered as a routing subject. */
export interface SubjectCandidate {
  path: string
  parameter: number
  property?: string
  type: ts.Type
}

/** One `Events` member's runtime name and the resolver generated for it, if any. */
export interface ScopedEventResolver {
  event: string
  candidate: SubjectCandidate | null
}

/** The `@dshScopeScan` metadata read from one `Events` member's JSDoc. */
export interface ScopeTag {
  present: boolean
  unsupported: boolean
}
