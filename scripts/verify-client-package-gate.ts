/** Command entry point: verify, optionally repair, and report. */

import { resolve } from 'node:path'
import { GATE } from './verify-client-package-context.ts'
import { readFacts } from './verify-client-package-facts.ts'
import { fixClientPackageManifests } from './verify-client-package-fix.ts'
import { collectClientPackageViolations } from './verify-client-package-violations.ts'

/**
 * Run the gate over the repository that contains this script.
 * @returns Nothing; the process exits non-zero when violations remain.
 */
export async function runClientPackageGate(): Promise<void> {
  const root = resolve(import.meta.dirname, '..')
  let facts = await readFacts(root)
  if (process.argv.includes('--fix')) {
    const changed = fixClientPackageManifests(root, facts)
    console.log(
      changed.length === 0
        ? GATE + ': no mechanically fixable manifest changes.'
        : GATE + ': fixed ' + String(changed.length) + ' manifest(s): ' + changed.join(', '),
    )
    facts = await readFacts(root)
  }
  const violations = collectClientPackageViolations(facts)
  if (violations.length > 0) {
    console.error(GATE + ': ' + String(violations.length) + ' violation(s):')
    for (const violation of violations) console.error('  ' + violation)
    process.exit(1)
  }

  const dynamic = facts.packages.filter(pkg => pkg.dynamic).length
  const requests = facts.declarations.reduce((total, pkg) => total + pkg.external.length, 0)
  console.log(
    GATE + ': ' + String(facts.packages.length) + ' client packages (' + String(dynamic) + ' dynamic, '
    + String(facts.packages.length - dynamic) + ' statically linked) satisfy package-mode and module-request rules; '
    + String(requests) + ' explicit external request(s).',
  )
}
