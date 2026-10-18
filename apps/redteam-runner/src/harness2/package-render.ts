/**
 * Harness2 proposal-package rendering + atomic writer (H2-P2a).
 *
 * renderProposalPackage turns a ProposalPackage into the paste-ready markdown
 * Carlos hands to the frontier editor: the instructions verbatim, every
 * component file in a language-tagged fence, compact contrasted-pair tables
 * (metrics summary + up to MAX_TABLE_EVENTS key events per run), the class's
 * lessons and the aggregate metrics.
 *
 * writeProposalPackage writes `runs/<timestamp>-<class>/package.md` and
 * `package.json` atomically (temp file + rename), so a crash never leaves a
 * half-written package the next phase could adopt.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness2Paths, ProposalPackage, TrajectoryRecord } from "./contract.js";

const MAX_TABLE_EVENTS = 6;

function cell(value: string): string {
  const flat = value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

function fenceLanguage(path: string, body: string): string {
  if (body.startsWith("# Directory index:")) return "text";
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "yaml" || extension === "yml") return "yaml";
  if (extension === "ts") return "ts";
  if (extension === "js" || extension === "mjs") return "js";
  if (extension === "md") return "md";
  if (extension === "json") return "json";
  return "text";
}

function pairSummary(label: string, record: TrajectoryRecord): string {
  const metrics = record.metrics;
  const layers = metrics.harness.layerIds.join(", ") || "base";
  return [
    `**${label}** \`${metrics.runId}\` - outcome ${metrics.outcome}, vulns ${metrics.vulnsFound}, false positives ${metrics.falsePositives},`,
    `exploits ${metrics.exploitsSucceeded}/${metrics.exploitsAttempted}, steps ${metrics.steps}, tokens ${metrics.tokensIn} in / ${metrics.tokensOut} out, layers [${layers}]`,
  ].join(" ");
}

function eventTable(label: string, record: TrajectoryRecord): string[] {
  const rows = [...record.events.filter((event) => event.isToolCall), ...record.events].slice(0, MAX_TABLE_EVENTS);
  return rows.map(
    (event) =>
      `| ${label} | ${cell(event.phase)} | ${cell(event.actor)} | ${cell(event.action)} | ${cell(event.attackId ?? "")} | ${cell(event.result)} |`,
  );
}

/** Render the package as the paste-ready markdown Carlos hands to the editor. */
export function renderProposalPackage(pkg: ProposalPackage): string {
  const lines: string[] = [
    `# Harness2 proposal package: ${pkg.targetClass}`,
    "",
    `Base layer set: ${pkg.baseLayerSet.length > 0 ? pkg.baseLayerSet.join(", ") : "(base only)"}`,
    "",
    "## Instructions",
    "",
    pkg.instructions,
    "",
    "## Component files",
    "",
  ];
  for (const entry of pkg.componentFiles) {
    lines.push(`### ${entry.component} - \`${entry.path}\``, "", `\`\`\`${fenceLanguage(entry.path, entry.body)}`, entry.body.replace(/\s+$/, ""), "```", "");
  }
  if (pkg.componentFiles.length === 0) lines.push("(no component sources found: this is a dist-only payload)", "");
  lines.push("## Contrasted trajectories", "");
  if (pkg.pairs.length === 0) lines.push("(no comparable contrast pair is available yet)", "");
  pkg.pairs.forEach((pair, pairIndex) => {
    lines.push(
      `### Pair ${pairIndex + 1}`,
      "",
      pairSummary("positive", pair.positive),
      "",
      pairSummary("negative", pair.negative),
      "",
      "| run | phase | actor | action | attack | result |",
      "| --- | --- | --- | --- | --- | --- |",
      ...eventTable("positive", pair.positive),
      ...eventTable("negative", pair.negative),
      "",
    );
  });
  lines.push("## Experience", "");
  if (pkg.experience.length === 0) {
    lines.push("(no lessons recorded for this class yet)", "");
  } else {
    lines.push("| date | layer | change | reason | measured effect | tokens |", "| --- | --- | --- | --- | --- | --- |");
    for (const entry of pkg.experience) {
      lines.push(
        `| ${entry.date} | ${cell(entry.layerId ?? "general")} | ${cell(entry.change)} | ${cell(entry.reason)} | ${cell(entry.measuredEffect)} | ${entry.tokensSpent} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Metrics", "", "| metric | value |", "| --- | --- |", ...Object.entries(pkg.metrics).map(([key, value]) => `| ${key} | ${value} |`), "");
  return `${lines.join("\n")}\n`;
}

export interface WriteProposalPackageResult {
  readonly dir: string;
  readonly markdownPath: string;
  readonly jsonPath: string;
}

function atomicWrite(path: string, body: string): void {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, body, "utf8");
  renameSync(temporary, path);
}

/** Write runs/<timestamp>-<class>/package.md + package.json atomically. */
export function writeProposalPackage(paths: Harness2Paths, pkg: ProposalPackage): WriteProposalPackageResult {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = pkg.targetClass.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
  const packetDir = join(paths.runs, `${stamp}-${slug}`);
  const markdownPath = join(packetDir, "package.md");
  const jsonPath = join(packetDir, "package.json");
  mkdirSync(packetDir, { recursive: true });
  atomicWrite(markdownPath, renderProposalPackage(pkg));
  atomicWrite(jsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return { dir: packetDir, markdownPath, jsonPath };
}
