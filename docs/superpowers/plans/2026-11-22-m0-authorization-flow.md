# Aegis Workstation M0 — Authorization Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the red-team runner's ownership-verification flow correct end to end — a verified owner can launch against their domain, an unverified domain is refused, the dead agent-layer gate fires on the real scan tool, and the `REDTEAM_TEST_MODE` bypass cannot point a packaged release build at a public target.

**Architecture:** Three independent repairs in the base repo `secscan-redteam-desktop`, all in the authorization path. The runner's launch gate (`gate.ts`) already reads a *record*-shaped store and already fails closed; the defect is that the lone writer (`LocalDomainVerifier` in `auth-gate/local.ts`) persists a divergent *array* shape, so verified owners can't launch. We converge the writer onto the record `StoreDoc` shape (Task 1), retarget the agent-layer pre-execute hook from the nonexistent `scan_url` to the real `secscan_exec` (Task 2), and constrain test-mode so it can't bypass ownership for a public target on a release build (Task 3).

**Tech Stack:** TypeScript 5.9, Node `^22.19.0 || >=24`, pnpm 11.7, `node:test` runner for `@secscan/redteam-runner` (compiled to `dist-test` then `node --test`).

**Spec:** `docs/superpowers/specs/2026-11-22-aegis-workstation-design.md` (this repo, `aegis-red-agents`). M0 is §9; the decisions it rests on are §11.

## Global Constraints

- All code paths below are in the **base repo** `secscan-redteam-desktop` at **≥ `5e3fee4a`**, consumed by this platform repo through the submodule pin. Land M0 there on a `ccr-*` branch + PR, then bump the pin (spec §9a, Decision 1).
- Node engine floor `^22.19.0 || >=24`; TypeScript `>=5 <7`; pnpm `11.7.0`.
- **Preserve fail-closed.** Every change keeps the property that uncertainty → deny. No change may introduce a path that authorizes an unverified public target.
- Do **not** relicense: base harness MIT, `@secscan/*` UNLICENSED/private.
- The verified-domain store **is** the authorization record; writes stay atomic (temp-file + rename, mode 0600) and every unparseable read falls back to empty, never to an approval.
- Public API of `LocalDomainVerifier` (`create`, `startVerification`, `checkVerification`, `isVerified`) and of `checkAuthorization` must not change signature — only the persisted shape and internals move.

## Review Focus

- **Legacy array-shape store on disk** from a prior install (`{verified: string[], pending}`): must migrate to record shape on read, not silently drop (Task 1 owns the test).
- **Corrupt / partial / empty store file**: fail closed to "nothing verified", never throw an approval or crash the gate (Task 1 test).
- **Domain normalization**: trailing dot, uppercase, `https://host/path` vs bare `host`, apex vs subdomain — writer and reader must normalize identically so a domain verified one way is readable the other (Task 1 test).
- **`secscan_exec` with missing/unparseable `url`** under active tier: hook denies cleanly with a reason, does not throw (Task 2 test).
- **`REDTEAM_TEST_MODE=1` with a public in-scope target on a release build**: ownership verification must still be required (Task 3 test).

---

### Task 0: Establish the base-repo working branch and baseline green

**Prerequisite (execution-time, not a code change):** attach `secscan-redteam-desktop` with push, clone fresh at the attached path, create branch `ccr-cf069694-sllpw7`. (Per Decision 1.)

- [ ] **Step 1: Confirm baseline builds green** — `pnpm --filter @secscan/redteam-runner run typecheck`
  Expected: exit 0.
- [ ] **Step 2: Confirm the runner suite is green before changes** — `pnpm --filter @secscan/redteam-runner test`
  Expected: pass (record the count; it is the before-state for M0).
- [ ] **Step 3: Confirm the failing user-visible symptom** — write a throwaway note (not committed) that `checkVerification` of a domain followed by `verify_domain_list` returns `[]`, reproducing the inverted bug. This anchors Task 1's test.

---

### Task 1: Converge the verification store on the record `StoreDoc` shape

**Files:**
- Modify: `packages/redteam/auth-gate/src/local.ts` — `LocalDomainVerifier` persists/reads `StoreDoc` (record), not `VerificationRecord` (array); keep the injectable `LocalVerifierDeps` surface.
- Modify: `packages/redteam/auth-gate/src/local-store.ts` — extend `coerceStore` to migrate a legacy `verified: string[]` into `verified: Record<domain, VerifiedRecord>`.
- Modify: `packages/redteam/auth-gate/src/index.ts` — only if exported helper names change (prefer keeping `withPending`/`withVerified`/`recordIsVerified`/`emptyRecord` names, re-typed to the record shape).
- Test: `apps/redteam-runner/test/verify-store-unification.test.ts` (new).

