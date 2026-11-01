/**
 * Operator console API — Layers & Gates view (Phase 5, view 2).
 *
 * GET /api/console/layers — read-only. Every section is independently
 * { available, reason?, ... }: a missing source degrades one panel, never
 * the page, and nothing is fabricated. Sources (all plain files):
 *   TS layers    <layersDir>/<id>/meta.json + <layersDir>/active.json
 *   Python       pyRegistryPath (layer_registry.json) + EXPERIENCE.md beside it
 *   Gate queue   <harness2Root>/runs/<id>/{proposal,probe}.json,
 *                <harness2Root>/runs/<stamp>-<class>/package.json,
 *                <harness2Root>/verdicts.jsonl
 *   Alerts       <harness2Root>/monitor/evaluations.jsonl (auto-rollback
 *                monitor) + <harness2Root>/lifecycle/incidents.jsonl
 *
 * Response:
 * {
 *   generatedAt: string,
 *   alerts:      Section<{ items: Alert[] }>,
 *   composition: Section<{ updatedAt: string | null, activeIds: string[] }>,
 *   layers:      Section<{ items: LayerRow[] }>,
 *   experience:  Section<{ lines: string[] }>,
 *   gateQueue:   Section<{ items: GateItem[] }>,
 * }
 * Alert    = { severity: "red" | "amber", kind, ts, layerId, targetClass, detail }
 * LayerRow = { id, source: "ts" | "python", targetClass, status, adoptedAt,
 *              installedAt, evidence, baseline, shaShort, active, activeIndex }
 * GateItem = { id, kind: "proposal" | "package", targetClass, component,
 *              status, verdict, adopted, reason, recordedAt,
 *              baseRuns, candidateRuns }
 * (nullable fields above are `string | null` / `number | null` unless noted.)
 */
import type { ServerResponse } from 'node:http';
import type { UiStore } from '../store.js';
export declare function handleConsoleLayers(store: UiStore, res: ServerResponse): void;
