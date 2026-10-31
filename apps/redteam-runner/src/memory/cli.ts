/**
 * Memory CLI handlers (brief §2.1), dispatched from `src/cli/commands.ts`:
 *
 *   redteam-runner memory status
 *   redteam-runner memory diff show <diffId>
 *   redteam-runner memory approve <diffId> --operator <name> [--ops <opId,...>] [--note "<text>"]
 *   redteam-runner memory apply <diffId>
 *   redteam-runner memory reject <diffId> --operator <name> [--note "<text>"]
 *   redteam-runner memory reindex
 *
 * Handlers return `{ code, lines }` instead of printing, so they are
 * testable without a process. Approval is a named-human act (§7.3):
 * there is no agent tool and no console button for it, by design.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyDiff, approveDiff, readDiff, rejectDiff } from "./apply.js";
import { MemoryError } from "./errors.js";
import { resolveMemoryPaths } from "./paths.js";
import type { MemoryPaths } from "./paths.js";
import { openMemoryStore, reindexMemoryStore } from "./store.js";
import { readViewsIndex } from "./views.js";

export interface MemoryCliResult {
  code: number;
  lines: string[];
}

/**
 * Resolve the memory root for CLI use: `--memory-root` override →
 * `REDTEAM_MEMORY_ROOT` → sibling of the registry file (the §3.1 rule,
 * resolved the same way `phases/config.ts` resolves the registry path —
 * memory CLI ops are operator tooling and never gate on a model key).
 * An empty-string env value is a misconfiguration and fails loud.
 *
 * @param env - The process environment.
 * @param override - The `--memory-root` flag value, when given.
 * @returns The memory root path.
 */
export function resolveMemoryRootFromEnv(env: NodeJS.ProcessEnv, override?: string): string {
  if (override) return override;
  const raw = env["REDTEAM_MEMORY_ROOT"];
  if (raw !== undefined) {
    if (raw.trim() === "") {
      throw new MemoryError("SCHEMA_INVALID", "REDTEAM_MEMORY_ROOT is set but empty — misconfiguration fails loud");
    }
    return raw;
  }
  const registryPath = env["REDTEAM_HOME"]
    ? join(env["REDTEAM_HOME"], "engagements", "registry.json")
    : join(process.cwd(), "engagements", "registry.json");
  return join(dirname(registryPath), "memory");
}

const USAGE = [
  "Usage:",
  "  redteam-runner memory status [--memory-root <dir>]",
  "  redteam-runner memory diff show <diffId>",
  "  redteam-runner memory approve <diffId> --operator <name> [--ops <opId,...>] [--note \"<text>\"]",
  "  redteam-runner memory apply <diffId>",
  "  redteam-runner memory reject <diffId> --operator <name> [--note \"<text>\"]",
  "  redteam-runner memory reindex",
];

function flagValue(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function positionals(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      i += 1; // skip the flag's value
      continue;
    }
    out.push(token);
  }
  return out;
}

function statusLines(paths: MemoryPaths): string[] {
  if (!existsSync(paths.root)) return [`memory store: not initialized at ${paths.root}`];
  const store = openMemoryStore(paths);
  const lines: string[] = [
    `memory store: ${paths.root}`,
    `store id: ${store.manifest.storeId} · created ${store.manifest.createdAt}${store.bootstrapped ? " · bootstrapped by this call" : ""}`,
  ];
  const byStatus = new Map<string, number>();
  for (const entry of store.listUnitsWithStatus()) byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + 1);
  lines.push(
    `units: ${store.manifest.unitCount} (${[...byStatus.entries()].map(([s, n]) => `${s} ${n}`).join(" · ") || "none"}) · versions ${store.manifest.versionCount}`,
  );
  const index = readViewsIndex(paths);
  for (const entry of Object.values(index.dirs).sort((a, b) => (a.dir < b.dir ? -1 : 1))) {
    lines.push(
      `views ${entry.dir}: ${entry.coveredUnits}/${entry.totalUnits} covered · ${entry.pendingUnitChanges} pending · ${entry.stale ? "STALE" : "fresh"}`,
    );
  }
  let pendingDiffs = 0;
  if (existsSync(paths.proposalsDir)) {
    for (const file of readdirSync(paths.proposalsDir)) {
      if (!file.endsWith(".json") || file.includes(".approval.") || file.includes(".apply.")) continue;
      try {
        const diff = JSON.parse(readFileSync(join(paths.proposalsDir, file), "utf8")) as { status?: string };
        if (diff.status === "proposed") pendingDiffs += 1;
      } catch {
        lines.push(`proposals/${file}: UNPARSEABLE`);
      }
    }
  }
  lines.push(`diffs awaiting approval: ${pendingDiffs}`);
  if (existsSync(paths.archivesDir)) {
    for (const engagementId of readdirSync(paths.archivesDir).sort()) {
      const engagementDir = join(paths.archivesDir, engagementId);
      for (const archive of readdirSync(engagementDir).sort()) {
        const dir = join(engagementDir, archive);
        if (!existsSync(join(dir, ".done")) && !existsSync(join(dir, ".failed"))) {
          lines.push(`INCOMPLETE archive: ${engagementId}/${archive} (no .done/.failed marker)`);
        }
      }
    }
  }
  return lines;
}

