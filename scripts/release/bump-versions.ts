/**
 * Version arithmetic behind a bump: release numbers, semver precedence, and the
 * next version each family takes. `bump.ts` re-exports the public judgements.
 */

/** Release types the dsh family accepts besides an explicit version. */
const RELEASE_TYPES = ['major', 'minor', 'patch'] as const

/**
 * Split a version into its release numbers, discarding any prerelease segment.
 * @param version - the current version.
 * @returns Major, minor, and patch.
 */
function releaseNumbers(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version)
  if (match === null) throw new Error(`cannot read release numbers from version ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Order two versions by their release numbers alone.
 * @param left - one version.
 * @param right - the other version.
 * @returns Negative when `left` is lower, positive when higher, zero when equal.
 */
function compareReleaseNumbers(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = releaseNumbers(left)
  const [rightMajor, rightMinor, rightPatch] = releaseNumbers(right)
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch
}

/**
 * The prerelease segment of a version, or undefined when it has none.
 * @param version - the version to read.
 * @returns The segment after the first `-`.
 */
function prereleaseOf(version: string): string | undefined {
  const index = version.indexOf('-')
  return index === -1 ? undefined : version.slice(index + 1)
}

/**
 * Order two versions by semver precedence.
 *
 * Git's version sort cannot stand in for this: `--sort=v:refname` places
 * `4.0.1-rc.1` above `4.0.1`, while semver gives a prerelease lower precedence
 * than the release it precedes. Prerelease identifiers compare field by field,
 * numeric fields numerically, so `rc.10` outranks `rc.1`.
 * @param left - one version.
 * @param right - the other version.
 * @returns Negative when `left` is lower, positive when higher, zero when equal.
 */
export function compareVersions(left: string, right: string): number {
  const numbers = compareReleaseNumbers(left, right)
  if (numbers !== 0) return numbers
  const leftPre = prereleaseOf(left)
  const rightPre = prereleaseOf(right)
  if (leftPre === undefined || rightPre === undefined) {
    if (leftPre === rightPre) return 0
    return leftPre === undefined ? 1 : -1
  }
  const leftFields = leftPre.split('.')
  const rightFields = rightPre.split('.')
  for (let index = 0; index < Math.max(leftFields.length, rightFields.length); index += 1) {
    const leftField = leftFields[index]
    const rightField = rightFields[index]
    // A shorter identifier list has lower precedence when all its fields match.
    if (leftField === undefined) return -1
    if (rightField === undefined) return 1
    if (leftField === rightField) continue
    const leftNumeric = /^\d+$/.test(leftField)
    const rightNumeric = /^\d+$/.test(rightField)
    if (leftNumeric && rightNumeric) return Number(leftField) - Number(rightField)
    // Numeric fields have lower precedence than alphanumeric ones.
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftField < rightField ? -1 : 1
  }
  return 0
}

/**
 * The next dsh version.
 * @param current - the family's current shared version.
 * @param request - `major`, `minor`, `patch`, or an explicit version.
 * @returns The target version.
 */
export function nextSharedVersion(current: string, request: string): string {
  if (!RELEASE_TYPES.includes(request as typeof RELEASE_TYPES[number])) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(request)) {
      throw new Error(`usage: release:dsh <major|minor|patch|x.y.z>, got ${request}`)
    }
    return request
  }
  const [major, minor, patch] = releaseNumbers(current)
  if (request === 'major') return `${String(major + 1)}.0.0`
  if (request === 'minor') return `${String(major)}.${String(minor + 1)}.0`
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`
}

/**
 * The version a vendored package publishes next.
 *
 * The baseline is the higher of the manifest version and the last tagged
 * version: a vendor re-sync restores upstream's version, which is lower than
 * the release version this repository already reserved, and incrementing that
 * would reuse an existing version.
 *
 * A prerelease does not consume its own release numbers. Publishing
 * `4.0.1-rc.1` leaves `4.0.1` free, so the next stable version is `4.0.1`
 * rather than `4.0.2`, and a second prerelease keeps those numbers too.
 * @param current - the package's manifest version.
 * @param tagged - the version its newest tag names, when it has one.
 * @param prerelease - prerelease identifier to append, for a rehearsal publication.
 * @returns The target version.
 */
export function nextVendorVersion(
  current: string,
  tagged: string | undefined,
  prerelease?: string,
): string {
  const taggedOrder = tagged === undefined ? undefined : compareReleaseNumbers(tagged, current)
  const ahead = taggedOrder !== undefined && taggedOrder > 0
  const baseline = ahead && tagged !== undefined ? tagged : current
  const [major, minor, patch] = releaseNumbers(baseline)
  // Reuse the numbers when the tagged version that set them is a prerelease
  // of them; increment when a stable release already holds them.
  const taggedPrerelease = tagged !== undefined && prereleaseOf(tagged) !== undefined
  const sameReleasePrereleases = taggedOrder === 0 && prereleaseOf(current) !== undefined
  const reuse = taggedPrerelease && (ahead || sameReleasePrereleases)
  const numbers = reuse
    ? `${String(major)}.${String(minor)}.${String(patch)}`
    : `${String(major)}.${String(minor)}.${String(patch + 1)}`
  return prerelease === undefined ? numbers : `${numbers}-${prerelease}`
}
