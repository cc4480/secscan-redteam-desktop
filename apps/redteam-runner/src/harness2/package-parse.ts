/**
 * Harness2 section-6 package parsing, machine-checkable checklist and
 * completeness validation (H2-P2 spec section 6 section 7 + "old versions stay
 * readable").
 *
 * The package carries explicit section delimiters so completeness is mechanical:
 *   @@SECTION <n> <name> BEGIN@@ ... @@SECTION <n> <name> END@@
 * for all 7 sections in order, plus nested component/pair/step/experience
 * delimiters. splitSections() extracts them, buildChecklist() produces the
 * section-7 field list (every section present/non-empty, delimiter counts
 * balanced) and parsePackageDocument() re-derives the checks from the TEXT, so a
 * truncated or hand-edited package is rejected instead of silently accepted.
 *
 * Compatibility: a package with an older but readable format_version ("5.0",
 * "5", "1") is still returned, with legacy=true and its raw sections; a version
 * this code does not know is rejected. The current version is always written.
 */
import { EDITABLE_COMPONENTS, HARNESS_COMPONENTS } from "./contract.js";
import type { ChecklistItem, PackageChecklist, ProposalPackageDocument } from "./package.js";

/** Current package format. */
export const PACKAGE_FORMAT_VERSION = "6.0";
/** Versions this code can still read (structurally validated only when current). */
export const READABLE_FORMAT_VERSIONS: readonly string[] = ["6.0", "5.0", "5", "1"];
/** Valid header.mode values. */
export const PACKAGE_MODES = ["REPAIR", "HARDEN", "REPAIR-FOUNDATION"] as const;
/** Section order and names; index n-1 holds section n; a complete package has all of them. */
export const SECTION_NAMES: readonly string[] = ["header", "components", "contrasts", "metrics", "experience", "constraints", "checklist"];
export const SECTION_COUNT = SECTION_NAMES.length;
/** A package header key without which the document is not a package. */
export const HEADER_KEYS: readonly string[] = ["package_id", "date", "format_version", "tuner_version", "target_class", "mode", "base_harness_version", "active_layer_set"];

/** Raised when a document is not a readable package at all. */
export class PackageFormatError extends Error {
  constructor(message: string) {
    super(`package rejected: ${message}`);
    this.name = "PackageFormatError";
  }
}

/** Raised when a package exists but is structurally incomplete. */
export class PackageCompletenessError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`package is incomplete: ${problems.join("; ")}`);
    this.name = "PackageCompletenessError";
    this.problems = problems;
  }
}

export function sectionBegin(index: number, name: string): string {
  return `@@SECTION ${index} ${name} BEGIN@@`;
}

export function sectionEnd(index: number, name: string): string {
  return `@@SECTION ${index} ${name} END@@`;
}

/** Any "@@... BEGIN@@" / "@@... END@@" delimiter line. */
export const DELIMITER_LINE = /^@@.*\s(BEGIN|END)@@$/;

export interface DelimiterCount {
  readonly begin: number;
  readonly end: number;
  readonly balanced: boolean;
}

/** Count BEGIN/END delimiter lines; balanced means one of each for every marker. */
export function countDelimiters(text: string): DelimiterCount {
  let begin = 0;
  let end = 0;
  for (const raw of text.split(/\r?\n/)) {
    const match = DELIMITER_LINE.exec(raw.trim());
    if (match === null) continue;
    if (match[1] === "BEGIN") begin++;
    else end++;
  }
  return { begin, end, balanced: begin === end };
}

export interface SectionSplit {
  readonly sections: Readonly<Record<number, string>>;
  readonly order: readonly number[];
  readonly begin: number;
  readonly end: number;
  readonly balanced: boolean;
}

