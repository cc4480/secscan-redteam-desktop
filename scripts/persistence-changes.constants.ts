/** Shared filenames, patterns, and scaffold placeholders for persistence-change verification. */

/** Repository-relative directory holding acknowledgement documents and their schema snapshots. */
export const HISTORY_DIRECTORY = 'docs/persistence-changes'

/** Repository-relative path of the generated current-schema inventory. */
export const CURRENT_SCHEMA = 'docs/persistence-schema.json'

/** Acknowledgement document identifier: date prefix followed by a lowercase slug. */
export const ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** SHA-256 digest of a canonical schema. */
export const DIGEST_PATTERN = /^[a-f0-9]{64}$/u

/** Scaffold text standing in for unwritten compatibility prose. */
export const EXPLANATION_PLACEHOLDER = 'TODO: explain this change.'

/** Scaffold text standing in for unwritten validation evidence. */
export const EVIDENCE_PLACEHOLDER = 'TODO: record validation evidence.'
