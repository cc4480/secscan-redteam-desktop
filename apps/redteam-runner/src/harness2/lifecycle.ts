/**
 * Harness2 layer lifecycle: consolidation + the lifecycle pre-checks
 * (H2-P3, spec section 11).
 *
 * Section 11 rules implemented in this module (rollback lives in
 * ./layer-rollback.ts, the 10-run monitor in ./monitor.ts):
 *
 *  1. MAX-5: at most MAX_ACTIVE_LAYERS (5) layers may be active per profile.
 *     `layers.setActiveLayers` enforces the cap on the single activation path,
 *     and `assertAdoptionCapacity` is the pre-check an adoption path calls
 *     before it even proposes a 6th layer: consolidation is required first.
 *  2. CONSOLIDATION: `consolidateLayers` takes ONE merged layer produced by the
 *     editor from the active stack + EXPERIENCE.md and runs the section-8 gate
 *     with the stack's metrics as base and the merged layer's as candidate.
 *     On ADOPT + operator approval it installs the merged layer with a
 *     section-11.4 file header (parented on the stack), MOVES the whole old
 *     stack into archive/<date>-consolidated/ with a manifest recording ids,
 *     dates and metrics, activates the merged layer as layer 1, marks the old
 *     lessons superseded and registers the new adoption for the monitor.
 *     On REJECT/INSUFFICIENT_DATA (or missing approval) it freezes new
 *     proposals for the class, flags the operator and changes NOTHING: the
 *     layer store, the archive and the active set are untouched, so the stack
 *     never becomes a 6-layer one.
 *  3. Permanent archive: a layer/archive is never deleted. Rollback and
 *     consolidation only MOVE directories into ./layer-archive.ts's dated,
 *     manifest-bearing tree.
 *  4. Layer file headers are rendered by ./layer-headers.ts (layer-id, date,
 *     parent layers, cycle-id, at-adoption metric deltas, status).
 *  5. Freezes and the adoption registry are persisted by ./lifecycle-state.ts.
 */
import type { Harness2Paths, PatchLayer, TargetClass } from "./contract.js";
import {
  MAX_ACTIVE_LAYERS,
  activeLayerIds,
  assertLayerGuardrails,
  installLayer,
  readLayer,
  setActiveLayers,
} from "./layers.js";
import { applyLayerHeader, type LayerHeader } from "./layer-headers.js";
import { archiveDate, findArchivedLayer, moveLayersToArchive } from "./layer-archive.js";
import {
  clearFreeze,
  freezeClass,
  readFreeze,
  readFreezes,
  recordAdoption,
  type FreezeRecord,
} from "./lifecycle-state.js";
import { appendExperience, supersedeExperience } from "./experience.js";
import { compositeScore, evaluateGate, type GateResult, type MetricSet, type VerdictName } from "./scoring.js";

/** A refused lifecycle operation; nothing is changed when it is thrown. */
export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

/** The monitor's S for one metric window: self-relative (TOK/STEPS ratios = 1). */
export function monitorScore(metrics: MetricSet): number {
  return compositeScore(metrics, metrics);
}

/** YYYY-MM-DD for a Date (UTC). */
export function isoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Section-11 pre-check: a 6th adoption needs consolidation first. */
export function assertAdoptionCapacity(paths: Harness2Paths): void {
  const active = activeLayerIds(paths);
  if (active.length >= MAX_ACTIVE_LAYERS) {
    throw new LifecycleError(
      `adoption refused: ${active.length} layers are active (cap ${MAX_ACTIVE_LAYERS}); consolidate the stack first ` +
        "(spec section 11.2). Active: " + active.join(", "),
    );
  }
}

/** Deltas of a merged stack vs the base stack, for the header/lesson line. */
export function formatConsolidationDeltas(base: MetricSet, candidate: MetricSet): string {
  const signed = (value: number, digits = 3): string => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
  return (
    `S ${signed(monitorScore(candidate) - monitorScore(base))}; ` +
    `SR ${signed(candidate.sr - base.sr)}, VF ${signed(candidate.vf - base.vf)}, ` +
    `FPR ${signed(candidate.fpr - base.fpr)}, STEPS ${signed(candidate.steps - base.steps, 1)}, ` +
    `TOK ${signed(candidate.tok - base.tok, 1)}, CR ${signed(candidate.cr - base.cr)}; ` +
    `${candidate.n} candidate / ${base.n} base runs`
  );
}

