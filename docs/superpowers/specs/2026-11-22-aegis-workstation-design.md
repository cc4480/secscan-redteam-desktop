# Aegis Workstation — design

- **Status:** DRAFT v2 — revised after builder-check; awaiting approval
- **Date:** 2026-11-22
- **Owner:** operator (adopts); Claude (author)
- **Scope of this doc:** the whole product, with Milestone 0 specified to
  build-ready detail and later milestones at roadmap altitude.

> **Revision note (v2).** v1's M0 was transcribed from
> `AUDIT-FULL-CODEBASE-2026-11-15.md`. A builder-check verified it against the
> newer base checkout `5e3fee4a` (2026-11-17) and found the base has moved:
> **the ownership gate already fails closed** (audit P0 steps 1–2 landed), and
> the live defect is now *inverted* — the verify→launch flow is broken the
> other way (see §9). M0 below is re-derived from `5e3fee4a`, not the audit.

---

## 1. Intent & why

Eight repositories are different cuts of one idea: an AI red-team that
**reasons** about a target and runs as a desktop app. Rather than build a
new thing, we finish the one that already absorbed the others and is ~90%
complete — `secscan-redteam-desktop` — and put the Aegis platform layer on
top of it. The result, "Aegis Workstation," is a single installable,
authorization-enforcing, authorized-engagement red-team product.

The base is a 319-package monorepo with a real battery, real scanners, a real
Foundry store, and real packaging. The remaining work is completeness and
composition, concentrated in the authorization/safety path — and as of
`5e3fee4a`, concentrated in making that path *usable without weakening it*.

## 2. Goals

- The **ownership-verification flow works end to end on the shipped launch
  path and stays fail-closed**: a verified owner can launch against their
  domain; an unverified domain is refused; no shipping bypass silently
  reopens the "operator's word alone" path.
- Both authorization gates are live: the runner launch gate (already
  fail-closed) *and* the independent agent-layer tool hook (currently dead).
- Close the remaining audit P1 structural gaps so the shipped app matches its
  source and its documented safety claims are true.
- Add the Aegis platform layer (Ops Console evolution, provider
  gateway/fallback, skills-as-data, memory tiering) on top, under the existing
  propose→benchmark→review→adopt gate.
- Preserve the engagement store across upgrades (standing rule, `PLATFORM.md`).

## 3. Non-goals

- The other four product ideas (clean general harness, standalone LLM
  router, debate orchestrator, Hermes deploy) — explicitly dropped for now.
- New offensive capability. We wire what exists behind the authorization
  spine; we do not expand the attack surface, add autonomous persistence, or
  add detection-evasion-for-stealth.
- Rewriting the harness. We finish and compose; we do not re-architect.
- Live-target proof. "Done" means built, gated, and verified against
  mocks/fakes/loopback and the benchmark ground-truth set — not proven on a
  live external target.

## 4. Anti-goals (failure even if it "works")

- An app that can be pointed at an arbitrary target on the operator's word
  alone. **This now includes a reachable `REDTEAM_TEST_MODE` bypass on a
  packaged release build** (see §9/Decision 3) — not only a rubber-stamp gate.
- A verified owner who *cannot* launch against their own domain because the
  store the verifier writes and the store the gate reads disagree (the current
  state).
- A safety claim in the docs the code does not enforce.
- A shipped desktop payload that does not match source.

## 5. Constraints

- **Safety spine is load-bearing, not additive.** Every offensive capability
  loads and arms only inside a verified, scoped engagement with an audit
  trail. M0 keeps the fail-closed property while fixing the usability bug —
  it must not trade one for the other.
- **Three base states are in play** (§9a). The platform pin, the attached
  clone, and the audit snapshot disagree; M0's baseline must be pinned down
  first.
- **Multi-repo reality.** `aegis-red-agents` consumes the base only through
  the submodule pin `runtime/secscan-redteam-desktop`. Finishing work (M0–M2)
  lands **in the base repo**; the platform layer (M3) lands **here**; the base
  is adopted by bumping the pin as its own reviewed change (`README.md` rule).
- **Base-repo access.** `secscan-redteam-desktop` is currently a **read-only**
  anonymous clone in this session. Executing M0 requires attaching it with
  push access (Decision 1).
- **Gate discipline** (`PLATFORM.md`): propose → benchmark gate → editor
  review → human adopts. M3 passes it; M0–M2 are completeness repairs verified
  by tests + acceptance checks.
- **Platform targets:** Windows x64 (primary, NSIS), macOS arm64/x64. No new
  platform. **Licensing:** base MIT; `@secscan/*` UNLICENSED/private — keep the
  split.

