/**
 * Harness2 probe CLI wiring + the real runner seam (H2-P2b).
 *
 * `proposeCommand` / `probeCommand` are the two on-demand commands this phase
 * owns. They are exported from here (not added to harness2/cli.ts, which H2-P1b
 * owns); the wiring needed in harness2/cli.ts is reported with this task.
 *
 * propose is ALWAYS propose-only: it validates a Proposal JSON, re-checks the
 * pinned guardrails and records it under paths.runs/<id>/proposal.json. It never
 * installs, never activates and never probes.
 *
 * probe runs the offline probe (./probe.ts) through the seam below. Without
 * `--approve` the verdict can never be adopted (propose-only); with it, a
 * measurably better candidate gets adopted: true - installation/activation is
 * still P3's adoptVerdict, never this command.
 *
 * ---------------------------------------------------------------------------
 * THE RUNNER SEAM, HONESTLY
 * ---------------------------------------------------------------------------
 * The probe's executor is injectable: `probeProposal` takes
 * `runEngagement(input, layerIds) => RunMetrics`, so tests need no model and the
 * CLI wires the real runner here. Two facts about layer mounting:
 *
 * 1. Runner 0.37.1 CANNOT mount a patch layer into an engagement. The harness
 *    is compiled source (src/prompts.ts, src/agents.ts, ...). harness-stamp.ts
 *    takes `layerIds` from DSH_HARNESS2_LAYERS, but that variable is a STAMP
 *    ONLY - nothing reads a composition manifest. Running runEngagement with a
 *    layer id would measure the BASE harness wearing the candidate's name, and
 *    the verdict would compare two identical runs. So this seam REFUSES a
 *    non-empty layer set until a real mount exists; it never fakes one.
 * 2. The exact integration point a real mount needs:
 *    a. src/phases/run.ts: add `harnessLayers?: readonly string[]` to RunOptions.
 *    b. In runEngagement, before resolveConfig()/ctx creation, mount the
 *       composed layer set into the harness the engagement actually runs: a
 *       composed dsh patch overlay (packages/boot/app-boot: loadOverlayPatches /
 *       boot({ overlayPaths }), or the same YAML as a profile layer / --patch
 *       file) applied to that engagement's harness.
 *    c. Pass the SAME ids through the finish path:
 *       captureEngagementTrajectory({ ..., layers: opts.harnessLayers }) ->
 *       buildHarnessStamp({ layerIds }), so trajectory.json stamps the
 *       composition that actually ran, not the intended one.
 *    d. Wire the function that performs (b) as `mountLayers` below. The seam
 *       also VERIFIES the stamp: a run whose metrics.json layerIds differ from
 *       what was requested is refused, never compared.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runEngagement, type RunOptions } from "../phases.js";
import {
  EDITABLE_COMPONENTS,
  PINNED_COMPONENT,
  resolveHarness2Paths,
  type Harness2Paths,
  type Proposal,
  type RunMetrics,
} from "./contract.js";
import { checkLayerGuardrails, layerDir } from "./layers.js";
import { probeProposal, type ProbeRunFn, type ProbeRunInput } from "./probe.js";

/** The exact runner change a real layer mount needs; thrown verbatim by the seam. */
export const LAYER_MOUNT_INTEGRATION_POINT = [
  "[harness2] refusing to probe a layer set: runner 0.37.1 has no harness-composition mount,",
  "so a candidate layer cannot be applied to an engagement and a probe would compare the",
  "base harness against itself. Integration point:",
  "  1. src/phases/run.ts RunOptions gains `harnessLayers?: readonly string[]`;",
  "  2. runEngagement mounts the composed layer set before resolveConfig()/ctx creation",
  "     (a composed dsh patch overlay via packages/boot/app-boot loadOverlayPatches /",
  "     boot({ overlayPaths }), or the same YAML as a profile layer / --patch file);",
  "  3. the same ids reach captureEngagementTrajectory -> buildHarnessStamp({ layerIds })",
  "     so trajectory.json stamps the mounted composition, not the intended one;",
  "  4. that mount function is passed to createRunnerProbeSeam as `mountLayers`.",
  "DSH_HARNESS2_LAYERS is a stamp only; it does not mount anything.",
].join("\n");