/** Split the top-level sections; nested delimiters stay inside their section body. */
export function splitSections(text: string): SectionSplit {
  const sections: Record<number, string> = {};
  const order: number[] = [];
  let current: { n: number; lines: string[] } | undefined;
  let begin = 0;
  let end = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const start = /^@@SECTION (\d+) ([a-z-]+) BEGIN@@$/.exec(line);
    if (start !== null) {
      begin++;
      const n = Number(start[1]);
      current = { n, lines: [] };
      order.push(n);
      continue;
    }
    const stop = /^@@SECTION (\d+) ([a-z-]+) END@@$/.exec(line);
    if (stop !== null) {
      end++;
      const n = Number(stop[1]);
      if (current !== undefined && current.n === n) {
        sections[n] = current.lines.join("\n");
        current = undefined;
      }
      continue;
    }
    if (current !== undefined) current.lines.push(raw);
  }
  return { sections, order, begin, end, balanced: begin === end };
}

function item(id: string, section: number, present: boolean, nonEmpty: boolean, detail: string): ChecklistItem {
  return { id, section, present, nonEmpty, detail };
}

function componentCheck(doc: ProposalPackageDocument, component: string): ChecklistItem {
  const files = doc.components.filter((entry) => entry.component === component);
  const present = files.length > 0;
  const nonEmpty = present && files.every((entry) => entry.body.length > 0 && entry.sha256.length === 64);
  return item(`section2.component.${component}`, 2, present, nonEmpty, `${files.length} file(s), verbatim bodies with sha256`);
}

/**
 * Build the section-7 checklist from the document plus the rendered section 1-6
 * text (delimiter balance can only be checked against the text).
 */
export function buildChecklist(doc: ProposalPackageDocument, renderedSections: string): PackageChecklist {
  const delimiters = countDelimiters(renderedSections);
  const guardrailsListed = doc.guardrails.length > 0 && doc.guardrails.every((entry) => entry.path !== "" && entry.sha256.length === 64);
  const pairsOk = doc.pairs.length >= 2 && doc.pairs.length <= 3;
  const stepsOk = pairsOk && doc.pairs.every((pair) => pair.high.steps.length > 0 && pair.low.steps.length > 0 && pair.runIdHigh !== "" && pair.runIdLow !== "");
  const items: ChecklistItem[] = [
    item("header.package_id", 1, doc.header.packageId !== "", doc.header.packageId !== "", doc.header.packageId),
    item("header.date", 1, doc.header.date !== "", /^\d{4}-\d{2}-\d{2}$/.test(doc.header.date), doc.header.date),
    item("header.format_version", 1, doc.header.formatVersion !== "", doc.header.formatVersion === PACKAGE_FORMAT_VERSION, doc.header.formatVersion),
    item("header.tuner_version", 1, doc.header.tunerVersion !== "", doc.header.tunerVersion !== "", doc.header.tunerVersion),
    item("header.target_class", 1, doc.header.targetClass !== "", doc.header.targetClass !== "", doc.header.targetClass),
    item("header.mode", 1, true, PACKAGE_MODES.includes(doc.header.mode), doc.header.mode),
    item("header.base_harness_version", 1, doc.header.baseHarnessVersion !== "", doc.header.baseHarnessVersion !== "", doc.header.baseHarnessVersion),
    item("header.active_layer_set", 1, doc.header.activeLayerSet !== undefined, true, doc.header.activeLayerSet.length > 0 ? doc.header.activeLayerSet.join(", ") : "[] (base layer only)"),
    ...EDITABLE_COMPONENTS.map((component) => componentCheck(doc, component)),
    item("section2.guardrails", 2, doc.guardrails.length > 0, guardrailsListed, `${doc.guardrails.length} pinned guardrail(s): path + sha256 + PINNED marker, contents never shipped`),
    item("section3.pairs", 3, pairsOk, stepsOk, `${doc.pairs.length} contrasted pair(s), full step logs from the section-5 steps table`),
    item(
      "section3.selection_criteria",
      3,
      doc.selection.windowSize > 0,
      doc.selection.windowSize > 0 && doc.selection.quartileMethod !== "" && doc.selection.modeReason !== "" && doc.selection.failureModeCoverage.length > 0,
      `window=${doc.selection.windowSize} run(s) (${doc.selection.windowMethod})`,
    ),
    item("section4.metrics", 4, doc.metrics.windowN > 0, doc.metrics.windowN > 0 && doc.metrics.window.n > 0, `N=${doc.metrics.windowN} window means per target class`),
    item("section5.experience", 5, doc.experience.text !== "", doc.experience.text !== "", doc.experience.hasFile ? `${doc.experience.entries.length} dated entry/entries, full text` : "no lessons yet (explicit placeholder)"),
    item(
      "section6.constraints",
      6,
      true,
      doc.constraints.guardrailsPinned && doc.constraints.k === 1 && doc.constraints.proposeOnly && doc.constraints.probeTokenBudget > 0,
      `pinned, k=${doc.constraints.k}, propose-only, budget=${doc.constraints.probeTokenBudget} tokens`,
    ),
    item("delimiters.balanced", 7, true, delimiters.balanced, `${delimiters.begin} BEGIN / ${delimiters.end} END`),
    item("section7.checklist", 7, true, true, "this machine-checkable list"),
  ];
  return { items, complete: items.every((entry) => entry.present && entry.nonEmpty), delimitersBalanced: delimiters.balanced, beginCount: delimiters.begin, endCount: delimiters.end };
}