## 6. Approaches considered

- **A — Harness-first.** Rebuild from hermes + dsh shell + aegis spine.
  *Rejected:* most work, three languages, discards a 90%-complete, 700+-test
  base that already has the pieces.
- **B — Console-first on `secscan-redteam-desktop` (CHOSEN).** Finish the
  mature base, layer Aegis on top. *Why:* strongest base; the safety core
  already exists and (per v2) already fails closed — the work is usability +
  the second gate, not a rebuild.
- **C — Map-then-merge.** Full re-home into a fresh monorepo first.
  *Rejected as the path, kept as a lens:* the §7 table is the useful part.

**Decision:** B, operator-confirmed.

## 7. Where the 8 repos land

| Repo | Role in Aegis Workstation |
|---|---|
| `secscan-redteam-desktop` | The product. M0–M2 land here. |
| `aegis-red-agents` | Platform layer (M3); consumes base via submodule pin. |
| `dsh-desktop` | The base's Windows installer artifact — already in. |
| `secscan-redteam` | Superseded by the desktop monorepo; history only. |
| `secscan-foundry-backup` | Cold backup of `packages/redteam/foundry-gate` + snapshot; already in. |
| `redteam-muse-unseat` | Correctness rule for `packages/redteam/llm-router`: no "default" claim outside policy code. Review discipline. |
| `agent-red` | Earlier Python agent-roster prototype; base already has dispatch/seats/roles. Cherry-pick concepts only. |
| `hermes-agent`, `Agent-Mesh` | Out of scope (dropped products). |

## 8. Milestones

- **M0 — Make the authorization flow correct and complete** (re-derived; §9).
  Unify the verification store so verify→launch works and stays fail-closed;
  bring the dead agent-layer gate live; decide the `REDTEAM_TEST_MODE` release
  exposure. The target-distress breaker is **split out** of M0 (Decision 2).
- **M0.5 — Target-distress circuit breaker.** Re-implement the auto-halt
  safety control the docs still promise (and overturn
  `killswitch-removed.test.ts`), or correct the docs. Sized separately because
  it is a safety-feature build, not a wiring repair.
- **M1 — Wire the remaining dead capabilities.** Plan-is-law protocol layer
  call sites; OOB collaborator construction; web console data channel; scanner
  (sqlmap/nikto/john) results → findings; `playwright` declared. All behind M0.