/**
 * Run one `memory` subcommand.
 *
 * @param argv - Arguments after `memory` (process.argv.slice(3)).
 * @param env - The process environment (root resolution).
 * @param nowIso - Timestamp for mutations and receipts.
 * @returns The exit code and the lines to print.
 */
export function runMemoryCommand(argv: string[], env: NodeJS.ProcessEnv, nowIso: string): MemoryCliResult {
  try {
    const paths = resolveMemoryPaths(resolveMemoryRootFromEnv(env, flagValue(argv, "--memory-root")));
    const [sub, ...rest] = positionals(argv);
    switch (sub) {
      case "status":
        return { code: 0, lines: statusLines(paths) };
      case "reindex": {
        const receipt = reindexMemoryStore(paths, nowIso);
        return {
          code: 0,
          lines: [`reindex complete: ${receipt.unitsChecked} unit version(s) checked, dirs refreshed: ${receipt.dirsRefreshed.join(", ") || "none"}`, `receipt: ${receipt.receiptPath}`],
        };
      }
      case "diff": {
        const [action, diffId] = rest;
        if (action !== "show" || !diffId) return { code: 2, lines: USAGE };
        const diff = readDiff(paths, diffId);
        return { code: 0, lines: [JSON.stringify(diff, null, 2)] };
      }
      case "approve": {
        const [diffId] = rest;
        const operator = flagValue(argv, "--operator");
        if (!diffId || !operator) return { code: 2, lines: USAGE };
        const ops = flagValue(argv, "--ops");
        const record = approveDiff(paths, diffId, {
          operator,
          ...(ops ? { opIds: ops.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
          ...(flagValue(argv, "--note") ? { note: flagValue(argv, "--note") } : {}),
          nowIso,
        });
        return { code: 0, lines: [`approved diff ${diffId} by ${record.approver}: ops ${record.opIds.join(", ") || "none"} (sha256 ${record.diffSha256})`] };
      }
      case "apply": {
        const [diffId] = rest;
        if (!diffId) return { code: 2, lines: USAGE };
        const receipt = applyDiff(paths, diffId, nowIso);
        return {
          code: 0,
          lines: [
            `applied ${receipt.applied.length} op(s), skipped ${receipt.skipped.length} — approver ${receipt.approver}`,
            ...receipt.applied.map((a) => `  applied ${a.opId}: ${a.unitId} v${a.version} ${a.afterHash.slice(0, 12)}…`),
            ...receipt.skipped.map((s) => `  skipped ${s.opId}: ${s.reason}`),
          ],
        };
      }
      case "reject": {
        const [diffId] = rest;
        const operator = flagValue(argv, "--operator");
        if (!diffId || !operator) return { code: 2, lines: USAGE };
        const record = rejectDiff(paths, diffId, {
          operator,
          ...(flagValue(argv, "--note") ? { note: flagValue(argv, "--note") } : {}),
          nowIso,
        });
        return { code: 0, lines: [`rejected diff ${diffId} by ${record.approver}; no unit changes`] };
      }
      default:
        return { code: 2, lines: USAGE };
    }
  } catch (err) {
    if (err instanceof MemoryError) return { code: 1, lines: [`error [${err.code}]: ${err.message}`] };
    return { code: 1, lines: [`error: ${err instanceof Error ? err.message : String(err)}`] };
  }
}
