/**
 * Registry types — extracted from store.ts to keep the store module under the
 * 300-line budget. Pure declarations plus the empty-registry constructor.
 */

export interface TargetFingerprint {
  host: string
  /** e.g. ["react-spa", "cloudflare-edge", "bearer-rest-api"] */
  stack: string[]
  /** e.g. "security-scanner-saas", "ecommerce", "banking-portal" */
  appType: string
  notes?: string
}

interface RegistryEntryBase {
  id: string
  date: string // ISO
  engagementId: string
  target: TargetFingerprint
}

export interface ConfirmedFinding extends RegistryEntryBase {
  kind: 'confirmed'
  vulnClass: string
  technique: string
  attackId?: string
  owasp?: string
  /** The payload/shape that proved it, generalized (no live secrets). */
  payloadPattern: string
  /** Path to the evidence within the engagement dir. */
  evidenceRef: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
}

export interface KilledHypothesis extends RegistryEntryBase {
  kind: 'killed'
  hypothesis: string
  killingObservation: string
  attackId?: string
  vulnClass?: string
}

export type RegistryEntry = ConfirmedFinding | KilledHypothesis

export interface VulnerabilityRegistry {
  version: 1
  confirmed: ConfirmedFinding[]
  killed: KilledHypothesis[]
}

export function emptyRegistry(): VulnerabilityRegistry {
  return { version: 1, confirmed: [], killed: [] }
}

export interface RegistryQuery {
  vulnClass?: string
  /** Comma-separated stack hints, e.g. "react-spa,cloudflare-edge". */
  stack?: string
  appType?: string
  attackId?: string
  kind?: 'confirmed' | 'killed'
  limit?: number
}
