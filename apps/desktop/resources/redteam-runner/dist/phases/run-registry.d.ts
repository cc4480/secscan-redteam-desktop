import { type VulnerabilityRegistry } from '../registry.js';
/**
 * Load the findings registry, seeding it on first run.
 * @param registryPath - The configured registry file.
 * @returns The same path, and the loaded or freshly seeded registry.
 * @throws MemoryError `REGISTRY_UNREADABLE` when the file exists but cannot be read.
 */
export declare function loadOrSeedRegistry(registryPath: string): {
    registryPath: string;
    registry: VulnerabilityRegistry;
};