/** Parsed view of a package text; `complete` is true only for a valid current package. */
export interface ParsedPackageDocument {
  readonly formatVersion: string;
  readonly legacy: boolean;
  readonly header: Readonly<Record<string, string>>;
  readonly sections: Readonly<Record<number, string>>;
  readonly checklist: PackageChecklist | null;
  readonly complete: boolean;
  readonly problems: readonly string[];
}

function parseHeader(text: string): Record<string, string> {
  const header: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const match = /^([a-z_]+):\s*(.*?)\s*$/.exec(raw.trim());
    if (match !== null) header[match[1]!] = match[2]!;
  }
  return header;
}

function parseChecklist(section: string): PackageChecklist | null {
  const items: ChecklistItem[] = [];
  let delimitersBalanced = false;
  let beginCount = 0;
  let endCount = 0;
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    const entry = /^- \[([xX ])\] ([a-z0-9._-]+): (.*)$/.exec(line);
    if (entry !== null) {
      const ok = (entry[1] ?? "").toLowerCase() === "x";
      items.push({ id: entry[2]!, section: 0, present: ok, nonEmpty: ok, detail: entry[3] ?? "" });
      continue;
    }
    const balance = /^delimiters_balanced:\s*(true|false)/.exec(line);
    if (balance !== null) delimitersBalanced = balance[1] === "true";
    const counts = /^delimiter_counts:\s*(\d+)\s+BEGIN\s*\/\s*(\d+)\s+END/.exec(line);
    if (counts !== null) {
      beginCount = Number(counts[1]);
      endCount = Number(counts[2]);
    }
  }
  if (items.length === 0) return null;
  return { items, complete: items.every((entry) => entry.present && entry.nonEmpty), delimitersBalanced, beginCount, endCount };
}

function distinctComponents(section: string): number {
  const found = new Set<string>();
  for (const raw of section.split(/\r?\n/)) {
    const match = /^@@COMPONENT (\S+) /.exec(raw.trim());
    if (match !== null) found.add(match[1]!);
  }
  return found.size;
}

function countMarkers(section: string, pattern: RegExp): number {
  let count = 0;
  for (const raw of section.split(/\r?\n/)) if (pattern.test(raw.trim())) count++;
  return count;
}

/**
 * Parse a package document, re-deriving completeness from the text. Legacy
 * versions return their raw sections with legacy=true instead of throwing.
 */