export interface RunnerProbeSeam {
  readonly runEngagement: ProbeRunFn;
  readonly assertLayersMountable: (layerIds: readonly string[]) => void;
}

export interface RunnerProbeSeamOptions {
  readonly paths: Harness2Paths;
  /** Where probe engagements are written; defaults to <paths.runs>/probe-engagements. */
  readonly engagementsDir?: string;
  /** Runner options for every probe run (max actions, dry-run, ...). */
  readonly runOptions?: Omit<RunOptions, "engagementsDir" | "engagementId">;
  /**
   * The real mount step (see LAYER_MOUNT_INTEGRATION_POINT). Absent => non-empty
   * layer sets are refused before any run. The probe never assumes a mount.
   */
  readonly mountLayers?: (layerIds: readonly string[]) => void;
}

/** Read the metrics.json H2-P1a wrote for a finished probe engagement. */
function readProbeMetrics(engagementDir: string, engagementId: string): RunMetrics {
  const path = join(engagementDir, "metrics.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (err) {
    throw new Error(`[harness2] probe seam: engagement ${engagementId} produced no readable ${path}: ${(err as Error).message}`);
  }
  if (raw === null || typeof raw !== "object") throw new Error(`[harness2] probe seam: ${path} is not an object`);
  const metrics = raw as RunMetrics;
  // A run's harness stamp must prove the composition we asked for. With no mount
  // implemented the only legitimate request is the empty set, so a stamped layer
  // id (e.g. a stray DSH_HARNESS2_LAYERS) is a hard refusal rather than a metric.
  const stamped = (metrics.harness?.layerIds ?? []).join(",");
  if (stamped !== "") {
    throw new Error(
      `[harness2] probe seam: engagement ${engagementId} stamped unmounted layers [${stamped}]; ` +
        "refusing to compare a run whose composition cannot be proven",
    );
  }
  return metrics;
}

/**
 * Wire the real runner as the probe executor. `assertLayersMountable` is called
 * by probeProposal BEFORE any run, so the CLI refuses cleanly (no tokens spent)
 * while the runner has no mount.
 */
export function createRunnerProbeSeam(options: RunnerProbeSeamOptions): RunnerProbeSeam {
  const engagementsDir = options.engagementsDir ?? join(options.paths.runs, "probe-engagements");
  const mountLayers = options.mountLayers;
  function assertLayersMountable(layerIds: readonly string[]): void {
    if (layerIds.length === 0) return;
    if (mountLayers === undefined) throw new Error(LAYER_MOUNT_INTEGRATION_POINT);
  }
  async function runOne(input: ProbeRunInput, layerIds: readonly string[]): Promise<RunMetrics> {
    assertLayersMountable(layerIds);
    if (layerIds.length > 0) mountLayers?.(layerIds);
    await runEngagement(input, { ...options.runOptions, engagementsDir, engagementId: input.engagementId });
    return readProbeMetrics(join(engagementsDir, input.engagementId), input.engagementId);
  }
  return { runEngagement: runOne, assertLayersMountable };
}

// ---------------------------------------------------------------------------
// CLI handlers (wiring: harness2/cli.ts dispatch, see the task report)
// ---------------------------------------------------------------------------

export interface ProbeCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const DEFAULT_IO: ProbeCliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

interface ParsedCommand {
  readonly flags: ReadonlyMap<string, string>;
  readonly booleans: ReadonlySet<string>;
}

function parseCommand(argv: readonly string[], allowed: readonly string[], boolFlags: readonly string[] = []): ParsedCommand {
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (!arg.startsWith("--")) throw new Error(`unexpected argument "${arg}"`);
    const [name, inline] = arg.slice(2).split("=", 2);
    if (name === undefined || name === "") throw new Error(`malformed option "${arg}"`);
    if (!allowed.includes(name)) throw new Error(`unknown option --${name}`);
    if (boolFlags.includes(name)) {
      booleans.add(name);
      continue;
    }
    const value = inline ?? argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`option --${name} needs a value`);
    flags.set(name, value);
  }
  return { flags, booleans };
}

function nonEmptyField(record: Record<string, unknown>, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`proposal field "${name}" must be a non-empty string`);
  return value;
}