**Interfaces:**
- Consumes: `StoreDoc`, `PendingRecord`, `VerifiedRecord`, `coerceStore`, `emptyStore`, `defaultVerificationStoreFile` from `./local-store.js`; `extractDomain`, `normalizeDomain` from `./verify.js`.
- Produces (unchanged signatures): `LocalDomainVerifier.create(storePath?): LocalDomainVerifier`; `.startVerification(domain: string): Promise<{recordName: string; token: string}>`; `.checkVerification(domain: string): Promise<boolean>`; `.isVerified(domain: string): Promise<boolean>`. On-disk shape is now `StoreDoc`.
- Migration rule: a legacy array entry `d` becomes `verified[normalize(d)] = { token: '(migrated)', verifiedAt: <ISO now>, method: 'dns-txt' }`; `coerceStore`'s non-empty-field drop must admit this synthesized form.

- [ ] **Step 1: Write the failing test** — `apps/redteam-runner/test/verify-store-unification.test.ts`

```ts
// node:test; a temp store file via REDTEAM_VERIFIED_DOMAINS_FILE, resolveTxt stubbed.
test('verified domain is readable by every reader', async () => {
  // startVerification -> publish token (stub resolveTxt to return it) -> checkVerification
  // THEN: VerificationStore.load().verified has the domain key,
  //       verify_domain_list returns [domain],
  //       checkAuthorization(domain) => { allowed: true }
});
test('unverified domain fails closed in checkAuthorization', async () => {
  // no record -> checkAuthorization(domain) => { allowed: false }
});
test('legacy array store migrates on read', async () => {
  // seed file = {"verified":["acme.example"],"pending":{}}
  // checkAuthorization('acme.example') => { allowed: true }
  // verify_domain_list contains 'acme.example'
});
test('corrupt store is empty, not an approval', async () => {
  // seed file = "{not json" -> checkAuthorization(any) => { allowed: false }, no throw
});
test('normalization: verify apex, read HTTPS URL form', async () => {
  // verify 'acme.example'; checkAuthorization('https://acme.example/x') => allowed
});
```

- [ ] **Step 2: Run the test, verify it fails** — `pnpm --filter @secscan/redteam-runner test`
  Expected: the "readable by every reader", "legacy array", and "normalization" cases FAIL (writer still array-shaped).
- [ ] **Step 3: Extend `coerceStore` in `local-store.ts`** to migrate a legacy `verified: string[]` (array of domain strings) into record entries per the migration rule; leave existing record parsing intact.
- [ ] **Step 4: Re-point `LocalDomainVerifier` in `local.ts`** at the record shape: `load()` parses via `coerceStore` → `StoreDoc`; `startVerification` sets `doc.pending[d] = {token, createdAt: now}`; `checkVerification` on TXT match sets `doc.verified[d] = {token, verifiedAt: now, method:'dns-txt'}` and clears pending; `isVerified`/`recordIsVerified` test `normalize(d) in doc.verified`. `save()` writes `StoreDoc`. Keep deps injectable.
- [ ] **Step 5: Run the test, verify it passes** — `pnpm --filter @secscan/redteam-runner test`
  Expected: all five PASS.
- [ ] **Step 6: Typecheck** — `pnpm --filter @secscan/redteam-runner run typecheck` (and auth-gate `typecheck`). Expected: exit 0.
- [ ] **Step 7: Commit** — `feat(auth-gate): converge verification store on record shape so verified owners can launch`

---

### Task 2: Bring the agent-layer gate live on `secscan_exec`

**Files:**
- Modify: `packages/redteam/auth-gate/src/hook.ts` — `isScanTool` recognizes `secscan_exec` (base name), retaining `scan_url` tolerance.
- Test: `apps/redteam-runner/test/auth-gate-hook-secscan-exec.test.ts` (new).

**Interfaces:**
- Consumes: `decide(event: PreExecuteEvent, ctx: GateContext): Promise<GateDecision>`, `isScanTool(toolName: string): boolean`, with `wantsActiveTesting`/`targetDomain` unchanged. `secscan_exec` carries `url` (target) and `depth` (`'deep'` = active tier); it is **not** an `mcp__redteam__*`/`targetProfile` host probe, so `isHostFamilyProbe` stays false and the deliberate host-scope pass-through is unaffected.
- Produces: no new exports; `isScanTool('secscan_exec') === true`.