export function parsePackageDocument(text: string): ParsedPackageDocument {
  if (typeof text !== "string" || text.trim() === "") throw new PackageFormatError("the document was empty");
  const split = splitSections(text);
  const version = parseHeader(split.sections[1] ?? text)["format_version"];
  if (version === undefined) throw new PackageFormatError("missing format_version; this is not a section-6 package");
  if (!READABLE_FORMAT_VERSIONS.includes(version)) {
    throw new PackageFormatError(`unsupported format_version ${version}; this code reads ${READABLE_FORMAT_VERSIONS.join(", ")}`);
  }
  const header = parseHeader(split.sections[1] ?? text);
  const legacy = version !== PACKAGE_FORMAT_VERSION;
  if (legacy) {
    return { formatVersion: version, legacy: true, header, sections: split.sections, checklist: null, complete: false, problems: [`legacy format ${version}: structure is readable but not checklist-verified`] };
  }
  const problems: string[] = [];
  for (let index = 1; index <= SECTION_COUNT; index++) {
    const body = split.sections[index];
    if (body === undefined) problems.push(`section ${index} (${SECTION_NAMES[index - 1]}) is missing`);
    else if (body.trim() === "") problems.push(`section ${index} (${SECTION_NAMES[index - 1]}) is empty`);
  }
  for (const key of HEADER_KEYS) if ((header[key] ?? "") === "") problems.push(`header field ${key} is missing`);
  const headerMode = header["mode"] ?? "";
  if (headerMode !== "" && !(PACKAGE_MODES as readonly string[]).includes(headerMode)) problems.push(`header mode ${headerMode} is not one of ${PACKAGE_MODES.join("|")}`);
  if (!split.balanced) problems.push(`section delimiters are unbalanced (${split.begin} BEGIN / ${split.end} END)`);
  if (split.order.length !== SECTION_COUNT || split.order.some((n, index) => n !== index + 1)) problems.push(`sections are not exactly 1..${SECTION_COUNT} in order`);
  const components = split.sections[2] ?? "";
  if (distinctComponents(components) !== EDITABLE_COMPONENTS.length) problems.push(`section 2 does not hold all ${EDITABLE_COMPONENTS.length} editable components`);
  if (!components.includes("PINNED - DO NOT PROPOSE CHANGES")) problems.push("section 2 is missing the PINNED - DO NOT PROPOSE CHANGES marker");
  const contrasts = split.sections[3] ?? "";
  const pairCount = countMarkers(contrasts, /^@@PAIR \d+ BEGIN@@$/);
  if (pairCount < 2 || pairCount > 3) problems.push(`section 3 holds ${pairCount} pair(s); 2-3 are required`);
  if (!/@STEP \d+ BEGIN@@/.test(contrasts)) problems.push("section 3 holds no full step log");
  const metrics = split.sections[4] ?? "";
  const windowN = /^window_n:\s*(\d+)\s*$/m.exec(metrics);
  if (windowN === null || Number(windowN[1]) <= 0) problems.push("section 4 does not state a positive window_n (N)");
  const constraints = split.sections[6] ?? "";
  for (const required of ["guardrails_pinned: true", "k: 1", "propose_only: true", "probe_token_budget:"]) {
    if (!constraints.includes(required)) problems.push(`section 6 is missing constraint "${required}"`);
  }
  const checklist = parseChecklist(split.sections[7] ?? "");
  if (checklist === null) problems.push("section 7 checklist is missing");
  else if (!checklist.complete) problems.push("section 7 checklist has unchecked items");
  return {
    formatVersion: version,
    legacy: false,
    header,
    sections: split.sections,
    checklist,
    complete: problems.length === 0,
    problems,
  };
}

/** Throw when a parsed package is structurally incomplete (section-10 partial rejection). */
export function assertPackageComplete(parsed: ParsedPackageDocument): void {
  if (!parsed.complete) throw new PackageCompletenessError(parsed.problems);
}

/** True when the package names the pinned guardrail component at all. */
export function mentionsGuardrailComponent(text: string): boolean {
  return new RegExp(`component:\\s*${HARNESS_COMPONENTS.guardrails}`, "i").test(text);
}