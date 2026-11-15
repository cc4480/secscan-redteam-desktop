/**
 * The bump command's work: select the family's plan, write the manifests,
 * refresh the lockfile, report the plan, and commit it.
 */

import { releaseFamily } from './families.ts'
import { planPerPackage, planShared, type PlannedVersion, writeVersion } from './bump-plans.ts'
import { capture, pnpmCommand } from './process.ts'

/**
 * Run one bump from the flag values `main` parsed, doing what it reports:
 * the dsh family moves to one shared version, the vendored family advances
 * every package on its own version line.
 * @param familyId - the `--family` value, `dsh` or `vendor`.
 * @param prerelease - the `--prerelease` value; the vendored family only.
 * @param dryRun - whether `--dry-run` was passed, which writes and commits nothing.
 * @param positionals - remaining arguments, the dsh family's release request.
 */
export function bumpRelease(
  familyId: string | undefined,
  prerelease: string | undefined,
  dryRun: boolean,
  positionals: readonly string[],
): void {
  if (familyId === undefined) throw new Error('usage: bump.ts --family <dsh|vendor> [version]')

  const family = releaseFamily(familyId)
  const root = process.cwd()
  const members = family.members(root)
  family.verifyVersions(members)

  let planned: PlannedVersion[]
  let sharedVersion: string | undefined
  if (family.id === 'dsh') {
    const request = positionals[0]
    if (request === undefined) throw new Error('usage: release:dsh <major|minor|patch|x.y.z>')
    if (prerelease !== undefined) {
      throw new Error('release:dsh takes the prerelease in its version argument, as in 0.0.1-rc.1')
    }
    const shared = planShared(family, root, members, request)
    planned = shared.planned
    sharedVersion = shared.version
  } else {
    if (positionals.length > 0) throw new Error('release:vendor takes no version: each package increments its own patch')
    if (prerelease !== undefined && !/^[0-9A-Za-z.-]+$/.test(prerelease)) {
      throw new Error(`--prerelease must be a semver prerelease identifier, got ${prerelease}`)
    }
    planned = planPerPackage(family, members, prerelease)
  }

  if (planned.length === 0) {
    console.log(`release bump: family ${family.id}, nothing changed since publication`)
    return
  }

  if (!dryRun) {
    for (const entry of planned) writeVersion(root, entry.manifestPath, entry.from, entry.to)
    const [pnpm, ...pnpmArgs] = pnpmCommand()
    capture(pnpm, [...pnpmArgs, 'install', '--lockfile-only'])
  }

  const summary = sharedVersion
    ?? planned.map(entry => `${entry.label.replace('vendor/', '')} ${entry.to}`).join(', ')
  console.log(`release bump: family ${family.id} -> ${summary}`)
  for (const entry of planned) console.log(`  ${entry.label}: ${entry.from} -> ${entry.to}`)

  if (dryRun) {
    console.log('release bump: dry run, nothing written')
    return
  }
  capture('git', ['add', 'pnpm-lock.yaml', ...planned.map(entry => entry.manifestPath)])
  capture('git', ['commit', '-m', `release(${family.id}): ${summary}`])
  console.log('release bump: committed. After this merges to master, tag it:')
  for (const tag of [...new Set(planned.map(entry => entry.tag).filter(tag => tag !== undefined))]) {
    console.log(`  git tag ${tag} <merge commit> && git push origin ${tag}`)
  }
}
