/**
 * Evaluates SPDX expressions under the repository's permissive-license policy
 * and rejects unapproved runtime declarations.
 */

import parseSpdx from 'spdx-expression-parse'
import { LIBREOFFICE_PACKAGES, isOwnerAuthorizedRuntime } from './gen-third-party-notices-shared.ts'

/** SPDX identifiers this project may ship without further review. */
const PERMISSIVE_LICENSES = new Set(['MIT', 'MIT-CMU', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'PSF-2.0'])

/** Evaluate a parsed SPDX expression under the repository's license policy. */
function isPermissiveSpdx(expression: ReturnType<typeof parseSpdx>): boolean {
  if ('conjunction' in expression) {
    return expression.conjunction === 'and'
      ? isPermissiveSpdx(expression.left) && isPermissiveSpdx(expression.right)
      : isPermissiveSpdx(expression.left) || isPermissiveSpdx(expression.right)
  }
  return expression.plus !== true
    && expression.exception === undefined
    && PERMISSIVE_LICENSES.has(expression.license)
}

/**
 * Whether an SPDX expression grants terms this project may ship under.
 * `OR` needs one permissive alternative, because the consumer chooses; `AND`
 * needs all of them, because every obligation applies. Anything that is not a
 * recognized permissive identifier — copyleft, an exception clause, or a
 * license this list has never seen — evaluates to false, so an unfamiliar
 * expression fails closed rather than passing on a partial match.
 * @param license - the SPDX expression from the package manifest.
 * @returns true when the expression's obligations are all permissive.
 */
export function isPermissive(license: string): boolean {
  // Some npm manifests use a slash for a choice despite SPDX requiring `OR`.
  const normalized = license.replace(/\s*\/\s*/g, ' OR ').trim()
  try {
    return isPermissiveSpdx(parseSpdx(normalized))
  } catch {
    return false
  }
}

/**
 * Reject unapproved non-permissive licenses on installed or browser-bundled code.
 * @param dependencies - Disclosed runtime package identities and declared licenses.
 * @throws When a runtime package has no permissive license or exact owner authorization.
 */
export function assertRuntimeLicenses(dependencies: readonly { name: string; license: string }[]): void {
  const rejected = dependencies.filter(dep => !isPermissive(dep.license)
    && !isOwnerAuthorizedRuntime(dep.name)
    && !(LIBREOFFICE_PACKAGES.has(dep.name) && dep.license === 'MPL-2.0'))
  if (rejected.length > 0) {
    throw new Error(`gen-third-party-notices: runtime ${rejected.map(dep => `${dep.name} (${dep.license})`).join(', ')} is not a permissive license; review the distribution terms and record the decision before regenerating.`)
  }
}