/** Read and validate a Proposal JSON written by the P2a package flow. */
export function readProposalFile(path: string): Proposal {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (err) {
    throw new Error(`proposal file is not valid JSON: ${path} (${(err as Error).message})`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`proposal file must be a JSON object: ${path}`);
  const record = raw as Record<string, unknown>;
  const component = nonEmptyField(record, "component");
  if (!(EDITABLE_COMPONENTS as readonly string[]).includes(component)) {
    throw new Error(
      `proposal component must be editable (${EDITABLE_COMPONENTS.join(", ")}); ` +
        `"${component}" is not - ${PINNED_COMPONENT} is pinned`,
    );
  }
  return {
    id: nonEmptyField(record, "id"),
    targetClass: nonEmptyField(record, "targetClass"),
    component: component as Proposal["component"],
    yaml: nonEmptyField(record, "yaml"),
    rationale: typeof record["rationale"] === "string" ? record["rationale"] : "",
  };
}

function atomicWriteJson(path: string, body: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    writeFileSync(tmp, body);
    try {
      renameSync(tmp, path);
    } catch {
      rmSync(path, { force: true });
      renameSync(tmp, path);
    }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

/** `harness2 propose --proposal <proposal.json>`: validate + record. Never adopts. */
export function proposeCommand(argv: readonly string[], io: ProbeCliIo = DEFAULT_IO, environment: NodeJS.ProcessEnv = process.env): number {
  try {
    const parsed = parseCommand(argv, ["proposal"]);
    const proposalPath = parsed.flags.get("proposal");
    if (proposalPath === undefined) throw new Error("propose needs --proposal <proposal.json>");
    const proposal = readProposalFile(proposalPath);
    const guardrails = checkLayerGuardrails(proposal.yaml);
    if (!guardrails.allowed) {
      throw new Error(`[harness2] proposal "${proposal.id}" targets pinned guardrails (${guardrails.pinned.join(", ")}); refused`);
    }
    const paths = resolveHarness2Paths(environment);
    layerDir(paths, proposal.id); // validates the id as a usable layer id before recording it
    const dir = join(paths.runs, proposal.id);
    mkdirSync(dir, { recursive: true });
    const stored = join(dir, "proposal.json");
    atomicWriteJson(stored, JSON.stringify(proposal, null, 2));
    io.out(
      JSON.stringify(
        {
          proposalId: proposal.id,
          stored,
          proposeOnly: true,
          next: `harness2 probe --proposal "${stored}" --targets <probe-targets.json>`,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (err) {
    io.err(`harness2: ${(err as Error).message}`);
    return 1;
  }
}

/** `harness2 probe --proposal P --targets T [--runs N] [--approve]`: measure only. */
export async function probeCommand(
  argv: readonly string[],
  io: ProbeCliIo = DEFAULT_IO,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    const parsed = parseCommand(argv, ["proposal", "targets", "runs"], ["approve"]);
    const proposalPath = parsed.flags.get("proposal");
    if (proposalPath === undefined) throw new Error("probe needs --proposal <proposal.json>");
    const runsRaw = parsed.flags.get("runs");
    const runsPerSide = runsRaw === undefined ? undefined : Number(runsRaw);
    if (runsPerSide !== undefined && (!Number.isInteger(runsPerSide) || runsPerSide < 1)) {
      throw new Error(`--runs must be a positive integer (got "${runsRaw}")`);
    }
    const proposal = readProposalFile(proposalPath);
    const paths = resolveHarness2Paths(environment);
    const seam = createRunnerProbeSeam({ paths });
    const verdict = await probeProposal({
      paths,
      proposal,
      targetsFile: parsed.flags.get("targets"),
      runEngagement: seam.runEngagement,
      assertLayersMountable: seam.assertLayersMountable,
      runsPerSide,
      approve: parsed.booleans.has("approve"),
    });
    io.out(JSON.stringify(verdict, null, 2));
    io.out(
      verdict.adopted
        ? "probe recommends adoption; nothing is active yet - run the P3 adopt flow (adoptVerdict)"
        : "probe-only: no layer was adopted",
    );
    return 0;
  } catch (err) {
    io.err(`harness2: ${(err as Error).message}`);
    return 1;
  }
}