/** Section-8 gate inputs for consolidation: merged layer vs the active stack. */
export interface ConsolidationGateInput {
  readonly base: MetricSet;
  readonly candidate: MetricSet;
  readonly heldOutTargets: readonly string[];
  readonly trainingTargets: readonly string[];
  readonly logGap?: string;
}

export interface ConsolidateInput {
  readonly paths: Harness2Paths;
  readonly targetClass: TargetClass;
  readonly mergedLayer: PatchLayer;
  readonly gate: ConsolidationGateInput;
  /** Explicit operator approval; anything but true freezes instead of adopting. */
  readonly approve: boolean;
  readonly cycleId?: string;
  readonly date?: string;
  readonly now?: Date;
  readonly operator?: string;
}

export interface ConsolidationResult {
  readonly status: "ADOPTED" | "FROZEN";
  readonly verdict: VerdictName;
  readonly targetClass: TargetClass;
  readonly gate: GateResult;
  /** Ids of the old stack (still active when FROZEN, archived when ADOPTED). */
  readonly archivedLayerIds: readonly string[];
  readonly mergedLayerId?: string;
  /** Position of the merged layer in the new active set: always 1. */
  readonly activationIndex?: number;
  readonly archiveDir?: string;
  readonly archiveManifestPath?: string;
  readonly activeIds: readonly string[];
  readonly freeze?: FreezeRecord;
  readonly superseded?: number;
  /** Non-fatal EXPERIENCE.md notes; the layer store/archive state is authoritative. */
  readonly experienceNotes?: readonly string[];
}

/** Metrics block recorded in the consolidation manifest: ids, dates, metrics. */
function consolidationMetrics(base: MetricSet, candidate: MetricSet): Record<string, unknown> {
  return {
    base: { ...base },
    candidate: { ...candidate },
    sBase: monitorScore(base),
    sCandidate: monitorScore(candidate),
    sDelta: monitorScore(candidate) - monitorScore(base),
  };
}

/**
 * Consolidate the active stack into ONE merged layer (section 11.2). The gate
 * decides; on FROZEN nothing in the layer store, archive or active set changes.
 */
