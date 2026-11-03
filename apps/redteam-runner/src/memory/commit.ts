/**
 * Two-phase commit orchestrator (brief §7.2). Phase 1 archives the raw
 * engagement record FIRST — synchronous, durable, and the one memory
 * operation allowed to fail the run (`MemoryArchiveError`): losing the
 * raw history silently is worse than failing the engagement. Phase 2
 * summarizes, extracts proposals through the deterministic projectors,
 * validates + scope-binds + trust-derives every one, auto-applies the
 * mechanical-projection lane, and writes the signed diff — ALWAYS,
 * including the all-zero diff. Phase 2 never throws: its failures are
 * terminal states on the commit receipt (`.failed`, status `failed`),
 * because the archive is already durable.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryError } from "./errors.js";
import {
  EXTRACTOR_VERSIONS,
  intakeTargetDerivedClaim,
  projectExperience,
  projectRegistryEntries,
  projectTrajectory,
  type MemoryProposal,
} from "./extract.js";
import { archiveDirName, archiveUri } from "./paths.js";
import { canonicalize, hashRecord, sealDiff, sha256OfText } from "./schema.js";
import type { MemoryEngagementReceipt } from "./types.js";
import { atomicWriteText } from "./views.js";
import { archiveEngagement, buildSummary } from "./commit-archive.js";
import type { MemoryCommitInput } from "./commit-archive.js";
import { processProposals } from "./commit-proposals.js";

export type { MemoryCommitInput } from "./commit-archive.js";

/**
 * Run the two-phase commit for a finished engagement and return the
 * receipt `run.ts` attaches to the result (§7.2). Phase 1 may throw
 * `MemoryArchiveError`; Phase 2 failures return
 * `commit: { status: "failed", error }` instead of throwing.
 *
 * @param input - The engagement's commit inputs.
 * @returns The memory engagement receipt.
 */
