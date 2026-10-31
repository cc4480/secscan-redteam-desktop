/**
 * Engagement lifecycle wiring (brief §7.1): the three moments memory
 * touches a run — open (before any agent acts), recall (start pack after
 * authorization, refresh pack after recon), and commit (in the finally,
 * after trajectory capture). Also owns the adapter from the real store
 * to recall's `MemoryRecallStore` seam.
 *
 * The session lives in a WeakMap keyed by the run context until the
 * §2.3 `Ctx.memory` field lands; `memoryStateFor` is the read path
 * either way. Blocked runs (authorization denied) still archive: their
 * scope is the unverified host set, recall is recorded as
 * `skipped-authorization-denied`, and no pack is assembled.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Ctx } from "../context.js";
import { resolveHarness2Paths } from "../harness2/contract.js";
import { readExperienceReport } from "../harness2/experience-record.js";
import { readSteps } from "../harness2/steps.js";
import { deriveTargetClass } from "../harness2/trajectory.js";
import { loadRegistryFile, type RegistryEntry } from "../registry.js";
import { commitEngagementMemory } from "./commit.js";
import type { CollapseCandidate } from "./collapse.js";
import { MemoryError } from "./errors.js";
import { resolveMemoryPaths, type MemoryPaths } from "./paths.js";
import { assembleMemoryPack, type LegacyExperienceSlice, type MemoryRecallStore } from "./recall.js";
import { computeUnitId, sha256OfText } from "./schema.js";
import { deriveMemoryScope, normalizeHost, scopeKeyForClass, scopeKeyForHosts } from "./scope.js";
import { openMemoryStore, type MemoryStore } from "./store.js";
import { sourceKeyFor } from "./trust.js";
import type {
  MemoryEngagementReceipt,
  MemoryEngagementState,
  MemoryPackResult,
  MemoryScope,
  MemoryUnit,
  RecallReceipt,
} from "./types.js";
import {
  VIEW_GENERATOR_VERSION,
  atomicWriteText,
  ensureViews,
  generateUnitViews,
  readViewsIndex,
  unitViewSourceHash,
} from "./views.js";

/** Injectable seams for tests (mirrors the RunnerDeps pattern). */
export interface MemoryDeps {
  openStore?: (paths: MemoryPaths) => MemoryStore;
  assemblePack?: typeof assembleMemoryPack;
  commit?: typeof commitEngagementMemory;
  now?: () => Date;
}

interface MemorySession {
  store: MemoryStore;
  paths: MemoryPaths;
  state: MemoryEngagementState;
  engagementDir: string;
  targetClass: string;
  deps: MemoryDeps;
}

const sessions = new WeakMap<Ctx, MemorySession>();

/**
 * The memory root for a run (§3.1): explicit override →
 * `REDTEAM_MEMORY_ROOT` → sibling of the registry file. An empty-string
 * env value is a misconfiguration and fails loud, naming the variable.
 *
 * @param ctx - The run context (registry path source).
 * @param override - An explicit root (RunOptions/config when wired).
 * @returns The memory root path.
 */
export function resolveMemoryRootForRun(ctx: Ctx, override?: string): string {
  if (override) return override;
  const raw = process.env["REDTEAM_MEMORY_ROOT"];
  if (raw !== undefined) {
    if (raw.trim() === "") {
      throw new MemoryError("SCHEMA_INVALID", "REDTEAM_MEMORY_ROOT is set but empty — misconfiguration fails loud");
    }
    return raw;
  }
  return join(dirname(ctx.config.registryPath), "memory");
}

/**
 * Parse `REDTEAM_MEMORY_BUDGET` (1..24). Unset → undefined (recall's
 * default of 6 applies); a bad value fails loud naming the variable.
 *
 * @param env - The process environment.
 * @returns The budget, or undefined when unset.
 */
export function parseMemoryBudget(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env["REDTEAM_MEMORY_BUDGET"];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 24) {
    throw new MemoryError("SCHEMA_INVALID", `REDTEAM_MEMORY_BUDGET=${JSON.stringify(raw)} is outside 1..24`);
  }
  return n;
}

