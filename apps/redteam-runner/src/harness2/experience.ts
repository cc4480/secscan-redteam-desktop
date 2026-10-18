/**
 * Harness2 EXPERIENCE.md library + approval-gated adopt/rollback (H2-P3).
 *
 * EXPERIENCE.md is the continual-improvement ledger: one ASCII markdown file
 * per target class under paths.experience, recording what changed in the
 * harness, why, the MEASURED effect on outcome metrics and the tokens spent.
 * Canonical format (EXPERIENCE_FORMAT_DOC, shared with the H2-P2a package):
 *   # EXPERIENCE - <target-class>
 *   ## <YYYY-MM-DD> - <layerId|general>
 *   - change: ... / - reason: ... / - measured effect: ... / - tokens spent: N
 *
 * Safety properties:
 *  - adoptVerdict is the ONLY adoption path: it refuses unless the probe verdict
 *    says adopted AND explicit approval is true, then re-checks both YAML bodies
 *    for pinned guardrails (src/safety, src/policy, src/gate.ts, src/accountability,
 *    auth-gate, the guardrails component) as defense in depth before installing
 *    and activating the layer and appending the measured lesson.
 *  - rollbackLayer removes the layer and appends a dated "rolled back" lesson,
 *    so history is never silently rewritten.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PINNED_COMPONENT, type ExperienceEntry, type Harness2Paths, type PatchLayer, type ProbeVerdict, type Proposal, type TargetClass } from "./contract.js";
import { COMPONENT_PATHS } from "./harness-stamp.js";
import { activeLayerIds, installLayer, removeLayer, setActiveLayers } from "./layers.js";

/** Canonical markdown format, shared verbatim with the H2-P2a package. */
export const EXPERIENCE_FORMAT_DOC = [
  "EXPERIENCE.md canonical format (ASCII, LF, one file per target class):",
  "# EXPERIENCE - <target-class>",
  "## <YYYY-MM-DD> - <layerId|general>",
  "- change: <what changed in the harness>",
  "- reason: <why it was proposed>",
  "- measured effect: <measured metric deltas, never an estimate>",
  "- tokens spent: <non-negative integer>",
  "Entries are appended, never edited; the four bullet fields are required in that order;",
  "`general` means the lesson is not tied to a layer; the dedupe key is (date, layerId, change);",
  "prose outside entries is tolerated on read but dropped by the next canonical rewrite.",
].join("\n");

const HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s+-\s+(.+?)\s*$/;
const FIELD = /^-\s+(change|reason|measured effect|tokens spent)\s*:\s*(.*?)\s*$/i;
const LAYER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INT = /^\d+$/;
const DELTA_KEYS = ["vulnsFound", "falsePositives", "steps", "tokensIn", "tokensOut"] as const;
const PINNED_NEEDLES: readonly string[] = [...COMPONENT_PATHS[PINNED_COMPONENT], PINNED_COMPONENT, "auth-gate"];

/** Thrown whenever adoption or rollback is refused; nothing is written before it. */
export class AdoptRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdoptRefusedError";
  }
}

export interface ExperienceParseResult { readonly entries: readonly ExperienceEntry[]; readonly skipped: number }
export interface ExperienceReport extends ExperienceParseResult { readonly targetClass: TargetClass; readonly path: string; readonly exists: boolean }
export interface ExperienceFileInfo { readonly targetClass: TargetClass; readonly path: string; readonly entries: number; readonly skipped: number }
export interface AppendExperienceResult { readonly path: string; readonly appended: boolean; readonly total: number }
export interface AdoptVerdictResult { readonly layerId: string; readonly experiencePath: string }
export interface RollbackLayerInput { readonly paths: Harness2Paths; readonly layerId: string }
export interface RollbackLayerResult { readonly layerId: string; readonly experiencePath: string; readonly lesson: ExperienceEntry }
export interface AdoptVerdictInput {
  readonly paths: Harness2Paths;
  readonly proposal: Proposal;
  readonly layer: PatchLayer;
  readonly verdict: ProbeVerdict;
  /** Explicit operator approval; anything but true refuses adoption. */
  readonly approve: boolean;
}

