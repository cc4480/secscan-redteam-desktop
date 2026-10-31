/**
 * Harness2 section-6 package rendering + atomic writer (H2-P2).
 *
 * renderPackageDocument turns the package document into ONE self-contained
 * paste-ready text: seven delimited sections in spec order, every editable
 * component file verbatim, every contrasted pair with the full step log from the
 * section-5 steps table, the window metrics, the class's EXPERIENCE.md full
 * text, the constraints and the machine-checkable checklist.
 *
 * finalizePackage() is what fills section 7: it renders sections 1-6 first,
 * counts their delimiters, and only then builds the checklist - so "delimiters
 * balanced" is measured on the real text, not asserted.
 *
 * writeProposalPackage writes `runs/<timestamp>-<class>/package.md` and
 * `package.json` atomically (temp file + rename), so a crash never leaves a
 * half-written package a later phase could adopt.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness2Paths } from "./contract.js";
import type { ContrastedPair, PackageChecklist, PackageRun, ProposalPackageDocument, RunSnapshot } from "./package.js";
import { PINNED_MARKER } from "./package-component-map.js";
import { buildChecklist, sectionBegin, sectionEnd } from "./package-parse.js";
import { renderConstraintsSection } from "./package-instructions.js";

function pushSection(lines: string[], index: number, name: string, body: readonly string[]): void {
  lines.push(sectionBegin(index, name), ...body, sectionEnd(index, name), "");
}

function snapshotLines(label: string, snapshot: RunSnapshot): string[] {
  return [
    `@@RUN ${label} BEGIN@@`,
    `run_id: ${snapshot.runId}`,
    `outcome: ${snapshot.outcome}`,
    `target_class: ${snapshot.targetClass}`,
    `target_subclass: ${snapshot.targetSubclass ?? "unknown"}`,
    `target_id: ${snapshot.targetId ?? "unknown"}`,
    `harness_version: ${snapshot.harnessVersion}`,
    `layer_set: [${snapshot.layerSet.join(", ")}]`,
    `success: ${String(snapshot.success)}`,
    `vulns_found: ${snapshot.vulnsFound}`,
    `claims_total: ${snapshot.claimsTotal}`,
    `false_positives: ${snapshot.falsePositives}`,
    `steps_count: ${snapshot.steps}`,
    `tokens_total: ${snapshot.tokens}`,
    `crashed: ${String(snapshot.crashed)}`,
    `failure_mode: ${snapshot.failureMode}`,
  ];
}

function stepLines(run: PackageRun): string[] {
  const lines: string[] = [`@@STEPS BEGIN@@`, `steps_total: ${run.steps.length}`];
  for (const step of run.steps) {
    lines.push(
      `@@STEP ${step.seq} BEGIN@@`,
      `role: ${step.role}`,
      `tool: ${step.toolName ?? "-"}`,
      `tokens: ${step.tokens ?? "-"}`,
      "@@STEP CONTENT@@",
      step.content,
      `@@STEP ${step.seq} END@@`,
    );
  }
  lines.push("@@STEPS END@@");
  return lines;
}

function renderRun(label: string, run: PackageRun): string[] {
  return [...snapshotLines(label, run.snapshot), ...stepLines(run), `@@RUN ${label} END@@`];
}

function renderPair(pair: ContrastedPair): string[] {
  return [
    `@@PAIR ${pair.index} BEGIN@@`,
    `run_id_high: ${pair.runIdHigh}`,
    `run_id_low: ${pair.runIdLow}`,
    `pair_note: ${pair.note === "" ? "quartile contrast" : pair.note}`,
    ...renderRun("high", pair.high),
    ...renderRun("low", pair.low),
    `@@PAIR ${pair.index} END@@`,
  ];
}

function renderHeader(doc: ProposalPackageDocument): string[] {
  const header = doc.header;
  return [
    `# Harness2 proposal package (format ${doc.formatVersion})`,
    `package_id: ${header.packageId}`,
    `date: ${header.date}`,
    `format_version: ${header.formatVersion}`,
    `tuner_version: ${header.tunerVersion}`,
    `target_class: ${header.targetClass}`,
    `mode: ${header.mode}`,
    `base_harness_version: ${header.baseHarnessVersion}`,
    `active_layer_set: [${header.activeLayerSet.join(", ")}]`,
  ];
}

function renderComponents(doc: ProposalPackageDocument): string[] {
  const lines: string[] = ["# Editable components: FULL contents, verbatim (no summaries)"];
  for (const entry of doc.components) {
    lines.push(`@@COMPONENT ${entry.component} ${entry.path} BEGIN@@`, `path: ${entry.path}`, `component: ${entry.component}`, `sha256: ${entry.sha256}`, "@@BODY@@", entry.body.replace(/\s+$/, ""), `@@COMPONENT ${entry.component} ${entry.path} END@@`, "");
  }
  lines.push("# Guardrails: PINNED, path + content hash only - contents are never shipped");
  for (const entry of doc.guardrails) {
    lines.push(`@@GUARDRAIL ${entry.path} BEGIN@@`, `path: ${entry.path}`, `sha256: ${entry.sha256}`, PINNED_MARKER, `@@GUARDRAIL ${entry.path} END@@`, "");
  }
  return lines;
}

function renderContrasts(doc: ProposalPackageDocument): string[] {
  const criteria = doc.selection;
  const lines = [
    "# Contrasted trajectory pairs with FULL step logs from the section-5 steps table",
    `selection_window_size: ${criteria.windowSize}`,
    `selection_window_days: ${criteria.windowDays}`,
    `selection_window_method: ${criteria.windowMethod}`,
    `selection_quartile_method: ${criteria.quartileMethod}`,
    `selection_failure_mode_coverage: [${criteria.failureModeCoverage.join(", ")}]`,
    `mode: ${criteria.mode}`,
    `mode_reason: ${criteria.modeReason}`,
    `representative_run_ids: [${criteria.representativeRunIds.join(", ")}]`,
    `pairs_formed: ${criteria.pairsFormed}`,
    "",
  ];
  for (const pair of doc.pairs) lines.push(...renderPair(pair));
  return lines;
}

function metricRow(entry: ProposalPackageDocument["metrics"]["window"]): string {
  return `| ${entry.targetClass} | ${entry.n} | ${entry.successRate} | ${entry.meanVulns} | ${entry.fpRate} | ${entry.meanSteps} | ${entry.meanTokens} | ${entry.crashRate} |`;
}

function renderMetrics(doc: ProposalPackageDocument): string[] {
  const metrics = doc.metrics;
  return [
    "# Aggregate window metrics per target class (N stated)",
    `window_n: ${metrics.windowN}`,
    `window_days: ${metrics.windowDays}`,
    `window_method: ${metrics.windowMethod}`,
    "| target_class | n | success_rate | mean_vulns | fp_rate | mean_steps | mean_tokens | crash_rate |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...metrics.byTargetClass.map(metricRow),
  ];
}

function renderExperience(doc: ProposalPackageDocument): string[] {
  return [
    "# EXPERIENCE.md full text for this class",
    `experience_path: ${doc.experience.path}`,
    `experience_has_file: ${String(doc.experience.hasFile)}`,
    `experience_entries: ${doc.experience.entries.length}`,
    "@@EXPERIENCE BEGIN@@",
    doc.experience.text.replace(/\s+$/, ""),
    "@@EXPERIENCE END@@",
  ];
}

function renderChecklist(checklist: PackageChecklist): string[] {
  return [
    "# Machine-checkable completeness checklist",
    `complete: ${String(checklist.complete)}`,
    `delimiters_balanced: ${String(checklist.delimitersBalanced)}`,
    `delimiter_counts: ${checklist.beginCount} BEGIN / ${checklist.endCount} END`,
    ...checklist.items.map((entry) => `- [${entry.present && entry.nonEmpty ? "x" : " "}] ${entry.id}: ${entry.detail}`),
  ];
}

/** Render sections 1-6 (section 7 needs their delimiter counts first). */
export function renderPackageSections(doc: ProposalPackageDocument): string {
  const lines: string[] = [];
  pushSection(lines, 1, "header", renderHeader(doc));
  pushSection(lines, 2, "components", renderComponents(doc));
  pushSection(lines, 3, "contrasts", renderContrasts(doc));
  pushSection(lines, 4, "metrics", renderMetrics(doc));
  pushSection(lines, 5, "experience", renderExperience(doc));
  pushSection(lines, 6, "constraints", renderConstraintsSection(doc.constraints));
  return lines.join("\n");
}

