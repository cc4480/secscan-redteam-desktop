/** Audited packages whose READMEs legitimately omit the Model Experience section. */

/**
 * Generic packages whose public contract is model-agnostic. Their READMEs omit
 * Model Experience entirely; the reason stays here as reviewable audit evidence
 * so an absent section cannot be mistaken for forgotten documentation.
 */
export const NO_MODEL_EXPERIENCE_SECTION: Readonly<Record<string, string>> = {
  'packages/core/scope': 'The package is a model-agnostic registration and lifecycle primitive; model-facing consumers own any context selection.',
  'packages/util/brand': 'The package only constructs plain string values and registers nothing model-facing.',
  'packages/util/home-paths': 'The package only resolves harness-owned host paths; model-facing consumers own any rendered use.',
  'packages/util/launch-environment': 'The package only resolves host environment values; model-facing consumers own any rendered use.',
  'packages/util/workspace-path': 'The package only formats Workspace paths for browser UI; it never constructs model input.',
  'packages/util/values': 'The package only validates, snapshots, compares, freezes, or rejects caller-owned values; consumers own every model-facing use.',
}
