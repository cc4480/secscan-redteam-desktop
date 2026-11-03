/**
 * The commit moment, extracted from `lifecycle.ts` to keep that module
 * inside the 300-line file budget: the two-phase commit run in the
 * engagement finally, its event line and the receipt mirror.
 * Behaviour is unchanged.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context.js";
import { resolveHarness2Paths } from "../harness2/contract.js";
import { readExperienceReport } from "../harness2/experience-record.js";
import { readSteps } from "../harness2/steps.js";
import { loadRegistryFile, type RegistryEntry } from "../registry.js";
import { commitEngagementMemory } from "./commit.js";
import { sha256OfText } from "./schema.js";
import { scopeKeyForHosts } from "./scope.js";
import type { MemoryEngagementReceipt, MemoryScope } from "./types.js";
import { atomicWriteText } from "./views.js";
import { sessions } from "./lifecycle-session.js";

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