export function consolidateLayers(input: ConsolidateInput): ConsolidationResult {
  const { paths, targetClass, mergedLayer } = input;
  const now = input.now ?? new Date();
  const date = input.date ?? archiveDate(now);
  const active = activeLayerIds(paths);
  if (active.length === 0) throw new LifecycleError("consolidation refused: there is no active layer stack to consolidate");
  assertLayerGuardrails(mergedLayer);
  if (mergedLayer.yaml.trim() === "") throw new LifecycleError(`consolidation refused: merged layer "${mergedLayer.id}" has an empty YAML body`);
  if (mergedLayer.adoptedAt.trim() === "") throw new LifecycleError(`consolidation refused: merged layer "${mergedLayer.id}" has no adoptedAt timestamp`);
  if (active.includes(mergedLayer.id)) throw new LifecycleError(`consolidation refused: merged layer id "${mergedLayer.id}" is already active`);
  if (readLayer(paths, mergedLayer.id) !== null) throw new LifecycleError(`consolidation refused: merged layer id "${mergedLayer.id}" is already installed`);
  const oldCopy = findArchivedLayer(paths, mergedLayer.id);
  if (oldCopy !== null) {
    throw new LifecycleError(`consolidation refused: layer id "${mergedLayer.id}" already exists in the archive (${oldCopy}); ids are never reused`);
  }

  const gate = evaluateGate(input.gate);
  if (gate.verdict !== "ADOPT" || input.approve !== true) {
    const failed = gate.conditions.filter((condition) => !condition.passed).map((condition) => `#${condition.id} ${condition.name}`);
    const why =
      gate.verdict !== "ADOPT"
        ? `gate ${gate.verdict}${failed.length > 0 ? ` (${failed.join("; ")})` : ""}`
        : "operator approval required (approve !== true)";
    const freeze = freezeClass(paths, {
      targetClass,
      reason: `${why}; the ${active.length}-layer stack stays active and new proposals for this class are frozen until an operator clears it`,
      date,
      flaggedAt: now.toISOString(),
      verdict: gate.verdict,
    });
    return { status: "FROZEN", verdict: gate.verdict, targetClass, gate, archivedLayerIds: active, activeIds: active, freeze };
  }

  const cycleId = (input.cycleId ?? "").trim() === "" ? `cycle-${date}` : input.cycleId!.trim();
  const header: LayerHeader = {
    layerId: mergedLayer.id,
    date,
    parents: active,
    cycleId,
    metricDeltas: formatConsolidationDeltas(input.gate.base, input.gate.candidate),
    status: "active",
  };
  installLayer(paths, { ...mergedLayer, yaml: applyLayerHeader(mergedLayer.yaml, header) });
  let archive;
  try {
    archive = moveLayersToArchive({
      paths,
      layerIds: active,
      kind: "consolidated",
      date,
      now,
      manifest: {
        targetClass,
        cycleId,
        mergedLayerId: mergedLayer.id,
        activationIndex: 1,
        activeBefore: active,
        activeAfter: [mergedLayer.id],
        operator: input.operator ?? null,
        gate: { verdict: gate.verdict, score: gate.score, conditions: gate.conditions, overlap: gate.overlap },
        metrics: consolidationMetrics(input.gate.base, input.gate.candidate),
      },
    });
  } catch (err) {
    throw new LifecycleError(`consolidation failed while archiving the active stack: ${(err as Error).message}`);
  }
  setActiveLayers(paths, [mergedLayer.id]);
  clearFreeze(paths, targetClass);
  const notes: string[] = [];
  let superseded = 0;
  for (const id of active) {
    try {
      if (supersedeExperience(paths, { targetClass, layerId: id, by: mergedLayer.id }).marked) superseded += 1;
    } catch (err) {
      notes.push(`supersedeExperience(${id}) skipped: ${(err as Error).message}`);
    }
  }
  try {
    appendExperience(paths, {
      date,
      targetClass,
      layerId: mergedLayer.id,
      cycleId,
      changed: `consolidated ${active.length} active layers into "${mergedLayer.id}"`,
      why: `active stack full (${active.length}/${MAX_ACTIVE_LAYERS}): ${active.join(", ")}`,
      measuredEffect: formatConsolidationDeltas(input.gate.base, input.gate.candidate),
      status: { kind: "active" },
    });
  } catch (err) {
    notes.push(`appendExperience skipped: ${(err as Error).message}`);
  }
  recordAdoption(paths, {
    layerId: mergedLayer.id,
    targetClass,
    cycleId,
    adoptedAtMs: now.getTime(),
    adoptedAtIso: now.toISOString(),
    sAtAdoption: monitorScore(input.gate.candidate),
    crAtAdoption: input.gate.candidate.cr,
  });
  return {
    status: "ADOPTED",
    verdict: gate.verdict,
    targetClass,
    gate,
    archivedLayerIds: active,
    mergedLayerId: mergedLayer.id,
    activationIndex: 1,
    archiveDir: archive.dir,
    archiveManifestPath: archive.manifestPath,
    activeIds: [mergedLayer.id],
    superseded,
    ...(notes.length > 0 ? { experienceNotes: notes } : {}),
  };
}

/** Every consolidation freeze currently in force (the operator queue). */
export function consolidationFreezes(paths: Harness2Paths): FreezeRecord[] {
  return readFreezes(paths);
}

/** The class's consolidation freeze, or null. */
export function consolidationFreeze(paths: Harness2Paths, targetClass: TargetClass): FreezeRecord | null {
  return readFreeze(paths, targetClass);
}

// Rollback + incident reporting live in their own module to stay inside the
// per-file budget; re-exported here so callers use one lifecycle surface.
export { raiseIncident, rollbackLayerToArchive } from "./layer-rollback.js";
export type {
  RaiseIncidentInput,
  RollbackDeltas,
  RollbackInput,
  RollbackResult,
} from "./layer-rollback.js";
