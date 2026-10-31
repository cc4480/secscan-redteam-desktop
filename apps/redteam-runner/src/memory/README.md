# Memory tiering (Q-MEMTIER)

File-native, scope-bound memory for the RedTeam fleet. Design: OpenViking's
storage/commit patterns + Hermes's organization/collapse recall,
re-implemented as original TypeScript, on a spine that is ours —
engagement-scope binding, trust derived from proof, fail-loud everywhere,
and a poisoning guard for target-derived content. No vector recall in v1.

## Layout (one store root, default `<dirname(registryPath)>/memory`)

- `manifest.json` — store identity + counts, self-hashed.
- `units.jsonl` — the L2 ledger: append-only, one canonical JSON line per
  unit VERSION. History is never rewritten; a unit's current version is
  its last line.
- `commits.jsonl` — the status overlay: one line per (unit, version)
  status transition (`active` / `proposed` / `superseded` / `retired`).
- `views.json` + `views/` — L0/L1 GENERATED views. L0 (≤256 chars) and L1
  (≤4000 chars) are projections of the ledger record, regenerated
  mechanically; the ledger is never the other way round. `views.json`
  tracks per-directory freshness (covered/pending counts, aggregate hash).
- `archives/<engagementId>/archive-NNNN/` — the raw engagement record,
  copied and hash-verified BEFORE any extraction (Phase 1), with
  `archive-manifest.json`, a fixed-template `summary.md`, the commit's
  `memory_diff.json`, and a `.done` / `.failed` terminal marker.
- `proposals/<diffId>.json` — the sealed two-phase diff (`sha256` over
  its canonical form), plus `<diffId>.approval.json` and
  `<diffId>.apply.json` once an operator acts.
- `recall/<engagementId>-<phase>.json` — one receipt per recall,
  including empty ones (`NO_ELIGIBLE_UNITS` is a first-class result).

## Rules that do not bend

- **Scope binding (§4.2).** Every unit carries its engagement/target
  scope at write time. The store refuses unscoped writes; a
  target-derived unit must be engagement-target scoped; a class-scoped
  unit asserting a host-specific value is refused `SCOPE_TOO_BROAD`;
  global-procedural scope accepts only operator/experience knowledge.
- **Trust is derived, never asserted (§4.3).** `deriveTrust` computes
  the tier from proof + corroboration; a claim that exceeds what its
  receipts support throws `TRUST_OVERCLAIM` — at write time AND again at
  apply time. Target-derived content is hard-capped at the
  `untrusted-target` tier (base 0.20) until two independent non-target
  sources corroborate it.
- **Two-phase commit (§7.2).** Archive first (the one failure allowed
  to fail the run: `MemoryArchiveError`). Extraction is mechanical
  projection: registry/trajectory/experience/target-derived projectors
  emit drafts; mechanical projections auto-apply, semantic ones land as
  PROPOSED diff ops. **There is no delete op in v1** — a
  superseded/reverted experience record is recorded in the diff as
  `DELETE_NOT_SUPPORTED_V1`, and retirement is an operator-approved
  overlay line, never an erasure.
- **Approval is a named human (§7.3).** `approve` records who approved
  which diff sha256; `apply` re-verifies the binding, revalidates every
  op against the current store (`STALE_BASE` skips, never forced), and
  re-derives trust. Approval authorizes persistence; it does not mint
  proof — approving a target-derived unit does not raise its tier.
- **Fail loud (§8).** Corrupt ledger/manifest → `STORE_CORRUPT`;
  views-index disagreement → `STORE_INDEX_MISMATCH` (repair:
  `memory reindex`); a held lock → `STORE_LOCKED` naming the holder;
  unverified scope → `MEMORY_SCOPE_UNVERIFIED`. Nothing is silently
  skipped, downgraded, or defaulted.

## CLI

```
redteam-runner memory status
redteam-runner memory diff show <diffId>
redteam-runner memory approve <diffId> --operator <name> [--ops <ids>] [--note <text>]
redteam-runner memory apply <diffId>
redteam-runner memory reject <diffId> --operator <name> [--note <text>]
redteam-runner memory reindex
```

Root resolution: `--memory-root` → `REDTEAM_MEMORY_ROOT` → sibling of
the registry file. `REDTEAM_MEMORY_BUDGET` (1..24, default 6) sizes
recall packs; a bad value fails loud.

## Lifecycle (§7.1)

`lifecycle.ts` wires memory into a run: open after the registry load,
start pack after authorization (query = objective + target + mode),
refresh pack after recon (fingerprint + registry-hit classes, ROE deny
set as eligibility), commit in the finally after trajectory capture,
receipt mirrored to `<engagementDir>/memory-receipt.json`. Blocked runs
still archive, with recall recorded `skipped-authorization-denied`.

## Named v1 limits

- The experience projector projects ACTIVE records only; reverted /
  superseded records surface as `DELETE_NOT_SUPPORTED_V1` skips.
- The class-scope host-value check is a mechanical detector (URLs, IPv4,
  known-TLD hostnames in claim/body); false positives surface as visible
  diff skips, never silent drops.
- The registry projector's proven path cites the engagement's archived
  `events.jsonl` as the negative-control receipt ref (the audit trail
  holds the control record).
- Target-derived intake (`intakeTargetDerivedClaim`) is a commit-input
  seam in v1; no agent tool feeds it yet.
- Legacy EXPERIENCE.md records surface in recall at neutral base 0.6
  until projected; once a unit exists for a record, the unit governs.
