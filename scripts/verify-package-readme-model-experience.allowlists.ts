/** Audit the two Model Experience allowlists against the scanned package set. */

import { NO_MODEL_EXPERIENCE_SECTION } from './verify-package-readme-model-experience.no-section-allowlist.ts'
import { SENTENCE_MODEL_EXPERIENCE } from './verify-package-readme-model-experience.sentence-allowlist.ts'
import type { Failure } from './verify-package-readme-model-experience.types.ts'

/**
 * Check that both allowlists name scanned packages, keep their audit
 * justifications, and never list the same package.
 * @param scannedPackages - repository-relative package directories carrying a manifest.
 * @param failures - failure list each problem is appended to.
 */
export function checkAllowlists(scannedPackages: ReadonlySet<string>, failures: Failure[]): void {
  for (const [pkg, reason] of Object.entries(NO_MODEL_EXPERIENCE_SECTION)) {
    if (!scannedPackages.has(pkg)) {
      failures.push({ path: `${pkg}/README.md`, message: 'no-section allowlist entry does not name a scanned package' })
    }
    if (reason.trim().length === 0) {
      failures.push({ path: `${pkg}/README.md`, message: 'no-section allowlist entry must retain its audit justification' })
    }
    if (SENTENCE_MODEL_EXPERIENCE[pkg] !== undefined) {
      failures.push({ path: `${pkg}/README.md`, message: 'package cannot appear in both Model Experience allowlists' })
    }
  }

  for (const [pkg, contract] of Object.entries(SENTENCE_MODEL_EXPERIENCE)) {
    if (!scannedPackages.has(pkg)) {
      failures.push({ path: `${pkg}/README.md`, message: 'sentence allowlist entry does not name a scanned package' })
    }
    if (contract.reason.trim().length === 0) {
      failures.push({ path: `${pkg}/README.md`, message: 'sentence allowlist entry must justify why structured model-context entries are unnecessary' })
    }
  }
}
