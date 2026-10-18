/**
 * Harness2 CLI (H2-P1b): on-demand queries against the trajectory store.
 *
 *   harness2 ingest --engagement <dir>     ingest one engagement directory
 *   harness2 ingest --root <tree>          ingest every new/changed run under a tree
 *   harness2 ingest-root [--root <tree>]   same, defaulting to ./engagements
 *   harness2 list [--class C] [--outcome O] [--limit N]
 *   harness2 get <runId>
 *   harness2 stats
 *
 * No daemon: every command opens the database, answers and exits. JSON for
 * detail output, a small ASCII table for list. Bad input exits 1 with a message
 * on stderr; handlers are exported so behavior is testable without a subprocess.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveHarness2Paths, type RunOutcome } from "./contract.js";
import { openHarness2Store } from "./store.js";
import type { Harness2Store, RunRow } from "./store-model.js";
import { ingestEngagementDir } from "./ingest.js";
import { ingestRoot } from "./walk.js";

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const DEFAULT_IO: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

const OUTCOMES: readonly RunOutcome[] = ["success", "partial", "failure", "aborted"];
const TABLE_HEADERS = ["RUN ID", "CLASS", "OUTCOME", "VULNS", "STEPS", "TOKENS IN", "TOKENS OUT", "FINISHED"] as const;

const USAGE = [
  "usage: harness2 <command> [options]",
  "  ingest --engagement <dir>     ingest one engagement directory",
  "  ingest --root <tree>          ingest new/changed runs under an engagement tree",
  "  ingest-root [--root <tree>]   same, defaulting to ./engagements",
  "  list [--class C] [--outcome O] [--limit N]",
  "  get <runId>",
  "  stats",
].join("\n");

/** Positional arguments and `--flag value` / `--flag=value` options. */
interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split("=", 2);
    if (name === undefined || name === "") throw new Error(`malformed option "${arg}"`);
    const value = inline ?? argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`option --${name} needs a value`);
    flags.set(name, value);
  }
  return { positionals, flags };
}

/** Reject options a command does not understand, so typos cannot be silently ignored. */
function takeFlags(parsed: ParsedArgs, allowed: readonly string[]): void {
  for (const name of parsed.flags.keys()) {
    if (!allowed.includes(name)) throw new Error(`unknown option --${name} for this command`);
  }
}

function requireNoPositionals(parsed: ParsedArgs, command: string): void {
  if (parsed.positionals.length > 0) {
    throw new Error(`${command} takes no positional arguments (got "${parsed.positionals[0]}")`);
  }
}

function formatRunTable(runs: readonly RunRow[]): string {
  const rows = runs.map((run) => [
    run.runId,
    run.targetClass,
    run.outcome,
    String(run.vulnsFound),
    String(run.steps),
    String(run.tokensIn),
    String(run.tokensOut),
    run.finishedAt,
  ]);
  const widths = TABLE_HEADERS.map((header, column) => {
    const cellWidths = rows.map((row) => (row[column] ?? "").length);
    return Math.max(header.length, ...cellWidths);
  });
  const render = (cells: readonly string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd();
  const underline = widths.map((width) => "-".repeat(width));
  return [render(TABLE_HEADERS), render(underline), ...rows.map(render)].join("\n");
}

export function runIngestCommand(store: Harness2Store, parsed: ParsedArgs, io: CliIo): number {
  takeFlags(parsed, ["root", "engagement"]);
  requireNoPositionals(parsed, "ingest");
  const engagement = parsed.flags.get("engagement");
  if (engagement !== undefined) {
    io.out(JSON.stringify(ingestEngagementDir(store, engagement), null, 2));
    return 0;
  }
  const root = parsed.flags.get("root");
  if (root === undefined) throw new Error("ingest needs --engagement <dir> or --root <engagement tree>");
  io.out(JSON.stringify(ingestRoot(store, root), null, 2));
  return 0;
}

export function runIngestRootCommand(store: Harness2Store, parsed: ParsedArgs, io: CliIo): number {
  takeFlags(parsed, ["root"]);
  requireNoPositionals(parsed, "ingest-root");
  const root = parsed.flags.get("root") ?? join(process.cwd(), "engagements");
  io.out(JSON.stringify(ingestRoot(store, root), null, 2));
  return 0;
}

export function runListCommand(store: Harness2Store, parsed: ParsedArgs, io: CliIo): number {
  takeFlags(parsed, ["class", "outcome", "limit"]);
  requireNoPositionals(parsed, "list");
  const limitRaw = parsed.flags.get("limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`--limit must be a positive integer (got "${limitRaw}")`);
  }
  const outcomeRaw = parsed.flags.get("outcome");
  if (outcomeRaw !== undefined && !OUTCOMES.includes(outcomeRaw as RunOutcome)) {
    throw new Error(`--outcome must be one of ${OUTCOMES.join(", ")} (got "${outcomeRaw}")`);
  }
  const runs = store.listRuns({
    targetClass: parsed.flags.get("class"),
    outcome: outcomeRaw as RunOutcome | undefined,
    limit,
  });
  if (runs.length === 0) {
    io.out("no runs ingested yet");
    return 0;
  }
  io.out(formatRunTable(runs));
  return 0;
}

export function runGetCommand(store: Harness2Store, parsed: ParsedArgs, io: CliIo): number {
  takeFlags(parsed, []);
  const runId = parsed.positionals[0];
  if (runId === undefined) throw new Error("get needs a run id");
  if (parsed.positionals.length > 1) throw new Error(`get takes one run id (got "${parsed.positionals.length}")`);
  const detail = store.getRun(runId);
  if (detail === null) {
    io.err(`harness2: no run "${runId}"`);
    return 1;
  }
  io.out(JSON.stringify(detail, null, 2));
  return 0;
}

export function runStatsCommand(store: Harness2Store, parsed: ParsedArgs, io: CliIo): number {
  takeFlags(parsed, []);
  requireNoPositionals(parsed, "stats");
  io.out(JSON.stringify(store.runStats(), null, 2));
  return 0;
}

/** Dispatch one command line. Returns the process exit code; never exits the process itself. */
export function dispatchCli(
  argv: readonly string[],
  io: CliIo = DEFAULT_IO,
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const command = argv[0];
  if (command === undefined || command === "" || command === "help" || command === "--help") {
    io.out(USAGE);
    return command === undefined || command === "" ? 1 : 0;
  }
  const handlers: Readonly<Record<string, (store: Harness2Store, parsed: ParsedArgs, out: CliIo) => number>> = {
    ingest: runIngestCommand,
    "ingest-root": runIngestRootCommand,
    list: runListCommand,
    get: runGetCommand,
    stats: runStatsCommand,
  };
  const handler = handlers[command];
  if (handler === undefined) {
    io.err(`harness2: unknown command "${command}"\n${USAGE}`);
    return 1;
  }
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv.slice(1));
  } catch (err) {
    io.err(`harness2: ${(err as Error).message}`);
    return 1;
  }
  let store: Harness2Store;
  try {
    store = openHarness2Store(resolveHarness2Paths(environment));
  } catch (err) {
    io.err(`harness2: cannot open store: ${(err as Error).message}`);
    return 1;
  }
  try {
    return handler(store, parsed, io);
  } catch (err) {
    io.err(`harness2: ${(err as Error).message}`);
    return 1;
  } finally {
    store.close();
  }
}

// Direct execution (`node dist/harness2/cli.js ...`), not import from tests.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = dispatchCli(process.argv.slice(2));
}
