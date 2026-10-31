/**
 * Registry querying: relevance scoring over confirmed findings and killed
 * hypotheses. Stack overlap weighs most, then appType, then vuln class.
 */
import type { RegistryEntry, RegistryQuery, VulnerabilityRegistry } from "./store.js";
/** Best matches first, capped at limit (default 8). Empty query → newest first. */
export declare function queryRegistry(reg: VulnerabilityRegistry, q?: RegistryQuery): RegistryEntry[];
