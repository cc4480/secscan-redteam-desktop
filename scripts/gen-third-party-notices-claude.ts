/**
 * Derives the official Claude Agent SDK distribution facts — SDK version, CLI
 * version, and declared platform payloads — from the installed manifests.
 */

import {
  CLAUDE_AGENT_SDK_PACKAGE,
  CLAUDE_PLATFORM_DECLARED_LICENSE,
  CLAUDE_PLATFORM_PACKAGE_PREFIX,
  type Manifest,
} from './gen-third-party-notices-shared.ts'
import { installedManifest, type VirtualManifest } from './gen-third-party-notices-store.ts'

/** One platform payload declared by the official Claude Agent SDK. */
export interface ClaudePlatformPayload {
  readonly name: string
  readonly version: string
}

/** Current SDK and CLI distribution facts derived from the installed SDK manifest. */
export interface ClaudeDistribution {
  readonly sdkVersion: string
  readonly claudeCodeVersion: string
  readonly payloads: ClaudePlatformPayload[]
}

function requiredManifestString(
  value: string | undefined,
  field: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`gen-third-party-notices: ${CLAUDE_AGENT_SDK_PACKAGE} has no ${field}.`)
  }
  return value
}

/**
 * Derive the official platform payload set without a version or platform
 * allowlist. Only identities in the SDK's own package namespace are covered.
 * @param manifest - installed official SDK manifest.
 * @returns current SDK, CLI, and optional platform payload facts.
 */
export function claudeDistributionFromManifest(
  manifest: VirtualManifest,
): ClaudeDistribution {
  if (manifest.name !== CLAUDE_AGENT_SDK_PACKAGE) {
    throw new Error(
      `gen-third-party-notices: expected ${CLAUDE_AGENT_SDK_PACKAGE} manifest, got ${JSON.stringify(manifest.name)}.`,
    )
  }
  const sdkVersion = requiredManifestString(manifest.version, 'version')
  const claudeCodeVersion = requiredManifestString(
    manifest.claudeCodeVersion,
    'claudeCodeVersion',
  )
  const entries = Object.entries(manifest.optionalDependencies ?? {})
  if (entries.length === 0) {
    throw new Error(
      `gen-third-party-notices: ${CLAUDE_AGENT_SDK_PACKAGE} declares no optional platform payloads.`,
    )
  }
  const payloads = entries.map(([name, version]) => {
    if (!name.startsWith(CLAUDE_PLATFORM_PACKAGE_PREFIX)) {
      throw new Error(
        `gen-third-party-notices: ${CLAUDE_AGENT_SDK_PACKAGE} optional dependency ${name} is outside its authorized platform-payload identity.`,
      )
    }
    return {
      name,
      version: requiredManifestString(version, `${name} optional dependency version`),
    }
  }).sort((left, right) => left.name.localeCompare(right.name))
  return { sdkVersion, claudeCodeVersion, payloads }
}

/**
 * Collect the SDK distribution and verify every installed payload against its
 * declared version and license field.
 * @param manifests - workspace manifests already loaded by the caller.
 * @returns the verified SDK, CLI, and platform payload facts.
 */
export function collectClaudeDistribution(manifests: Map<string, Manifest>): ClaudeDistribution {
  const manifest = installedManifest(CLAUDE_AGENT_SDK_PACKAGE, manifests)
  if (manifest === undefined) {
    throw new Error(
      `gen-third-party-notices: cannot resolve ${CLAUDE_AGENT_SDK_PACKAGE}; run \`pnpm install\`.`,
    )
  }
  const distribution = claudeDistributionFromManifest(manifest)
  let installedPayloads = 0
  for (const payload of distribution.payloads) {
    const installed = installedManifest(payload.name, manifests, payload.version)
    if (installed === undefined) continue
    installedPayloads += 1
    if (
      installed.name !== payload.name
      || installed.version !== payload.version
      || installed.license !== CLAUDE_PLATFORM_DECLARED_LICENSE
    ) {
      throw new Error(
        `gen-third-party-notices: installed ${payload.name} does not match its SDK-declared version and ${CLAUDE_PLATFORM_DECLARED_LICENSE} license field.`,
      )
    }
  }
  if (installedPayloads === 0) {
    throw new Error(
      'gen-third-party-notices: no SDK-declared Claude platform payload is installed; install optional dependencies before regenerating.',
    )
  }
  return distribution
}
