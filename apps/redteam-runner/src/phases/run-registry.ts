/**
 * Registry load/seed seam — extracted from run.ts to keep the phase module under
 * the 300-line budget. Behaviour is unchanged: a registry file that EXISTS but
 * does not load is corrupt or wrong-version, so this fails loud naming the path
 * before seeding can overwrite the only copy. An absent file still seeds.
 */
import { existsSync } from 'node:fs'
import { MemoryError } from '../memory/errors.js'
import { type VulnerabilityRegistry, loadRegistryFile, saveRegistryFile, seedRegistry } from '../registry.js'

/**
 * Load the findings registry, seeding it on first run.
 * @param registryPath - The configured registry file.
 * @returns The same path, and the loaded or freshly seeded registry.
 * @throws MemoryError `REGISTRY_UNREADABLE` when the file exists but cannot be read.
 */
export function loadOrSeedRegistry(registryPath: string): {
  registryPath: string
  registry: VulnerabilityRegistry
} {
  const loaded = loadRegistryFile(registryPath)
  if (loaded === null && existsSync(registryPath)) {
    throw new MemoryError(
      'REGISTRY_UNREADABLE',
      `findings registry at ${registryPath} exists but could not be loaded (corrupt or wrong version) — refusing to seed over it`,
    )
  }
  const registry: VulnerabilityRegistry = loaded ?? seedRegistry()
  saveRegistryFile(registryPath, registry)
  return { registryPath, registry }
}