export function commitEngagementMemory(input: MemoryCommitInput): MemoryEngagementReceipt {
  const { paths } = input;
  const archive = archiveEngagement(input);
  const diffId = `${input.engagementId}-${String(archive.seq).padStart(4, "0")}`;
  const failPhase2 = (err: unknown): MemoryEngagementReceipt => {
    const message = err instanceof Error ? err.message : String(err);
    try {
      atomicWriteText(
        join(archive.dir, "commit-status.json"),
        `${JSON.stringify({ phase: "failed", archiveSeq: archive.seq, at: input.nowIso, error: message }, null, 2)}\n`,
      );
      atomicWriteText(join(archive.dir, ".failed"), `${message}\n`);
    } catch {
      // The receipt below still carries the failure; marker writing is best-effort here.
    }
    return {
      storeRoot: paths.root,
      scopeKey: input.scope.scopeKey,
      recallReceiptIds: input.recallReceiptIds,
      commit: { status: "failed", error: message },
    };
  };
  try {
    atomicWriteText(join(archive.dir, "summary.md"), buildSummary(input, archive.dir));

    const proposals: MemoryProposal[] = [];
    if (input.registryEntries.length > 0) {
      proposals.push(
        ...projectRegistryEntries({
          engagementId: input.engagementId,
          scope: input.scope,
          entries: input.registryEntries,
          liveFindings: input.liveFindings,
          nowIso: input.nowIso,
        }),
      );
    }
    if (input.trajectory) {
      proposals.push(
        ...projectTrajectory({
          engagementId: input.engagementId,
          targetClass: input.trajectory.targetClass,
          outcome: input.outcome,
          failureMode: input.trajectory.failureMode,
          haltReason: input.haltReason,
          steps: input.trajectory.steps,
          confirmedCount: input.registryEntries.filter((e) => e.kind === "confirmed").length,
          killedCount: input.registryEntries.filter((e) => e.kind === "killed").length,
          nowIso: input.nowIso,
        }),
      );
    }
    if (input.experience && input.experience.records.length > 0) {
      proposals.push(
        ...projectExperience({
          records: input.experience.records,
          fileUri: input.experience.files[0]?.uri ?? "EXPERIENCE.md",
          nowIso: input.nowIso,
        }),
      );
    }
    for (const claim of input.targetDerivedClaims ?? []) {
      proposals.push(intakeTargetDerivedClaim({ ...claim, engagementId: input.engagementId, nowIso: input.nowIso }));
    }

    const outcome = processProposals(input, proposals, diffId);
    // A superseded/reverted EXPERIENCE record semantically asks for the
    // corresponding lesson to go away. V1 has NO delete op: the request
    // is recorded in the diff's skipped[] as DELETE_NOT_SUPPORTED_V1 —
    // visible in the audit trail, never silently dropped (§7.2).
    for (const record of input.experience?.records ?? []) {
      if (record.status.kind === "active") continue;
      outcome.skipped.push({
        op: {
          projector: "experience-projector",
          record: `${record.targetClass}/${record.date}/${record.cycleId}`,
          requestedOp: "delete",
          recordStatus: record.status.kind,
        },
        reason: "DELETE_NOT_SUPPORTED_V1",
      });
    }
    // §8 row 12: a projector whose proposals ALL failed validation is a
    // pipeline bug (extractor schema break), not a quiet engagement. The
    // diff is still written (status "failed") so the audit trail —
    // including any healthy lane's auto-applied ops — stays complete.
    let schemaBreak: string | null = null;
    for (const [projector, tally] of outcome.perProjector) {
      if (tally.proposed > 0 && tally.landed === 0 && tally.noChange === 0) {
        schemaBreak =
          `projector ${projector}: all ${tally.proposed} proposal(s) failed validation — ` +
          `treating as a schema break (EXTRACTOR_SCHEMA_BREAK), not an empty engagement`;
        break;
      }
    }

    const trajectoryPath = join(input.engagementDir, "trajectory.json");
    const diff = sealDiff({
      diffId,
      engagementId: input.engagementId,
      archiveUri: archiveUri(input.engagementId, archive.seq),
      createdAt: input.nowIso,
      inputHashes: {
        events: archive.fileHashes.get("events.jsonl") ?? "",
        ...(existsSync(trajectoryPath) ? { trajectory: sha256OfText(readFileSync(trajectoryPath, "utf8")) } : {}),
        registryEntries: input.registryEntries.map((entry) => hashRecord(entry)),
        experienceFiles: (input.experience?.files ?? []).map((f) => f.sha256),
      },
      autoApplied: outcome.autoApplied,
      proposed: outcome.proposed,
      skipped: outcome.skipped,
      counts: {
        autoApplied: outcome.autoApplied.length,
        proposed: outcome.proposed.length,
        skipped: outcome.skipped.length,
      },
      audit: {
        legacyExperienceSkipped: input.experience?.skipped ?? 0,
        extractorVersions: EXTRACTOR_VERSIONS,
      },
      status: schemaBreak ? "failed" : outcome.proposed.length > 0 ? "proposed" : "applied",
    });
    const diffBytes = `${canonicalize(diff)}\n`;
    atomicWriteText(join(paths.proposalsDir, `${diffId}.json`), diffBytes);
    atomicWriteText(join(archive.dir, "memory_diff.json"), diffBytes);
    if (schemaBreak) {
      return failPhase2(new MemoryError("EXTRACTOR_SCHEMA_BREAK", schemaBreak));
    }
    atomicWriteText(
      join(archive.dir, "commit-status.json"),
      `${JSON.stringify({ phase: "diff-written", archiveSeq: archive.seq, at: input.nowIso, status: diff.status }, null, 2)}\n`,
    );
    atomicWriteText(join(archive.dir, ".done"), "");
    return {
      storeRoot: paths.root,
      scopeKey: input.scope.scopeKey,
      recallReceiptIds: input.recallReceiptIds,
      commit: {
        archiveId: `${input.engagementId}/${archiveDirName(archive.seq)}`,
        diffId,
        diffSha256: diff.sha256,
        status: diff.status,
        autoApplied: diff.counts.autoApplied,
        proposed: diff.counts.proposed,
        skipped: diff.counts.skipped,
      },
    };
  } catch (err) {
    return failPhase2(err);
  }
}