/**
 * Adapt the real store to recall's seam. `ensureUnitViews` regenerates
 * the named units' views per-unit first (a unit that cannot regenerate
 * is a VIEW_STALE exclusion, §8 row 9 — never a recall crash), then runs
 * the directory-threshold pass; directories left stale are reported
 * from the views index with their pending counts.
 *
 * @param store - The open store.
 * @param paths - The store paths.
 * @param nowIso - Timestamp for refreshes and receipts.
 * @returns The recall-facing store adapter.
 */
export function recallStoreAdapter(store: MemoryStore, paths: MemoryPaths, nowIso: string): MemoryRecallStore {
  return {
    listActiveUnits: () => store.listUnits(),
    ensureUnitViews: (unitIds: string[]) => {
      const refreshed: string[] = [];
      const failed: string[] = [];
      const units: MemoryUnit[] = [];
      for (const id of unitIds) {
        const unit = store.getUnit(id);
        if (!unit) {
          failed.push(id);
          continue;
        }
        const expected = unitViewSourceHash(unit);
        if (unit.views.sourceHash === expected && unit.views.generator === VIEW_GENERATOR_VERSION && !unit.views.stale) {
          units.push(unit);
          continue;
        }
        try {
          const generated = generateUnitViews(unit, "active");
          units.push({
            ...unit,
            views: { ...generated, sourceHash: expected, generatedAt: nowIso, generator: VIEW_GENERATOR_VERSION, stale: false },
          });
          refreshed.push(id);
        } catch {
          failed.push(id); // VIEW_BUDGET_EXCEEDED etc. — excluded as VIEW_STALE by recall
        }
      }
      try {
        ensureViews(store, undefined, nowIso);
      } catch {
        // Directory refresh is threshold bookkeeping; a failure leaves
        // directories stale-but-readable, which the index read below
        // reports truthfully. Unit freshness above is already settled.
      }
      const index = readViewsIndex(paths);
      const staleDirs = Object.values(index.dirs)
        .filter((d) => d.stale || d.pendingUnitChanges > 0)
        .map((d) => ({ dir: d.dir, pendingUnitChanges: d.pendingUnitChanges }));
      return { refreshed, failed, staleDirs, units };
    },
    writeRecallReceipt: (receipt: RecallReceipt) => {
      atomicWriteText(join(paths.recallDir, `${receipt.receiptId}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
      return receipt.receiptId;
    },
  };
}

/**
 * Moment 1 (§7.1): open the store before any agent acts. Bootstrapping
 * a fresh store is recorded on the event log; opening an existing one
 * validates it (corruption fails loud here, not mid-run).
 *
 * @param ctx - The run context.
 * @param options - Root override, engagement dir, injectable deps.
 * @returns The engagement's memory state.
 */
export function openEngagementMemory(
  ctx: Ctx,
  options: { root?: string; engagementDir?: string; deps?: MemoryDeps } = {},
): MemoryEngagementState {
  const paths = resolveMemoryPaths(resolveMemoryRootForRun(ctx, options.root));
  const deps = options.deps ?? {};
  const store = (deps.openStore ?? openMemoryStore)(paths);
  const state: MemoryEngagementState = { recallReceiptIds: [] };
  sessions.set(ctx, {
    store,
    paths,
    state,
    engagementDir: options.engagementDir ?? join(ctx.config.engagementsDir, ctx.events.engagementId),
    targetClass: deriveTargetClass({
      target: ctx.input.target,
      targetIds: ctx.input.targets,
      appType: ctx.fingerprint.appType,
    }),
    deps,
  });
  if (store.bootstrapped) {
    ctx.events.append({
      phase: "authorize",
      actor: "runner",
      action: "memory_store_initialized",
      result: `Memory store initialized at ${paths.root} (store ${store.manifest.storeId})`,
    });
  }
  return state;
}

/**
 * The memory state for a run, when memory was opened.
 *
 * @param ctx - The run context.
 * @returns The state, or undefined when memory never opened.
 */
export function memoryStateFor(ctx: Ctx): MemoryEngagementState | undefined {
  return sessions.get(ctx)?.state;
}

function requireSession(ctx: Ctx): MemorySession {
  const session = sessions.get(ctx);
  if (!session) throw new MemoryError("SCHEMA_INVALID", "memory lifecycle called before openEngagementMemory");
  return session;
}

/**
 * Derive (and cache) the engagement's memory scope from the verified
 * authorization record. Throws `MEMORY_SCOPE_UNVERIFIED` when the run
 * has no verified authorization — memory never binds to an unverified
 * target (§4.2).
 *
 * @param ctx - The run context (post-authorize).
 * @returns The derived scope.
 */
export function deriveEngagementScope(ctx: Ctx): MemoryScope {
  const session = requireSession(ctx);
  if (!session.state.scope) {
    session.state.scope = deriveMemoryScope({
      engagementId: ctx.events.engagementId,
      hosts: ctx.hosts,
      verifiedAt: ctx.verifiedAt,
      verificationProof: ctx.verificationProof,
    });
  }
  return session.state.scope;
}

/**
 * The §6.6 legacy slice for this engagement's target class: active
 * EXPERIENCE.md records not yet projected into units, as neutral-base
 * (0.6) candidates. A missing/unreadable legacy store is an empty
 * slice — the legacy pool is a fallback, never a run failure.
 *
 * @param session - The memory session.
 * @returns The slice (candidates + the parser's skipped count).
 */
function buildLegacySlice(session: MemorySession): LegacyExperienceSlice {
  try {
    const report = readExperienceReport(resolveHarness2Paths(process.env), session.targetClass);
    if (!report.exists) return { candidates: [], skipped: 0 };
    const candidates: CollapseCandidate[] = [];
    for (const record of report.entries) {
      if (record.status.kind !== "active") continue;
      const refUri = `experience-record:${record.targetClass}/${record.date}/${record.layerId ?? "general"}/${record.cycleId}`;
      const unitId = computeUnitId(scopeKeyForClass(record.targetClass), "experience-lesson", record.changed, refUri);
      if (session.store.hasUnit(unitId)) continue; // projected — the unit form governs (§6.6)
      candidates.push({
        unitId: `legacy:${record.targetClass}/${record.date}/${record.cycleId}`,
        sourceClass: "experience",
        sourceKey: sourceKeyFor("experience", "legacy"),
        claim: record.changed,
        tags: [record.targetClass],
        baseScore: 0.6,
        contentClass: "normal",
        independentCount: 0,
        scopeKey: scopeKeyForClass(record.targetClass),
        hasScope: true,
        hasTrustBlock: false,
        legacyExperience: true,
      });
    }
    return { candidates, skipped: report.skipped };
  } catch {
    return { candidates: [], skipped: 0 };
  }
}

/**
 * The `memory_recall` event body (§7.1): survivor unitIds + tiers and,
 * read back from the just-written receipt, the candidate/pruned/decayed
 * counts — the audit line an operator (or a later investigator) uses to
 * prove memory was consulted and what it returned.
 *
 * @param session - The memory session (receipt location).
 * @param phase - Which pack this was.
 * @param pack - The assembled pack.
 * @returns The event result text.
 */
function recallEventResult(session: MemorySession, phase: "start" | "exploit", pack: MemoryPackResult): string {
  const survivors = pack.survivors.map((s) => `${s.unitId} [${s.tier}]`).join(", ") || "none";
  let counts = "";
  try {
    const receipt = JSON.parse(readFileSync(join(session.paths.recallDir, `${pack.receiptId}.json`), "utf8")) as RecallReceipt;
    const bySource = Object.entries(receipt.candidatesBySource)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    counts =
      ` · candidates ${bySource || "none"} · pruned ${receipt.pruned.length} · suppressed ${receipt.suppressedDuplicates.length}` +
      ` · decayed ${receipt.decayed.length} · stale-excluded ${receipt.viewStaleExcluded.length}`;
  } catch {
    counts = "";
  }
  return (
    `${phase} pack: receipt ${pack.receiptId} (recall/${pack.receiptId}.json) · survivors: ${survivors}` +
    `${pack.emptyReason ? ` · empty: ${pack.emptyReason}` : ""}${counts}`
  );
}

function assembleAndRecord(
  ctx: Ctx,
  session: MemorySession,
  phase: "start" | "exploit",
  query: string,
  eligibility?: { outOfScopeHosts?: string[]; targetClass?: string; stack?: string[]; appType?: string },
): MemoryPackResult {
  const now = session.deps.now ? session.deps.now() : new Date();
  const pack = (session.deps.assemblePack ?? assembleMemoryPack)(
    recallStoreAdapter(session.store, session.paths, now.toISOString()),
    deriveEngagementScope(ctx),
    {
      phase,
      query,
      engagementId: ctx.events.engagementId,
      ...(eligibility ? { eligibility } : {}),
      budget: parseMemoryBudget(process.env),
      now,
      legacy: buildLegacySlice(session),
    },
  );
  session.state.recallReceiptIds.push(pack.receiptId);
  if (phase === "start") session.state.startPack = pack;
  else session.state.exploitPack = pack;
  ctx.events.append({
    phase: phase === "start" ? "authorize" : "exploit",
    actor: "runner",
    action: "memory_recall",
    result: recallEventResult(session, phase, pack),
  });
  return pack;
}

/**
 * Moment 2 (§7.1): the start pack — after authorization succeeds,
 * before planning. Query = objective + target + mode.
 *
 * @param ctx - The run context (post-authorize).
 * @returns The assembled pack (also cached on the memory state).
 */
export function injectStartMemory(ctx: Ctx): MemoryPackResult {
  const session = requireSession(ctx);
  const query = `${ctx.input.objective} ${ctx.input.target} ${ctx.input.mode}`;
  return assembleAndRecord(ctx, session, "start", query);
}

/**
 * Moment 3 (§7.1): the refresh pack — after recon, with the fingerprint.
 * Query adds stack/appType and the registry hits' vuln classes;
 * eligibility carries the ROE deny set and the class/stack context.
 *
 * @param ctx - The run context (post-recon).
 * @returns The assembled pack (also cached on the memory state).
 */
export function injectExploitMemory(ctx: Ctx): MemoryPackResult {
  const session = requireSession(ctx);
  const hitClasses = [...new Set(ctx.registryHits.map((h) => h.vulnClass).filter((v): v is string => typeof v === "string"))];
  const query = [
    ctx.input.objective,
    ctx.input.target,
    ...ctx.fingerprint.stack,
    ctx.fingerprint.appType,
    ...hitClasses,
  ].join(" ");
  return assembleAndRecord(ctx, session, "exploit", query, {
    outOfScopeHosts: (ctx.input.roe.outOfScope ?? []).map((h) => normalizeHost(h)),
    targetClass: session.targetClass,
    stack: ctx.fingerprint.stack,
    appType: ctx.fingerprint.appType,
  });
}

/**
 * The coverage-digest line (§2.3): survivor counts by tier from the
 * freshest pack, with its receipt id. Null when no pack was assembled.
 *
 * @param ctx - The run context.
 * @returns The digest line, or null.
 */
export function memoryDigestLine(ctx: Ctx): string | null {
  const state = sessions.get(ctx)?.state;
  const pack = state?.exploitPack ?? state?.startPack;
  if (!pack) return null;
  const count = (tier: string): number => pack.survivors.filter((s) => s.tier === tier).length;
  const untrusted = pack.survivors.filter((s) => s.tier === "untrusted-target").length;
  return (
    `memory: ${pack.survivors.length} units (${count("proven")} proven · ${count("confirmed")} confirmed · ` +
    `${count("killed")} killed · ${untrusted} untrusted) · receipt ${pack.receiptId}`
  );
}

/**
 * Moment 4 (§7.1): the two-phase commit, run in the engagement's
 * finally AFTER trajectory capture. Mirrors the receipt into the
 * engagement directory and records the `memory_commit` event. Phase 1
 * archive failure throws `MemoryArchiveError` (the one memory failure
 * allowed to replace the run's return, §7.2); everything else returns
 * a receipt.
 *
 * @param ctx - The run context.
 * @param outcome - The run's terminal status and halt reason, if any.
 * @returns The memory receipt, or undefined when memory never opened.
 */
export function commitMemoryForRun(
  ctx: Ctx,
  outcome: { status: string; haltReason?: string },
): MemoryEngagementReceipt | undefined {
  const session = sessions.get(ctx);
  if (!session) return undefined;
  const engagementId = ctx.events.engagementId;
  const verified = !!session.state.scope;
  const scope: MemoryScope =
    session.state.scope ??
    ({
      kind: "engagement-target",
      scopeKey: scopeKeyForHosts(ctx.hosts),
      hosts: ctx.hosts,
      stack: [],
      originEngagementIds: [engagementId],
    } satisfies MemoryScope);
  if (!verified) {
    ctx.events.append({
      phase: ctx.events.snapshot.phase,
      actor: "runner",
      action: "memory_recall",
      result: "recall skipped-authorization-denied (no verified scope was derived for this run)",
    });
  }
  // The registry file is the durable truth at commit time (verdicts
  // transact into it during the run); fall back to the in-memory copy.
  const registry = loadRegistryFile(ctx.registryPath) ?? ctx.registry;
  const registryEntries: RegistryEntry[] = [
    ...registry.confirmed.filter((e) => e.engagementId === engagementId),
    ...registry.killed.filter((e) => e.engagementId === engagementId),
  ];
  let experience: MemoryCommitExperience | undefined;
  try {
    const report = readExperienceReport(resolveHarness2Paths(process.env), session.targetClass);
    if (report.exists) {
      experience = {
        records: report.entries,
        skipped: report.skipped,
        files: [{ uri: report.path, sha256: sha256OfText(readFileSync(report.path, "utf8")) }],
      };
    }
  } catch {
    experience = undefined; // legacy pool absence never fails the commit
  }
  const receipt = (session.deps.commit ?? commitEngagementMemory)({
    store: session.store,
    paths: session.paths,
    engagementId,
    engagementDir: session.engagementDir,
    target: ctx.input.target,
    mode: ctx.input.mode,
    objective: ctx.input.objective,
    outcome: outcome.status,
    ...(outcome.haltReason ? { haltReason: outcome.haltReason } : {}),
    scope,
    scopeRecord: {
      hosts: ctx.hosts,
      roeScope: ctx.input.roe.scope,
      ...(ctx.verificationProof ? { verificationProof: ctx.verificationProof } : {}),
      ...(ctx.verifiedAt ? { verifiedAt: ctx.verifiedAt } : {}),
    },
    registryEntries,
    liveFindings: ctx.liveFindings,
    trajectory: {
      ...(outcome.haltReason ? { failureMode: "halted" } : {}),
      steps: readSteps(session.engagementDir).length,
      targetClass: session.targetClass,
    },
    ...(experience ? { experience } : {}),
    recallReceiptIds: session.state.recallReceiptIds,
    nowIso: new Date().toISOString(),
  });
  atomicWriteText(join(session.engagementDir, "memory-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  const commit = receipt.commit;
  ctx.events.append({
    phase: ctx.events.snapshot.phase,
    actor: "runner",
    action: "memory_commit",
    result:
      "error" in commit
        ? `commit FAILED: ${commit.error}`
        : `archive ${commit.archiveId} · diff ${commit.diffId} (${commit.status}) · ` +
          `auto ${commit.autoApplied} · proposed ${commit.proposed} · skipped ${commit.skipped}`,
  });
  return receipt;
}

type MemoryCommitExperience = NonNullable<Parameters<typeof commitEngagementMemory>[0]["experience"]>;