/** True for a real calendar date in YYYY-MM-DD form. */
function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function isoDateOf(value: string | undefined): string | undefined {
  const candidate = value?.slice(0, 10);
  return candidate !== undefined && isIsoDate(candidate) ? candidate : undefined;
}
function oneLine(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, " ").trim();
}
function dedupeKey(entry: ExperienceEntry): string {
  return [entry.date, entry.layerId ?? "", oneLine(entry.change)].join("\u0000");
}

/** Sanitize a target class into a safe EXPERIENCE.md filename stem. */
export function sanitizeTargetClass(targetClass: TargetClass): string {
  return targetClass.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "") || "general";
}

/** `<paths.experience>/<sanitized-target-class>.md`. */
export function resolveExperiencePath(paths: Harness2Paths, targetClass: TargetClass): string {
  return join(paths.experience, `${sanitizeTargetClass(targetClass)}.md`);
}

/** The pinned-guardrail token a layer/proposal YAML references, if any (slash and whitespace normalized). */
export function findPinnedGuardrailReference(yaml: string): string | null {
  const normalized = yaml.toLowerCase().split("\\").join("/").replace(/\s+/g, "");
  for (const needle of PINNED_NEEDLES) {
    if (normalized.includes(needle.toLowerCase().split("\\").join("/"))) return needle;
  }
  return null;
}

/** Validate and finish one raw entry block; null means the block is skipped. */
function finishEntry(raw: { date: string; layerToken: string; fields: ReadonlyMap<string, string> }, targetClass: TargetClass): ExperienceEntry | null {
  const change = raw.fields.get("change") ?? "";
  const reason = raw.fields.get("reason") ?? "";
  const measuredEffect = raw.fields.get("measured effect") ?? "";
  const tokensSpent = raw.fields.get("tokens spent") ?? "";
  if (change === "" || reason === "" || measuredEffect === "" || !INT.test(tokensSpent) || !isIsoDate(raw.date)) return null;
  const token = raw.layerToken.trim();
  const layerId = LAYER_ID.test(token) && token.toLowerCase() !== "general" ? token : undefined;
  return { date: raw.date, targetClass, change, reason, measuredEffect, tokensSpent: Number(tokensSpent), ...(layerId !== undefined ? { layerId } : {}) };
}

/**
 * Parse a markdown body into entries; malformed blocks are skipped (counted),
 * never thrown on, and extra prose is tolerated and ignored.
 */
export function parseExperience(markdown: string, targetClass: TargetClass): ExperienceParseResult {
  const entries: ExperienceEntry[] = [];
  let skipped = 0;
  let raw: { date: string; layerToken: string; fields: Map<string, string> } | null = null;
  const flush = (): void => {
    if (raw === null) return;
    const entry = finishEntry(raw, targetClass);
    if (entry === null) skipped += 1;
    else entries.push(entry);
    raw = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      raw = { date: heading[1]!, layerToken: heading[2]!, fields: new Map() };
      continue;
    }
    if (line.startsWith("## ") || line === "##") { flush(); skipped += 1; raw = null; continue; }
    const field = raw === null ? null : FIELD.exec(line);
    if (raw === null || field === null) continue;
    const name = field[1]!.toLowerCase();
    if (!raw.fields.has(name)) raw.fields.set(name, field[2] ?? "");
  }
  flush();
  return { entries, skipped };
}

/** Canonical markdown for a set of entries; the inverse of parseExperience. */
export function renderExperience(entries: readonly ExperienceEntry[], targetClass?: TargetClass): string {
  const name = sanitizeTargetClass(targetClass ?? entries[0]?.targetClass ?? "general");
  const blocks = entries.map((entry) =>
    [
      `## ${entry.date} - ${entry.layerId ?? "general"}`,
      `- change: ${oneLine(entry.change)}`,
      `- reason: ${oneLine(entry.reason)}`,
      `- measured effect: ${oneLine(entry.measuredEffect)}`,
      `- tokens spent: ${entry.tokensSpent}`,
    ].join("\n"),
  );
  return blocks.length === 0 ? `# EXPERIENCE - ${name}\n` : `# EXPERIENCE - ${name}\n\n${blocks.join("\n\n")}\n`;
}