- **M2 — Release hygiene.** Default `web` product isolation (audit #16); verify
  + rebuild the desktop payload against source; broken platform gates (#17);
  tree/log cleanup (#19); docs that contradict code (#20).
- **M3 — Aegis platform layer.** Provider gateway/fallback; skills-as-data;
  memory tiering; Ops Console evolution — each a gated package per
  `PLATFORM.md`, adopted by a reviewed pin bump.

Execution is milestone-by-milestone; each gets its own implementation plan
(writing-plans skill) when reached.

## 9a. Baseline commit (resolve before M0 code)

Three states disagree:

- **Platform pin** (`aegis-red-agents/.gitmodules` → `runtime/secscan-redteam-desktop`): `03e9df3c` — submodule not checked out here, contents unverified.
- **Attached clone** (`/home/user/cc4480/secscan-redteam-desktop`): `5e3fee4a` (2026-11-17), shallow depth-1. **This is what M0 below is derived from.**
- **Audit snapshot:** 2026-11-15 (pre-fix; superseded).

*Proposed:* build M0 on the **latest** base (≥`5e3fee4a`), land it there, then
move the platform pin `03e9df3c` → the M0 commit as a reviewed bump. Confirmed
by Decision 1.

## 9. M0 specification (build-ready, re-derived from `5e3fee4a`)

**Verified current state** (primary source, `5e3fee4a`):

- Ownership gate **already fails closed.** `apps/redteam-runner/src/phases/authorize.ts:125`
  passes `attestedProof = undefined` on the default path; `src/gate.ts:149-183`
  (`checkAuthorization`) refuses any non-loopback domain with no verification
  record. There is **no rubber-stamp path**. (Audit §9 steps 1,2,5 are
  done/moot.)
- The live defect is a **three-way store-schema split.** The writer
  (`packages/redteam/auth-gate/src/local.ts`) persists `{verified: string[], pending}`.
  The **runner launch gate** (`gate.ts:130 isLocallyVerified`) reads a *record*
  shape (`StoreDoc`). The **agent hook** (`packages/redteam/harness-plugin/src/auth-gate.ts`)
  reads the array shape via `LocalDomainVerifier.isVerified`. One file
  (`~/.secscan-redteam/verified-domains.json`), three readers, two shapes → a
  domain verified through the shipped `verify_domain_*` tools **cannot be read
  by the launch gate**, so owned domains fail closed too.
- The **second (agent-layer) gate is dead.** `packages/redteam/auth-gate/src/hook.ts:79`
  `isScanTool` matches base name `scan_url`, which no tool registers. The real
  engine probes are under the `mcp__redteam__` namespace with a `targetProfile`
  arg (the same file's `HOST_TARGET_PROFILES` path). So the hook needs a
  **predicate re-fit**, not a rename — and must be reconciled with the engine's
  own owner-verification enforcement (`src/dispatch/seclayer.ts`) so it is
  defense-in-depth, not a conflicting double-gate.
- A **`REDTEAM_TEST_MODE=1` bypass ships in `authorize.ts:88-121`.** It lifts
  ownership + scope authorization (keeps the out-of-scope denylist; logs
  loudly). Whether it is reachable on a packaged *release* launch is an open
  anti-goal question.

**M0 work:**

1. **Unify the verification store schema** across writer, runner gate, and
   harness hook so a domain verified via `verify_domain_*` is launchable, with
   on-read migration of the legacy array form. *(This is the core fix; it makes
   the product usable while preserving fail-closed.)*
2. **Bring the agent-layer gate live:** re-fit `isScanTool`/`wantsActiveTesting`
   to the real `mcp__redteam__*` probe schema, de-duped against engine
   enforcement.
3. **Decide the `REDTEAM_TEST_MODE` release exposure** (Decision 3): confirm
   whether it is reachable in packaged builds and, if so, gate it out of /
   harden it for release.

**Acceptance (M0 is not done without all of):**

- **Verify→launch on an owned domain succeeds** through the real MCP tool path
  and a store record written by `verify_domain_*` reads back via
  `verify_domain_list` *and* the launch gate. *(This is the test that fails
  today.)*
- An **unverified** domain is still refused through that same path (fail-closed
  preserved).
- The agent-layer hook **fires** on a real engine probe tool and refuses an
  unverified target (second independent gate live).
- Tests exercise the **real composition with a pre-seeded store at
  `REDTEAM_VERIFIED_DOMAINS_FILE`**, not an injected verifier and not
  `REDTEAM_TEST_MODE` (both bypass the store read).
- `pnpm run typecheck` green; affected suites green.

## 10. Left to the builder (settle + record)

- The canonical store shape and legacy-array migration. *Proposed:* adopt the
  record shape (`{version, verified: Record<domain,{token,verifiedAt,method}>}`)
  as canonical; update the array writer and the harness reader to it.
- The hook predicate's exact form and the hook↔engine de-dup boundary.
- Test-harness mechanics (seeded-store fixtures, fixture domains).

## 11. Decisions for the operator (change what gets built)

1. **Base write path & baseline commit.** Attach `secscan-redteam-desktop`
   with push, build M0 on latest (≥`5e3fee4a`) via a `ccr-*` branch + PR there,
   then bump the aegis pin to the M0 commit — **or** carry M0 as patches in
   aegis? *Blocks M0 code. Proposed: attach + branch/PR + pin-bump.*
2. **Breaker scope.** Keep the target-distress circuit breaker **out of M0** as
   its own milestone (M0.5)? It re-implements deleted safety behavior and
   overturns a committed test, and could outweigh the rest of M0. *Proposed: yes, split it out.*
3. **`REDTEAM_TEST_MODE` on release.** Should M0 confirm the bypass is
   unreachable on packaged release builds (and gate it out if it is)? This is a
   safety call tied to the anti-goal. *Proposed: yes, include in M0.*

## 12. Risks

- **Fail-closed regression while fixing usability.** Unifying the schema must
  not reintroduce an over-permissive path. Mitigation: the unverified-refused
  acceptance test runs alongside the verify→launch test.
- **Hook re-fit matches the tool but never trips** if the predicate isn't
  fitted to the `mcp__redteam__*`/`targetProfile` schema. Mitigation: a test
  that drives a real probe tool through the hook.
- **Payload/source drift is largely overtaken** (the tracked payload already
  carries verify-tools + both store modules + the fixed authorize guard), but
  M0's step 1 changes the store code, so the runner payload must be rebuilt at
  M0's end for the manual desktop-launch acceptance; the rest of the payload
  work stays in M2.
- **Breaker scope creep** into M0. Mitigation: Decision 2 fences it into M0.5.
