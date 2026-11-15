/** Public client build values, the profiles that select them, and their bundler substitutions. */

/** Prefix reserved for build-time values that may be embedded in browser artifacts. */
export const CLIENT_BUILD_ENV_PREFIX = 'DSH_CLIENT_'

/** Non-public selector used by build orchestration to request a named client profile. */
export const CLIENT_BUILD_PROFILE_SELECTOR = 'DSH_BUILD_CLIENT_PROFILE'

/** Public client environment required by official DSH artifacts. */
export const OFFICIAL_CLIENT_BUILD_ENVIRONMENT = {
  DSH_CLIENT_BUILD_PROFILE: 'official',
  DSH_CLIENT_TITLE: 'SecScan RedTeam',
} as const

/** Public variable carrying the source commit embedded in client artifacts. */
export const CLIENT_COMMIT_HASH_VARIABLE = 'DSH_CLIENT_COMMIT_HASH'

/** Public variable carrying the repository package version embedded in client artifacts. */
export const CLIENT_VERSION_VARIABLE = 'DSH_CLIENT_VERSION'

/** Public values embedded in one set of client artifacts. */
export type ClientBuildEnvironment = Readonly<Record<string, string>>

/**
 * Collect the public client environment in deterministic key order.
 * @param environment - environment inherited by the build process.
 * @returns defined `DSH_CLIENT_*` values only.
 */
export function clientBuildEnvironment(environment: NodeJS.ProcessEnv): ClientBuildEnvironment {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name, value]) => name.startsWith(CLIENT_BUILD_ENV_PREFIX) && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))) as Record<string, string>
}

/**
 * Resolve the exact public environment selected for a complete client build.
 * @param environment - parent process environment.
 * @param profile - explicit profile, or the non-public selector when omitted.
 * @returns the inherited public values when no profile is selected, otherwise the named profile.
 */
export function resolveClientBuildEnvironment(
  environment: NodeJS.ProcessEnv,
  profile: string | undefined = environment[CLIENT_BUILD_PROFILE_SELECTOR],
): ClientBuildEnvironment {
  if (profile === undefined) return clientBuildEnvironment(environment)
  if (profile === 'official') {
    const commitHash = environment[CLIENT_COMMIT_HASH_VARIABLE]
    const version = environment[CLIENT_VERSION_VARIABLE]
    if (commitHash === undefined) {
      throw new Error(`${CLIENT_COMMIT_HASH_VARIABLE} is required for the official client build profile`)
    }
    if (version === undefined) {
      throw new Error(`${CLIENT_VERSION_VARIABLE} is required for the official client build profile`)
    }
    return {
      DSH_CLIENT_COMMIT_HASH: commitHash,
      DSH_CLIENT_VERSION: version,
      ...OFFICIAL_CLIENT_BUILD_ENVIRONMENT,
    }
  }
  throw new Error(`unknown client build profile ${JSON.stringify(profile)}; expected "official"`)
}

/**
 * Construct a subprocess environment containing exactly the selected public values.
 * @param environment - parent process environment.
 * @param clientEnvironment - complete public environment selected for the build.
 * @returns the parent environment with selectors and inherited public values replaced.
 */
export function clientBuildProcessEnvironment(
  environment: NodeJS.ProcessEnv,
  clientEnvironment: ClientBuildEnvironment,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(environment)) {
    if (name === CLIENT_BUILD_PROFILE_SELECTOR || name.startsWith(CLIENT_BUILD_ENV_PREFIX)) continue
    child[name] = value
  }
  return { ...child, ...clientEnvironment }
}

/**
 * Require the public client environment to match an artifact profile exactly.
 *
 * An exact key set matters because every prefixed value is eligible for
 * inlining: an unexpected variable can change published bytes just as surely
 * as a missing or incorrect required value.
 *
 * @param environment - public environment from a build process or build record.
 * @param expected - complete public client environment for the artifact profile.
 */
export function assertClientBuildEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  expected: Readonly<Record<`DSH_CLIENT_${string}`, string>>,
): void {
  const actual = Object.fromEntries(Object.entries(environment)
    .filter(([name, value]) => name.startsWith(CLIENT_BUILD_ENV_PREFIX) && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)))
  const normalizedExpected = Object.fromEntries(Object.entries(expected)
    .sort(([left], [right]) => left.localeCompare(right)))
  if (JSON.stringify(actual) === JSON.stringify(normalizedExpected)) return

  const names = [...new Set([...Object.keys(actual), ...Object.keys(normalizedExpected)])].sort()
  const differences = names.filter(name => actual[name] !== normalizedExpected[name])
  throw new Error(`client build environment differs from the required artifact profile: ${differences.join(', ')}`)
}

/**
 * Create bundler substitutions for public client build environment variables.
 *
 * The empty `process.env` fallback makes an unset static property read
 * evaluate to `undefined` without providing a browser `process` global.
 * Exact substitutions remain longer matches than that fallback. Dynamic
 * property reads and enumeration deliberately observe the empty object.
 *
 * @param environment - environment inherited by the build process.
 * @returns deterministic Vite/tsdown `define` expressions.
 */
export function clientBuildEnvironmentDefines(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  const defines: Record<string, string> = { 'process.env': '{}' }
  for (const [name, value] of Object.entries(clientBuildEnvironment(environment))) {
    defines[`process.env.${name}`] = JSON.stringify(value)
  }
  return defines
}