/** Read one class's EXPERIENCE.md; a missing or unreadable file reads as empty. */
export function readExperienceReport(paths: Harness2Paths, targetClass: TargetClass): ExperienceReport {
  const path = resolveExperiencePath(paths, targetClass);
  if (!existsSync(path)) return { targetClass, path, exists: false, entries: [], skipped: 0 };
  try {
    const parsed = parseExperience(readFileSync(path, "utf8"), targetClass);
    return { targetClass, path, exists: true, entries: parsed.entries, skipped: parsed.skipped };
  } catch {
    return { targetClass, path, exists: false, entries: [], skipped: 0 };
  }
}

/** The entries of one class's EXPERIENCE.md (never throws). */
export function readExperience(paths: Harness2Paths, targetClass: TargetClass): ExperienceEntry[] {
  return [...readExperienceReport(paths, targetClass).entries];
}
/** Tmp-write then rename, so an EXPERIENCE.md is never seen half written. */
function atomicWrite(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    writeFileSync(tmp, body);
    try { renameSync(tmp, path); } catch { rmSync(path, { force: true }); renameSync(tmp, path); }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

/** Refuse to persist an entry the parser would later discard. */
function assertAppendable(entry: ExperienceEntry): void {
  const problem = !isIsoDate(entry.date) ? "date must be YYYY-MM-DD"
    : oneLine(entry.change) === "" ? "change must not be empty"
    : oneLine(entry.reason) === "" ? "reason must not be empty"
    : oneLine(entry.measuredEffect) === "" ? "measured effect must not be empty"
    : !Number.isInteger(entry.tokensSpent) || entry.tokensSpent < 0 ? "tokens spent must be a non-negative integer"
    : null;
  if (problem !== null) throw new Error(`invalid EXPERIENCE entry (${entry.targetClass}): ${problem}`);
}

/** Append one dated lesson atomically: parse, dedupe on (date, layerId, change), rewrite canonically. */
export function appendExperience(paths: Harness2Paths, entry: ExperienceEntry): AppendExperienceResult {
  assertAppendable(entry);
  const report = readExperienceReport(paths, entry.targetClass);
  if (report.entries.some((seen) => dedupeKey(seen) === dedupeKey(entry))) return { path: report.path, appended: false, total: report.entries.length };
  atomicWrite(report.path, renderExperience([...report.entries, entry], entry.targetClass));
  return { path: report.path, appended: true, total: report.entries.length + 1 };
}

/** Every per-class EXPERIENCE.md on disk, with entry/skip counts (never throws). */
export function listExperience(paths: Harness2Paths): ExperienceFileInfo[] {
  let names: string[];
  try {
    names = readdirSync(paths.experience).filter((name) => name.toLowerCase().endsWith(".md")).sort();
  } catch {
    return [];
  }
  return names.map((name) => {
    const targetClass = name.slice(0, -3);
    const report = readExperienceReport(paths, targetClass);
    return { targetClass, path: report.path, entries: report.entries.length, skipped: report.skipped };
  });
}

/** One class's entries plus the canonical markdown to print (CLI `experience show`). */
export function showExperience(paths: Harness2Paths, targetClass: TargetClass): ExperienceReport & { readonly markdown: string } {
  const report = readExperienceReport(paths, targetClass);
  return { ...report, markdown: renderExperience(report.entries, targetClass) };
}

/** Compare the five metric deltas plus the compared run counts, deterministically. */
function formatMeasuredEffect(verdict: ProbeVerdict): string {
  const deltas = DELTA_KEYS.map((key) => `${key} ${verdict.deltas[key] >= 0 ? "+" : ""}${verdict.deltas[key]}`).join(", ");
  return `${deltas} over ${verdict.baseRuns} base / ${verdict.candidateRuns} candidate runs`;
}

/** The target class whose EXPERIENCE.md mentions a layer, if any. */
function classForLayer(paths: Harness2Paths, layerId: string): TargetClass | undefined {
  for (const info of listExperience(paths)) {
    if (readExperience(paths, info.targetClass).some((entry) => entry.layerId === layerId)) return info.targetClass;
  }
  return undefined;
}

/**
 * The ONLY adoption path: refuses unless verdict.adopted AND approve === true,
 * re-checks pinned guardrails (defense in depth), installs + activates the
 * layer and appends the measured lesson. Nothing is written when refused.
 */
export function adoptVerdict(input: AdoptVerdictInput): AdoptVerdictResult {
  const { paths, proposal, layer, verdict, approve } = input;
  if (approve !== true) throw new AdoptRefusedError("adopt refused: explicit operator approval is required (approve === true)");
  if (verdict.adopted !== true) throw new AdoptRefusedError(`adopt refused: verdict "${verdict.proposalId}" is not adopted (${verdict.reason})`);
  if (verdict.proposalId !== proposal.id) throw new AdoptRefusedError(`adopt refused: verdict is for "${verdict.proposalId}", not proposal "${proposal.id}"`);
  if (proposal.component === PINNED_COMPONENT) throw new AdoptRefusedError(`adopt refused: "${PINNED_COMPONENT}" is pinned and can never be tuned`);
  if (!Number.isInteger(verdict.tokensSpent) || verdict.tokensSpent < 0) throw new AdoptRefusedError("adopt refused: verdict.tokensSpent must be a non-negative integer");
  if (layer.yaml.trim() === "") throw new AdoptRefusedError(`adopt refused: layer "${layer.id}" has an empty YAML body`);
  const pinned = findPinnedGuardrailReference(layer.yaml) ?? findPinnedGuardrailReference(proposal.yaml);
  if (pinned !== null) throw new AdoptRefusedError(`adopt refused: layer "${layer.id}" touches pinned guardrail "${pinned}"`);
  const installed = installLayer(paths, layer);
  try { setActiveLayers(paths, [...activeLayerIds(paths), installed.layer.id]); } catch (error) {
    removeLayer(paths, layer.id);
    throw error;
  }
  const lesson: ExperienceEntry = {
    date: isoDateOf(layer.adoptedAt) ?? new Date().toISOString().slice(0, 10),
    targetClass: proposal.targetClass,
    layerId: layer.id,
    change: `adopted layer "${layer.id}" for the ${proposal.component} component`,
    reason: oneLine(proposal.rationale) === "" ? verdict.reason : oneLine(proposal.rationale),
    measuredEffect: formatMeasuredEffect(verdict),
    tokensSpent: verdict.tokensSpent,
  };
  return { layerId: layer.id, experiencePath: appendExperience(paths, lesson).path };
}

/**
 * Remove an adopted layer and append a dated "rolled back" lesson, so a rollback
 * adds a record instead of rewriting the past.
 */
export function rollbackLayer(input: RollbackLayerInput): RollbackLayerResult {
  const { paths, layerId } = input;
  const targetClass = classForLayer(paths, layerId) ?? "general";
  if (!removeLayer(paths, layerId)) throw new AdoptRefusedError(`rollback refused: no adopted layer "${layerId}" is installed`);
  const lesson: ExperienceEntry = {
    date: new Date().toISOString().slice(0, 10),
    targetClass,
    layerId,
    change: `rolled back layer "${layerId}"`,
    reason: "operator rollback: the layer is no longer installed",
    measuredEffect: "layer removed; earlier measured effects are retained unchanged above",
    tokensSpent: 0,
  };
  return { layerId, experiencePath: appendExperience(paths, lesson).path, lesson };
}
