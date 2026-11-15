/** The record types the rescope mapping, its exact edits, and its checks are written in. */

/** One vendored package's directory, upstream npm name, and rescoped name. */
export interface Rename {
  readonly directory: string
  readonly upstream: string
  readonly scoped: string
}

/** An exact-string edit the token rule cannot express, with its required hit count. */
export interface ExactEdit {
  readonly id: string
  readonly file: string
  readonly find: string
  readonly replace: string
  readonly expect: number
}

/**
 * A file where an upstream name also appears as a vendor DIRECTORY name or an
 * upstream runtime identifier: the generic pass is disabled for the listed
 * names and the exact edits rename the real package-name occurrences.
 */
export interface GenericSkip {
  readonly file: string
  readonly upstream: readonly string[]
}

/** A string that must appear exactly `count` times once the rescope has run. */
export interface PostCondition {
  readonly file: string
  readonly text: string
  readonly count: number
}

/**
 * One exact edit's state in the text it targets. `pending` means the source
 * form is present and the target form absent; `applied` means the reverse;
 * anything else — a partial application, a moved site, or a DUPLICATED
 * insertion — is `invalid`, so it fails the run instead of being applied again.
 */
export type ExactEditState = 'pending' | 'applied' | 'invalid'