/** Fill section 7 from the real rendered text (delimiter balance is measured). */
export function finalizePackage(doc: ProposalPackageDocument): ProposalPackageDocument {
  return { ...doc, checklist: buildChecklist(doc, renderPackageSections(doc)) };
}

/** Render the complete seven-section package, ready to paste or chunk. */
export function renderPackageDocument(doc: ProposalPackageDocument): string {
  const finalDoc = doc.checklist.items.length === 0 ? finalizePackage(doc) : doc;
  const lines = [...renderPackageSections(finalDoc).split("\n")];
  pushSection(lines, 7, "checklist", renderChecklist(finalDoc.checklist));
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** Backwards-compatible name for the package renderer. */
export const renderProposalPackage = renderPackageDocument;

export interface WriteProposalPackageResult {
  readonly dir: string;
  readonly markdownPath: string;
  readonly jsonPath: string;
  readonly chunks: number;
}

function atomicWrite(path: string, body: string): void {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, body, "utf8");
  renameSync(temporary, path);
}

/** Write runs/<timestamp>-<class>/package.md + package.json atomically. */
export function writeProposalPackage(paths: Harness2Paths, doc: ProposalPackageDocument): WriteProposalPackageResult {
  const finalDoc = doc.checklist.items.length === 0 ? finalizePackage(doc) : doc;
  const markdown = renderPackageDocument(finalDoc);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = finalDoc.header.targetClass.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
  const packetDir = join(paths.runs, `${stamp}-${slug}`);
  const markdownPath = join(packetDir, "package.md");
  const jsonPath = join(packetDir, "package.json");
  mkdirSync(packetDir, { recursive: true });
  atomicWrite(markdownPath, markdown);
  atomicWrite(jsonPath, `${JSON.stringify(finalDoc, null, 2)}\n`);
  const chunkBytes = Math.max(1, Math.ceil(markdown.length / 15_000));
  return { dir: packetDir, markdownPath, jsonPath, chunks: chunkBytes };
}