- [ ] **Step 1: Write the failing test** — `apps/redteam-runner/test/auth-gate-hook-secscan-exec.test.ts`

```ts
const allow = { isVerified: async () => true };
const deny = { isVerified: async () => false };
test('active secscan_exec on unverified domain is denied', async () => {
  const d = await decide({toolName:'secscan_exec', arguments:{url:'https://acme.example', depth:'deep'}}, deny);
  assert.equal(d.kind, 'deny');
});
test('active secscan_exec on verified domain is allowed', async () => {
  const d = await decide({toolName:'secscan_exec', arguments:{url:'https://acme.example', depth:'deep'}}, allow);
  assert.equal(d.kind, 'allow');
});
test('passive secscan_exec is allowed regardless', async () => {
  const d = await decide({toolName:'secscan_exec', arguments:{url:'https://acme.example', depth:'passive'}}, deny);
  assert.equal(d.kind, 'allow');
});
test('active secscan_exec with no parseable url is denied cleanly', async () => {
  const d = await decide({toolName:'secscan_exec', arguments:{depth:'deep'}}, deny);
  assert.equal(d.kind, 'deny');
});
```

- [ ] **Step 2: Run the test, verify it fails** — `pnpm --filter @secscan/redteam-runner test`
  Expected: the deny/allow cases FAIL (hook still matches only `scan_url`, so everything is allowed).
