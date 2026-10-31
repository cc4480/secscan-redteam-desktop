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

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryArchiveError, MemoryError } from "./errors.js";
import {
  EXTRACTOR_VERSIONS,
  intakeTargetDerivedClaim,
  projectExperience,
  projectRegistryEntries,
  projectTrajectory,
  type MemoryProposal,
  type TargetDerivedClaimInput,
} from "./extract.js";
import { archiveDirName, archiveUri } from "./paths.js";
import type { MemoryPaths } from "./paths.js";
import { canonicalize, hashRecord, sealDiff, sha256OfText, validateUnit } from "./schema.js";
import { assertScopeBinding } from "./scope.js";
import { atomicWriteText } from "./views.js";
import { finalizeUnit, type MemoryStore } from "./store.js";
import { evaluateCorroboration } from "./trust.js";
import type {
  DiffOp,
  MemoryEngagementReceipt,
  MemoryScope,
  MemoryUnit,
} from "./types.js";
import type { LiveFinding } from "../context.js";
import type { ExperienceRecord } from "../harness2/experience-record.js";
import type { RegistryEntry } from "../registry.js";

const ARCHIVE_FILES = ["events.jsonl", "steps.jsonl", "state.json", "approvals.jsonl", "engagement.md"] as const;

export interface MemoryCommitInput {
  store: MemoryStore;
  paths: MemoryPaths;
  engagementId: string;
  /** The live engagement directory the archive copies FROM. */
  engagementDir: string;
  target: string;
  mode: string;
  objective: string;
  outcome: string;
  haltReason?: string;
  /** The engagement's derived memory scope (receipt scopeKey + projector seed). */
  scope: MemoryScope;
  /** The scope record written into the archive manifest (the write-time binding authority, §4.2 rule 1). */
  scopeRecord: { hosts: string[]; roeScope: string[]; verificationProof?: string; verifiedAt?: string };
  /** This engagement's registry entries (confirmed + killed). */
  registryEntries: readonly RegistryEntry[];
  liveFindings?: readonly LiveFinding[];
  /** Trajectory facts for the lesson projector; null when no trajectory was captured. */
  trajectory?: { failureMode?: string; steps?: number; targetClass: string } | null;
  experience?: { records: readonly ExperienceRecord[]; skipped: number; files: { uri: string; sha256: string }[] };
  targetDerivedClaims?: readonly Omit<TargetDerivedClaimInput, "engagementId" | "nowIso">[];
  recallReceiptIds: string[];
  nowIso: string;
}

interface ArchiveResult {
  seq: number;
  dir: string;
  fileHashes: Map<string, string>;
}

