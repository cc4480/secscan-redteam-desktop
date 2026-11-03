/**
 * Phase 1 of the two-phase commit, extracted from `commit.ts` to keep
 * that module inside the 300-line file budget: the commit input shape,
 * the raw engagement archive (the one memory step allowed to fail the
 * run) and the fixed-template session summary. Behaviour is unchanged.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LiveFinding } from "../context.js";
import type { ExperienceRecord } from "../harness2/experience-record.js";
import type { RegistryEntry } from "../registry.js";
import { MemoryArchiveError } from "./errors.js";
import type { TargetDerivedClaimInput } from "./extract.js";
import { archiveDirName, archiveUri } from "./paths.js";
import type { MemoryPaths } from "./paths.js";
import { sha256OfText } from "./schema.js";
import type { MemoryStore } from "./store.js";
import type { MemoryScope } from "./types.js";
import { atomicWriteText } from "./views.js";

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
export function archiveEngagement(input: MemoryCommitInput): ArchiveResult {
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
export function buildSummary(input: MemoryCommitInput, archiveDir: string): string {
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