- [ ] **Step 3: Update `isScanTool`** in `hook.ts` to return true when `baseName(toolName)` is `secscan_exec` (keep `scan_url`). Update the module doc comment's example tool name accordingly; leave the host-family pass-through argument intact.
- [ ] **Step 4: Run the test, verify it passes** — `pnpm --filter @secscan/redteam-runner test`. Expected: all PASS.
- [ ] **Step 5: Confirm no double-gate conflict** — add one assertion (same file) that an active `secscan_exec` on a verified domain returns `allow` (hook defers to the engine's own deep-tier enforcement rather than blocking it). Run; expected PASS.
- [ ] **Step 6: Commit** — `fix(auth-gate): fire the tool-layer gate on secscan_exec, not the nonexistent scan_url`

---

### Task 3: Constrain `REDTEAM_TEST_MODE` so it cannot bypass ownership for a public target

**Decision recorded (builder call, spec §11 Decision 3 — vetoa­ble at plan review):** test mode may bypass ownership verification **only when every in-scope host is private/loopback** (local-sandbox). With any public host in scope, `REDTEAM_TEST_MODE=1` no longer lifts ownership verification. This closes the anti-goal (a packaged release pointed at a public target on the operator's word) while keeping test mode usable for loopback labs.

**Files:**
- Modify: `apps/redteam-runner/src/phases/config.ts` (the `testMode` resolution at ~:110) and/or `apps/redteam-runner/src/phases/authorize.ts:88` (the test-mode branch) so the ownership-bypass half of test mode is conditioned on all-private scope.
- Test: `apps/redteam-runner/test/test-mode-release-gate.test.ts` (new).

**Interfaces:**
- Consumes: the resolved runner config (`testMode: boolean`), `ctx.hosts`, and `isPrivateOrLoopbackHost` (from `prober.js`, already used by `gate.ts`).
- Produces: the authorize phase, under `REDTEAM_TEST_MODE=1` with any public in-scope host, falls through to the normal verification gate (not the bypass).

- [ ] **Step 1: Write the failing test** — `apps/redteam-runner/test/test-mode-release-gate.test.ts`

```ts
test('test mode does NOT bypass ownership for a public target', async () => {
  // config.testMode = true (REDTEAM_TEST_MODE=1), in-scope host 'acme.example' (public),
  // no verification record -> authorizePhase => verdict.allowed === false
});
test('test mode still bypasses for an all-loopback scope', async () => {
  // config.testMode = true, in-scope host '127.0.0.1' -> authorizePhase => allowed === true
});
```

- [ ] **Step 2: Run the test, verify it fails** — `pnpm --filter @secscan/redteam-runner test`
  Expected: the public-target case FAILS (test mode currently bypasses unconditionally).
- [ ] **Step 3: Gate the bypass** — in `authorize.ts`, enter the test-mode bypass branch only when `ctx.hosts.every(isPrivateOrLoopbackHost)`; otherwise skip the bypass and run the normal verification path below it. Keep the loud `test_mode_active` event when the bypass does apply.
- [ ] **Step 4: Run the test, verify it passes** — `pnpm --filter @secscan/redteam-runner test`. Expected: both PASS.
- [ ] **Step 5: Regression** — run the existing test-mode and gate suites (`authorize`, `gate-scope`, `verified-scope-persistence`) to confirm no loopback/test-mode flow broke. Expected: green.
- [ ] **Step 6: Commit** — `fix(runner): test mode may not bypass ownership for a public target`

---

### Task 4: Milestone acceptance — the shipped launch path refuses an unverified target

**Files:**
- Test: `apps/redteam-runner/test/m0-acceptance.test.ts` (new) — drives an engagement launch through the real MCP tool path (`TOOLS` from `ui/mcp-tools.ts`), not an injected verifier and not test mode.

- [ ] **Step 1: Write the acceptance test** exercising the real composition with a pre-seeded store at `REDTEAM_VERIFIED_DOMAINS_FILE`:

```ts
test('verify -> launch succeeds for an owned domain (real tool path)', async () => {
  // seed store (record shape) with 'acme.example' verified; engagement_launch({target,objective})
  // => authorized / running, not refused
});
test('launch is refused for an unverified domain (real tool path)', async () => {
  // empty store; engagement_launch => refused with the verification remediation
});
test('verify_domain_list reflects a freshly written record', async () => {
  // checkVerification (stub TXT match) then call the verify_domain_list tool => contains the domain
});
```

- [ ] **Step 2: Run it** — `pnpm --filter @secscan/redteam-runner test`. Expected: all PASS (these fail before Tasks 1–3).
- [ ] **Step 3: Full suite + typecheck green** — `pnpm --filter @secscan/redteam-runner run typecheck && pnpm --filter @secscan/redteam-runner test`. Expected: exit 0, suite green.
- [ ] **Step 4: Manual desktop check (documented, not automated)** — rebuild the runner payload and confirm the packaged launch path refuses an unverified public target and accepts a verified one. Record the result in the PR. (Payload rebuild is the one piece of M2 that M0 pulls forward; the rest of M2 stays deferred.)
- [ ] **Step 5: Commit** — `test(runner): M0 acceptance — fail-closed launch and verified-owner launch on the real tool path`

---

## Self-Review

**Spec coverage (§9 M0 work):** (1) unify store schema → Task 1. (2) bring agent-layer gate live → Task 2. (3) decide `REDTEAM_TEST_MODE` release exposure → Task 3. Acceptance bullets (verify→launch, unverified refused, hook fires, real-composition seeded store, typecheck green) → Task 4. The breaker is **M0.5**, out of scope here (spec §8, Decision 2). Covered.

**Step scan:** each step is one action — a named test with assertions, a single-file edit with the exact shape rule, or a run command with an expected result. Bodies are test names/assertions, not implementations; the one algorithm that could be ambiguous (legacy migration) is pinned by an explicit rule in Task 1's Interfaces.

**Type consistency:** `StoreDoc`/`PendingRecord`/`VerifiedRecord` used in Task 1 are the `local-store.ts` exports; `LocalDomainVerifier` and `checkAuthorization` signatures are unchanged; `decide`/`isScanTool`/`GateContext` in Task 2 match `hook.ts`; `isPrivateOrLoopbackHost` in Task 3 is the `prober.js` export `gate.ts` already uses.

**Review Focus:** legacy array (Task 1 Step 1 case 3), corrupt store (case 4), normalization (case 5), unparseable `url` (Task 2 case 4), public-target test mode (Task 3 case 1) — each pinned to the owning task's tests.

**Proportion:** three one-to-few-line source edits plus their tests; the plan is signatures + test names, not bodies. In proportion to §9.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-22-m0-authorization-flow.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — a fresh subagent implements each task and a fresh reviewer checks it before the next starts, then a whole-branch review. Most thorough; a fresh context per task/review.
- **Native** — I implement every task myself in this session, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest.

For this plan I recommend **subagent-driven**, because the tasks touch the authorization spine where a shipped mistake is a safety failure, and Tasks 1–3 are near-independent (clean interfaces, little shared state) so per-task review is cheap insurance. Does the plan capture what you want, and which approach should we use?