/** Phase 1 — archive. Throws MemoryArchiveError; the caller lets it replace the run's return (§7.2). */
function archiveEngagement(input: MemoryCommitInput): ArchiveResult {
  const { store, paths } = input;
  return store.withLock(() => {
    const seq = store.allocateArchiveSeq(input.engagementId);
    const dir = join(paths.archivesDir, input.engagementId, archiveDirName(seq));
    mkdirSync(dir, { recursive: true });
    const fileHashes = new Map<string, string>();
    const files: { name: string; present: boolean; sha256?: string; bytes?: number; reason?: string }[] = [];
    const writeStatus = (status: Record<string, unknown>): void =>
      atomicWriteText(join(dir, "commit-status.json"), `${JSON.stringify(status, null, 2)}\n`);
    for (const name of ARCHIVE_FILES) {
      const source = join(input.engagementDir, name);
      if (!existsSync(source)) {
        if (name === "events.jsonl") {
          writeStatus({ phase: "archive-failed", archiveSeq: seq, at: input.nowIso, error: "events.jsonl missing" });
          throw new MemoryArchiveError(
            `memory archive for ${input.engagementId}: events.jsonl is missing from ${input.engagementDir} — the raw record cannot be archived`,
          );
        }
        files.push({ name, present: false, reason: "absent at commit time" });
        continue;
      }
      const body = readFileSync(source, "utf8");
      const sha256 = sha256OfText(body);
      atomicWriteText(join(dir, name), body);
      const copied = readFileSync(join(dir, name), "utf8");
      if (sha256OfText(copied) !== sha256) {
        writeStatus({ phase: "archive-failed", archiveSeq: seq, at: input.nowIso, error: `copy hash mismatch for ${name}` });
        throw new MemoryArchiveError(`memory archive for ${input.engagementId}: sha256 mismatch copying ${name}`);
      }
      fileHashes.set(name, sha256);
      files.push({ name, present: true, sha256, bytes: Buffer.byteLength(body, "utf8") });
    }
    const manifest = {
      engagementId: input.engagementId,
      archiveSeq: seq,
      archiveUri: archiveUri(input.engagementId, seq),
      createdAt: input.nowIso,
      scope: input.scopeRecord,
      outcome: input.outcome,
      files,
    };
    atomicWriteText(join(dir, "archive-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    writeStatus({ phase: "archived", archiveSeq: seq, at: input.nowIso });
    return { seq, dir, fileHashes };
  });
}

/** The fixed-template session summary (§7.2 Phase 2 step 1) — no free-form invention. */
function buildSummary(input: MemoryCommitInput, archiveDir: string): string {
  const confirmed = input.registryEntries.filter((e) => e.kind === "confirmed");
  const killed = input.registryEntries.filter((e) => e.kind === "killed");
  const phases: string[] = [];
  try {
    for (const line of readFileSync(join(archiveDir, "events.jsonl"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const phase = (JSON.parse(line) as { phase?: string }).phase;
      if (phase && phases[phases.length - 1] !== phase) phases.push(phase);
    }
  } catch {
    // The archive copy is hash-verified; an unparseable log still summarizes without steps.
  }
  return [
    `# ${input.target} · ${input.mode} · ${input.outcome} · ${confirmed.length} confirmed / ${killed.length} killed`,
    ``,
    `## Intent`,
    input.objective,
    ``,
    `## Scope`,
    `Hosts: ${input.scopeRecord.hosts.join(", ") || "none recorded"}`,
    `Verification: ${input.scopeRecord.verificationProof ?? "not recorded"}`,
    ``,
    `## Key steps`,
    phases.length > 0 ? phases.map((p) => `- ${p}`).join("\n") : "- (no phase transitions recorded)",
    ``,
    `## Findings`,
    ...(confirmed.length > 0
      ? confirmed.map((e) => `- ${e.id} ${e.vulnClass} (${e.severity})`)
      : ["- None."]),
    ``,
    `## Killed hypotheses`,
    ...(killed.length > 0 ? killed.map((e) => `- ${e.id} ${e.hypothesis}`) : ["- None."]),
    ``,
    `## Pending / honest limits`,
    input.haltReason ?? "None recorded.",
    ``,
  ].join("\n");
}

function contentMatchesExisting(existing: MemoryUnit, draft: MemoryProposal["draft"]): boolean {
  return existing.claim === draft.claim && existing.body === draft.body && existing.proof.state === draft.proof.state;
}

interface ProposalOutcome {
  autoApplied: DiffOp[];
  proposed: DiffOp[];
  skipped: { op: unknown; reason: string }[];
  /** Per-projector accounting for the §8 row-12 schema-break check: a
   * dedupe (DUPLICATE_NO_CHANGE) is a healthy no-op, NOT a validation
   * failure — only a projector whose proposals ALL failed validation
   * (landed 0 AND noChange 0) is a schema break. */
  perProjector: Map<string, { proposed: number; skipped: number; landed: number; noChange: number }>;
}

/** Validate, finalize, and route every proposal to its lane (or to skipped[] with a stable reason). */
function processProposals(input: MemoryCommitInput, proposals: MemoryProposal[], diffId: string): ProposalOutcome {
  const { store } = input;
  const outcome: ProposalOutcome = { autoApplied: [], proposed: [], skipped: [], perProjector: new Map() };
  const account = (projector: string): { proposed: number; skipped: number; landed: number; noChange: number } => {
    let entry = outcome.perProjector.get(projector);
    if (!entry) {
      entry = { proposed: 0, skipped: 0, landed: 0, noChange: 0 };
      outcome.perProjector.set(projector, entry);
    }
    return entry;
  };
  let opSeq = 0;
  const nextOpId = (): string => `op-${String((opSeq += 1)).padStart(3, "0")}`;
  for (const proposal of proposals) {
    const tally = account(proposal.projector);
    tally.proposed += 1;
    const skip = (reason: string): void => {
      tally.skipped += 1;
      if (reason === "DUPLICATE_NO_CHANGE") tally.noChange += 1;
      outcome.skipped.push({ op: { projector: proposal.projector, unitId: proposal.draft.unitId }, reason });
    };
    try {
      const existing = store.getUnit(proposal.draft.unitId);
      if (existing && contentMatchesExisting(existing, proposal.draft)) {
        skip("DUPLICATE_NO_CHANGE");
        continue;
      }
      if (existing && proposal.lane === "auto") {
        // Re-projection of a known unit = a corroboration event (§7.2):
        // append a new version only when the corroboration is independent.
        const candidateKey = proposal.draft.corroboration.sourceKeys[0] ?? "";
        const verdict = evaluateCorroboration(
          {
            sourceKeys: existing.corroboration.sourceKeys,
            artifactSha256s: existing.provenance.sourceRefs
              .map((r) => r.sha256)
              .filter((h): h is string => typeof h === "string"),
          },
          {
            sourceClass: proposal.draft.provenance.sourceClass,
            sourceKey: candidateKey,
            artifactSha256: proposal.draft.provenance.sourceRefs[0]?.sha256,
          },
        );
        if (!verdict.counted) {
          skip("DUPLICATE_NO_CHANGE");
          continue;
        }
        const draft = {
          ...proposal.draft,
          version: existing.version + 1,
          corroboration: {
            independentCount: existing.corroboration.independentCount + 1,
            sourceKeys: [...existing.corroboration.sourceKeys, candidateKey],
            lastCorroboratedAt: input.nowIso,
          },
        };
        const unit = finalizeUnit(draft, input.nowIso);
        validateUnit(unit, "commit corroboration");
        assertScopeBinding(unit);
        store.appendUnitVersion(unit, {
          status: "active",
          by: "runner",
          reason: "MECHANICAL_PROJECTION_CORROBORATION",
          diffId,
          at: input.nowIso,
        });
        outcome.autoApplied.push({ opId: nextOpId(), type: "create", unit });
        tally.landed += 1;
        continue;
      }
      const draft = existing ? { ...proposal.draft, version: existing.version + 1 } : proposal.draft;
      const unit = finalizeUnit(draft, input.nowIso);
      validateUnit(unit, "commit proposal");
      assertScopeBinding(unit);
      if (proposal.lane === "auto") {
        store.appendUnitVersion(unit, {
          status: "active",
          by: "runner",
          reason: "MECHANICAL_PROJECTION",
          diffId,
          at: input.nowIso,
        });
        outcome.autoApplied.push({ opId: nextOpId(), type: "create", unit });
      } else if (existing) {
        outcome.proposed.push({
          opId: nextOpId(),
          type: "supersede",
          unitId: existing.unitId,
          baseVersion: existing.version,
          baseHash: existing.hash,
          unit,
        });
      } else {
        outcome.proposed.push({ opId: nextOpId(), type: "create", unit });
      }
      tally.landed += 1;
    } catch (err) {
      if (err instanceof MemoryError) {
        skip(err.code);
        continue;
      }
      throw err;
    }
  }
  return outcome;
}

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
