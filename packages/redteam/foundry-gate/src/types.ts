/** Types for the Foundry snapshot, the reference panel, and scoring. */

/** One dataset bundle's spec, as frozen in the snapshot. */
export interface BundleSpec {
  slug: string
  title: string
  vuln_class: string
  cwe: string
  tier: number
  description: string
  endpoints: string[]
  marker: string
}

/** Fitness components issued by the Foundry for one bundle. */
export interface FoundryFitnessComponents {
  discrimination: number | null
  difficulty_fit: number | null
  novelty: number | null
  live_similarity: number | null
  coverage_gain: number | null
  cost_efficiency: number | null
}

/** Panel outcome recorded by the Foundry at snapshot time. */
export interface FoundryPanelRecord {
  pass_rate: number
  observed_tier: number | null
  vector: number[]
}

/** One bundle's entry in the snapshot manifest. */
export interface ManifestEntry {
  slug: string
  family_id: string
  family_split: string
  vuln_class: string
  cwe: string
  tier: number
  loop_tier: string
  status: string
  bundle_hash: string
  fitness: { model: string; fitness: number; components: FoundryFitnessComponents }
  panel: FoundryPanelRecord
}

/** The frozen snapshot manifest. */
export interface SnapshotManifest {
  snapshot: string
  generated_at: string
  source: { datasets: number; gold: number; silver: number; live_cases: number }
  bundles: ManifestEntry[]
}

/** Filter for listing manifest bundles. */
export interface BundleFilter {
  loopTier?: string
  vulnClass?: string
}

/** Result of recomputing one bundle's hash against the manifest. */
export interface BundleVerification {
  slug: string
  expected: string
  actual: string
  ok: boolean
}

/** Panel layer identifiers, weakest to strongest. */
export type PanelLayer = 'baseline-benign' | 'payload-basic' | 'payload-extended' | 'bundle-probe'

/** One layer's outcome against one bundle. */
export interface LayerResult {
  detected_vuln: boolean
  detected_patched: boolean
  passed: boolean
  evidence_vuln: string
  evidence_patched: string
}

/** A full panel run against one bundle. */
export interface PanelResult {
  slug: string
  layers: Record<PanelLayer, LayerResult>
  /** Layer pass flags in LAYERS order: baseline, basic, extended, probe. */
  vector: number[]
  pass_rate: number
  observed_tier: number | null
}

/** Fitness components used by the scoring formula. */
export interface FitnessComponents {
  discrimination: number | null
  difficulty_fit: number | null
  novelty: number | null
  live_similarity: number | null
  coverage_gain: number | null
  cost_efficiency: number | null
}

/** A scored bundle: live panel components combined with Foundry-issued ones. */
export interface ScoreResult {
  components: FitnessComponents
  /** Names of the components taken from the manifest rather than computed live. */
  issued_components: string[]
  fitness: number
  gate_pass: boolean
}

/** One bundle's full gate report: integrity, panel, and score. */
export interface BundleGateReport {
  slug: string
  loop_tier: string
  vuln_class: string
  assigned_tier: number
  hash_ok: boolean
  panel: PanelResult | null
  score: ScoreResult | null
  foundry_fitness: number
  foundry_pass_rate: number
  error: string | null
}

/** Options shared by the panel runner and the gate. */
export interface RunOptions {
  /** Python interpreter command; default: FOUNDRY_PYTHON env or "python3". */
  python?: string
  /** Snapshot directory; default: the package's bundled snapshot. */
  snapshotDir?: string
}
