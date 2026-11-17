# SecScan RedTeam — full-codebase completeness audit (2026-11-15)

Scope: every surface in this tree — `apps/*`, `packages/*`, the desktop payload under
`apps/desktop/resources/`, and the documentation claims about all of them.
Question answered: **what is missing for the app and its components to be fully
functional**, not "what is buggy".

Read-only: no product file was modified. `pnpm run typecheck` was green (exit 0) with
the current working tree, so nothing below is a compile error.

---

## Verdict

The harness and the engagement engine are substantially complete as *implemented
artifacts*: 319 workspace packages (57 groups), ~46 cordis compositions, 14 mounted
console routes, a real battery, real scanners, a real Foundry store, and real
packaging/supervision. There is no large missing subsystem in source.

What is missing is **the wiring and release hygiene that makes existing parts true**:
security authorities and protocol/planning layers never installed, capabilities never
injected, a web data channel absent, and the packaged desktop payload older than the
source. On the platform side the fork's product composition and build gates are also
broken (default `web` ships the red-team/experimental stack and fails isolation;
`tsconfig.base.json`/cordis-config/ACP-fixture gates fail), so the tree is not in a
releasable, fully consistent state. Many fixes are wiring repairs, but the
composition, payload, and gate failures are structural.

| # | Severity | Missing piece | Effect |
|---|---|---|---|
| 1 | **P0** | Ownership verification is not on the shipped launch path | Any target can be scanned on the operator's word alone |
| 2 | **P0** | The agent-layer authorization gate can never match a real tool | Second, independent gate is dead code |
| 3 | **P0** | The two local verification stores use incompatible schemas on one file | Verification record can never be read back |
| 4 | **P1** | The plan-is-law protocol layer (A1) has no call sites | Gate, state, prompt and the `protocol_step` tool all unreachable |
| 5 | **P1** | OOB collaborator implemented, never constructed | Blind SSRF / XXE / LLM probes return null silently |
| 6 | **P1** | Web composition mounts the console client with no share channel | Every console/Foundry page is empty in web mode |
| 7 | **P1** | Packaged desktop payload predates the source fix | Desktop ships the old, broken verification code |
| 8 | **P1** | Documented auto-halt breaker no longer exists | Safety claim in `security-model.md` is false |
| 9 | **P2** | 13 engine unit tests compile into `dist-test/src` and never run | SecScan/Seclayer scoring and probe tests are dead |
| 10 | **P2** | sqlmap/nikto/john hits never become findings | Their results cannot feed proof bundles or coverage |
| 11 | **P2** | `playwright` imported but not declared | DOM-XSS and crawl rendering silently degrade |
| 12 | **P2** | Campaign CLI, work graph, abort tool documented but unreachable | "v1 surface is CLI-only" cannot be invoked |
| 13 | **P2** | Foundry dataset export (T6) and report ingestion (T5) absent | No training dataset, no report-sourced cases |
| 14 | **P2** | Personal `core/AGENTS.md` is injected into model context | Operator machine paths and personal notes reach the model |
| 15 | **P2** | 5 security-critical packages have no README; docs gate never notices | The parts an auditor must read are the undocumented ones |
| 16 | **P1** | Default `web` product ships `redteam-desktop-bundle` + 7 experimental packages | `verify-default-product-isolation` fails (21 violations); default launch is not isolated |
| 17 | **P1** | Platform gates broken: stale `tsconfig.base.json` paths, incomplete `@secscan` tsconfig mapping, broken ACP profile fixture, gates scan `_archive` | `gen-tsconfig-paths --check` / `verify-cordis-config` fail; source launch of redteam plugins resolves built `lib/` |
| 18 | **P2** | Client render paths throw for developer messages; experimental python PTC rejects `sandboxPolicy`/`timeoutMs` | Visible gaps throw at runtime in supported surfaces |
| 19 | **P3** | Repo hygiene: 64 tracked root logs, large tracked `desktop/resources` payload (362 MB), unignored empty dirs, misleading root `workspaces`, `packages/document/` absent from layout docs | Clutter, review ambiguity, and tree bloat (not a runtime break) |
| 20 | **P3** | README/FAQ/models docs assert the opposite of the code | Operators and reviewers get a false picture |

---

## P0 — the ownership-verification chain is absent end to end

This is one defect with four independently broken links. Fixing any one alone
changes nothing, which is why it survived.

**1. The verify tools are never registered.**
`apps/redteam-runner/src/ui/verify-tools.ts` defines `VERIFY_TOOLS`
(`verify_domain_start` / `verify_domain_check` / `verify_domain_list`) with full
schemas and handlers. `src/ui/mcp-tools.ts:280` composes
`TOOLS = [...COCKPIT_TOOLS, ...ENGAGEMENT_TOOLS, ...LOCAL_TOOLS]` — `VERIFY_TOOLS`
is never spread. A repo-wide search for `VERIFY_TOOLS` finds only its own definition.
No MCP client, no chat surface, and no console route can call it.

**2. The service `authorize` phase never consults a store.**
`src/phases/authorize.ts`: `viaService = deps.verify !== undefined ||
config.verifyViaService`. With no verifier injected and the env var unset — the
default in the shipped app — it calls `operatorAttestation(ctx)`. `src/gate.ts:166-168`
returns `allowed: true` for any non-empty string and falls back to the literal
`"the engagement operator"`. `engagement_launch` requires only `target` and
`objective`; `operatorName` and `client` are optional. Net: a scan is authorized by
typing a hostname.

**3. The agent-layer gate is inert.**
`packages/redteam/auth-gate/src/hook.ts:78-80`: `isScanTool` matches the base name
`scan_url`. `scan_url` exists only in that package's tests and in proof-bundle step
labels (`proof/bundle/steps.ts:11,35`); no tool registers it. The real scan tool is
`secscan_exec`. So the `tools/pre-execute` hook installed by
`harness-plugin/src/auth-gate.ts` runs on every tool call and matches none of them.

**4. The verification records are written and read in two shapes.**
Both `packages/redteam/auth-gate/src/local.ts` and `.../local-store.ts` use
`~/.secscan-redteam/verified-domains.json`.
`local.ts` writes `{verified: string[], pending: Record<string,string>}`.
`local-store.ts` reads `{version, verified: Record<domain,{token,verifiedAt,method}>}`.
`coerceStore` runs `asRecord` on the array form, which yields `{}` — so
`verify_domain_list` always reports zero domains, and the writer's records survive
only as an unreadable array. Whichever half ships, the other half's data is dropped.

**Also stale in the same chain:** `gate.ts:180,291` still instruct the operator to run
`start_domain_verification`, and `src/mcp.ts:133-138` calls
`start_domain_verification` / `list_verified_domains` on an external service. Neither
tool exists in this build; the local names are `verify_domain_*`.

**Minimum repair (in this order):** spread `VERIFY_TOOLS` in `mcp-tools.ts`; make
`authorize.ts` require a record for the target and fail closed; align `local.ts` and
`local-store.ts` on one schema; retarget `isScanTool` at `secscan_exec`; replace the
stale tool names in `gate.ts` and `mcp.ts`. Then a test that launches an engagement
against an unverified domain through the real MCP tool path and gets a refusal.

---

## P1 — capabilities that exist and never run

### The plan-is-law protocol layer (A1) has no call sites
Four pieces of one feature, each complete on its own and each unreachable:

- `dispatch/protocol-gate.ts:35` exports `checkProtocolGate`. `dispatch/router.ts:29-58`
  runs tier, scope, duplicate, lockout, variant and policy gates and never calls it;
  `dispatch/handlers.ts` registers no protocol handler.
- `context.ts:164-170` declares `ctx.protocol`, but nothing ever writes it — the only
  read is `protocol-gate.ts:41`.
- `protocol_step` is the tool the gate is written to exempt (`protocol-gate.ts:25`) and
  the one the target-protocol prompts instruct seats to call. It is in no tool catalog,
  so a seat that follows the prompt gets `DENIED: unknown tool`.
- `prompts/target-protocol.ts:683` `protocolPromptBlock` has zero callers, so no seat
  ever receives the protocol text in the first place.

`test/target-protocol.test.ts:264-278` asserts `protocol_step` is a "live catalog name";
it is not. The whole layer is dead code plus tests, and `docs/architecture.md` describes
it as an enforced invariant.

### OOB collaborator
`apps/redteam-runner/src/net/oob-listener.ts` implements `createLoopbackOob` /
`withLoopbackOob` — 24-byte tokens, loopback-only bind, cleanup on disposal. **No
caller exists in `src/`.** `dispatch/seclayer.ts:211` calls
`runRedTeamProbes(url, headers, {})` and `dispatch/seclayer-dast.ts:99` passes `{}`,
so `ctx.oob` is always `undefined`. `probes/blindSsrf.ts`, `aggressive/xxe.ts` and
`llmProbe.ts` are written against a collaborator that is never constructed, and
`tools/seclayer.ts:49` documents the consequence: *"Blind SSRF no-ops unless a
collaborator is configured in-process (it is not, in this build)."*

### Web has the console UI and no console data channel
`packages/bundle/web-app/cordis.patch.yml:268` mounts
`@deepseek-ai/dsh-client-ui-redteam-console`. No `redteam-console-share` row exists
in that patch (desktop has it at `desktop-bundle/cordis.patch.yml:314`). The client
renders and every call it makes — engagement views, SSE feed, scope tallies, Foundry
`/verify`, `/run-gold`, `/loop` — has no registered route. This is FOUNDRY-TASKS T2,
and it is broader than Foundry: the entire console is blank in web mode.

### The packaged payload is older than the source
`apps/desktop/resources/redteam-runner/` is a tracked artifact (16,095 files, ~362 MB,
rebuilt ~03:17) shipping `0.1.7-rc.7`. Its `@secscan/redteam-auth-gate/lib/types/`
contains only `hook|index|server|verify` — no `local.*`, no `local-store.*` — and its
`dist/ui/` has no `verify-tools.js`. Six runner source files in `apps/redteam-runner/src`
and `packages/redteam/auth-gate/src/index.ts` were modified after that rebuild and are
still uncommitted, so the desktop app runs a payload that does not match source and has
neither half of the verification store.

A `lib.bak-20261108-052337/` backup tree also sits under
`.../@secscan/redteam-fleet-skills/`, and `provenance.json` names a foreign source path
even though `vendor-redteam-runner.mjs` rebuilds from in-repo source by default.

---

### Documented safety controls that no longer exist
`docs/product/security-model.md:35-36` and `docs/architecture.md:62` promise a
target-distress circuit breaker and auto-halt. `test/killswitch-removed.test.ts:107-151`
asserts that six consecutive 500s **all execute** and no `target_auto_halt` event is
emitted; the code matches the test, not the doc. `src/safety/index.ts:9` still describes
"the stop-signal class (ESTOP, abort.json, auto-halt…)" though the auto-halt code is
deleted. `abort_engagement` is likewise listed in `docs/architecture.md:66` and
`docs/product/mcp-services.md:21`; `src/tools/compose.ts:80` records its removal, while
`ui/routes/console-scope.ts:21` still names it as the kill switch. An operator reading
the safety model would believe a runaway engagement halts itself.

### test coverage that is compiled and never run
`apps/redteam-runner/package.json:24` runs `dist-test/test/*.test.js` only. The 13
`src/**/*.test.ts` files (SecScan scoring, DNS checks, crawler, Supabase probes, tech
fingerprint, Seclayer scoring, API probes, auth-rate-limit, host-header injection, weak
session token, baseline) therefore compile into `dist-test/src/**` and are never
executed by any runner. Root `vitest.config.ts:123-128` matches
`apps/*/tests/**/*.spec.ts`, which this app does not use. So the engine's own unit
tests are dead, and the file count understates real coverage.

## P2 — partial features and quiet hazards

### Tool output that stops at the process boundary
`src/xtool/executor.ts:229-234` builds `findings` for `ffuf` and `gobuster` only; every
other tool — sqlmap, nikto, john — returns `[]` on both the success and timeout paths
(`:217`). Their hits survive as free text in `message`, so they cannot become proof-bundle
items, cannot move coverage beyond a category note, and cannot be graded. The three
highest-signal external tools are the three whose output the platform discards.

### Undeclared dependency
`src/seclayer/server/domXss.ts:95-110` and `render.ts:66-70` dynamically import
`playwright`. `package.json` does not list it and the vendored payload does not ship it,
so DOM-XSS coverage and JS-rendered crawling degrade to a console warning on a default
install. `src/browser/cdp.ts:20,45-62` gates browser automation behind an env var as well.

### Documented entry points with no caller
- `runCampaignCli` (`src/campaign/cli.ts:121`) is re-exported from `src/campaign/index.ts:142`
  and called from nowhere; `main()` (`src/cli/commands.ts:160-265`) has no campaign
  branch. The documented "v1 surface is CLI-only" cannot be reached.
- `executeFlow` (`src/workgraph/executor.ts:50`) and `nextReady` are called only from
  `test/workgraph.test.ts`; `phases/plan.ts`/`phases/tasks.ts` use only the bookkeeping
  half. The work graph is recorded and never executed or scheduled.
- `withLoopbackOob` is called only from `test/oob-listener.test.ts`.

### Dead hooks and inert guards
`src/msf/executor/auxiliary-console.ts:39` `tryAuxiliaryConsole` has no production caller
and still reads the retired `REDTEAM_MSFRPC_USER`/`PASS` "to keep the daemon path" that
was removed. `NEAR_DUP_IGNORED_KEYS` is a documented empty object
(`src/dispatch/duplicate-guard.ts:68`), so the near-duplicate suppression it describes
never fires. `src/dispatch/xtool.ts:161-162` ends in an empty `finally {}`.

### Foundry
Capture, sanitize, classify, tiering, store, gold loop, gate and the console page are
real and wired (see the verified chain below). What is missing:

- **T5** report/deliverable ingestion as a second case source — no code path.
- **T6** dataset export to `SecScan-Training-Datasets` — no exporter exists.
- **GOLD is never assigned.** `capture.ts:13-14` says so and `store.ts` only records
  the tier; the "editor adjudication" step that would mint GOLD is nowhere.
- **T4 is actually done** — `harness2/trajectory.ts:270` already wraps capture in its
  own `try`, contrary to its own task list. `FOUNDRY-TASKS.md` is stale.
- The Nov-4 PC engagements minting nothing (T3) is still unexplained; the diagnostic
  instrument (`foundry_capture` event) exists but has never been read.

**Foundry gate packaging.** `packages/redteam/foundry-gate/package.json` omits the
`files` array and the `dist-hash` build step every sibling has, so what the packer
copies differs between packages. T7 says `locateFoundry` still reports "not located"
in installed builds.

**Personal context injection.** `harness-plugin/src/local-profile.ts:27-35` loads a
24,463-byte `core/AGENTS.md` containing the operator's home paths and personal
war stories into the model's context for the local-model profile. That is both a
privacy leak and a behavior change nobody reviewed.

**Dead scaffolding and dead dependencies.** `account-backend.ts` and
`preload-platform-account.ts` are unreferenced while the account settings UI ships;
`harness-plugin/package.json` declares `@deepseek-ai/dsh-mcp-client` and
`@secscan/redteam-foundry-gate`, neither of which the package imports.

**Undocumented switch.** `DSH_MCP_ALLOW_PLAINTEXT=1` is read by the MCP client but
appears in no doc — an operator can silently weaken transport enforcement.

**Deleted tests.** The working tree deletes `test/msf-module-source.test.ts` and
`test/plan-step-text.test.ts` with no replacement, against a per-file 100% coverage
gate. Fine only if the corresponding source is genuinely gone; it is not.

**Documentation coverage.** 314 of 319 packages have a README. The 5 without are:
`redteam/auth-gate`, `redteam/desktop-bundle`, `redteam/foundry-gate`,
`redteam/harness-plugin`, `redteam/llm-router`. `scripts/doc-standard.readme-cases.ts:18`
glob-matches `packages/*/*/README.md`, which validates files that exist and never
requires one. The one security-critical package group is the one that escaped the gate.

---

## Platform, product composition, and build health

### Default product isolation is broken (gate-verified)
`verify-default-product-isolation` fails with **21 violations** (confirmed).
`packages/boot/app-boot/src/profile.ts` puts `@secscan/redteam-desktop-bundle` in the
shipped `web` template, and `packages/redteam/desktop-bundle/cordis.patch.yml` pulls 7
`dsh-experimental-*` packages (`agent-team`, `tool-agent-team`, `client-ui-agent-team`,
`speech-to-text`, `speech-to-text-sensevoice`, `api-speech-to-text`,
`client-ui-voice-input`). Upstream policy forbids experimental packages in the default
product and the bundle is not an allowed optional bundle, so every default `dsh web`
launch ships the red-team/experimental surface.

### Repository gates and source-launch mappings are broken (gate-verified)
- `gen-tsconfig-paths --check` fails: `tsconfig.base.json` has 4 stale path entries
  (`@deepseek-ai/dsh-session/chunk-rows`, `dsh-agent-preset-registry/tools`,
  `dsh-agent/brand`, `dsh-client-ui-jobs/invariant`) pointing at deleted sources.
- `verify-cordis-config` fails: the hand-written `@secscan` mapping block omits
  `command-redteam`, `fleet-skills`, and `foundry-gate`, so source launch of the
  redteam bundle resolves those plugins through built `lib/` instead of tsx source,
  contrary to the source-launch contract. `apps/cli/tests/profiles/acp/cordis.yml` is a
  broken 59-byte stub (not a Loader entry array).
- Repo-wide gates also walk tracked/ignored-in-tree `_archive/**` copies (~806 MB on
  disk), producing phantom failures and slowing checks.

### User-visible runtime gaps
`packages/client/ui-chat/src/client/conversation-nodes/message.ts:56` and
`packages/client/ui-trajectory/src/client/trajectory-message-definitions.ts:141` throw
`"... developer messages are not supported yet"` during render.
`packages/experimental/ptc-runtime-python/src/index.ts:1038-1051` rejects
`sandboxPolicy` and per-call `timeoutMs`. `packages/host/directory-picker-native/src/native-picker.ts:106`
and `packages/util/native-command/src/path-opener.ts:202,315` throw on unsupported
platforms but have `-auto`/`-browse` fallbacks.

### Hygiene (non-breaking)
64 tracked root `*.log` files (no root `*.log` ignore rule), tracked
`apps/desktop/resources/` payload (362 MB), untracked/unignored empty `nested/` and
`undefined/temp/tsx-Cho-zen/`, on-disk `_archive/`/`runner/`/`live/`, a misleading root
`workspaces` list vs `pnpm-workspace.yaml`, and `packages/document/` missing from the
`AGENTS.md` layout list. ~38 TODO/FIXME markers are narrow (no "not implemented" throws
beyond the renderers above).

---

## P3 — documentation that contradicts the code

- `README.md:21,94` lists Arsenal, L0/L1/L2 memory and Spark as not shipped. All three
  are implemented and registered (`src/arsenal/` 24 modules + a 1,039-entry
  `resources/arsenal/arsenal.db`; `src/memory/` 29 modules wired at `phases/run.ts:33`
  and `phases/exploit.ts:9`; Spark 1.2/1.1 at `llm-meta/src/models.ts:47-50` and
  `llm-router/src/providers/meta.ts:53-56`).
- `docs/product/engines-and-coverage.md:22` says "24 named attack hypotheses";
  `src/battery.ts` defines **28** (L-1…L-8, F-1…F-12, V-1…V-8).
- `README.md:21` and `docs/configuration.md:46` call verification "server-authoritative",
  which `docs/mcp-services.md:7` and `docs/faq.md:15` contradict; the code agrees with
  the latter.
- `docs/faq.md:9` names `start_domain_verification` / `list_verified_domains`, which do
  not exist in this build.
- `packages/redteam/desktop-bundle/cordis.patch.yml:251` says "108 tools today"; the
  bridge patch ships 109.
- `docs/product/models.md:7-16` states a two-seat Meta arrangement and that the
  provider default follows the router; `llm-router/src/policy.ts:53,85-91` defaults to
  DeepSeek.
- `docs/product/overview.md:9` says the app has no account; the account settings UI and
  controller are mounted.
- `README`/Foundry docs describe the report as "designed HTML rendered in-thread";
  `report-tools.ts:118-124` returns Markdown and the HTML is an `<iframe>` preview in
  `EngagementReportRow.tsx:145`.

---

## What is verified working (so the report is not read as "nothing works")

- **Routes:** all 14 `src/ui/routes/*.ts` modules exist and are dispatched from
  `ui/server.ts`, including `foundry` with `/verify`, `/run-gold`, `/loop`.
- **Grading:** `report/grading.ts` delegates to `#seclayer/server/scoring.js`; weights
  35/25/15/5/0, damping ×0.5/×0.25 cap 40 floor 60, anchors 20/F and 45, score floor
  10 — matches `docs/product/engines-and-coverage.md:32-37`.
- **Engine registry:** `src/toolchain.ts:31` defines 7 external tools plus `msfconsole`,
  driven as local processes (`src/msf/`), no RPC. Matches the doc.
- **Foundry chain:** `runEngagement` finally → `captureEngagementTrajectory`
  (`harness2/trajectory.ts:200`) → `captureFoundryCases` → `<engagements>/../foundry-store/`,
  failure-isolated, with a `foundry_capture` receipt in every outcome. SILVER cap is
  implemented at `capture.ts:111-115`.
- **Desktop composition:** 13 rows, fleet bounds 100/4/25/4096, deliberate disabling of
  direct subagents and `workflow` so all delegation is rostered. That is a decision, not
  a gap.
- **Harness internals:** 319 packages with manifests/source/tsconfig/lib, 359 refs and
  export targets resolve, 1611 tests in tree, typecheck green — but repository gates
  for default-product isolation, tsconfig paths, and cordis-config are currently failing.

---

## Remediation order

1. **Reconnect ownership verification** (P0): spread `VERIFY_TOOLS`; enforce a per-target
   record in `authorize.ts`; unify the two store schemas; retarget `isScanTool` to
   `secscan_exec`; purge stale tool names. Add an end-to-end refusal for unverified targets.
2. **Repair product composition and gates** (P1): remove/relocate `redteam-desktop-bundle`
   from the default `web` template or make it a permitted optional bundle without
   experimental deps; fix stale `tsconfig.base.json` paths and the `@secsec`/`@secscan`
   mappings (`command-redteam`, `fleet-skills`, `foundry-gate`); repair the ACP profile
   fixture; stop gates from walking `_archive`.
3. **Rebuild and ship the desktop payload** (P1): rebuild from current source so
   `local*`, `local-store`, and `dist/ui/verify-tools.js` are present and committed
   source matches the payload; delete `lib.bak-*`; align `provenance.json`.
4. **Wire missing runner capabilities** (P1): inject `withLoopbackOob` into seclayer
   dispatch and assert blind-SSRF; add `redteam-console-share` to `bundle/web-app`;
   either wire or remove the A1 protocol layer (`checkProtocolGate`, `ctx.protocol`,
   `protocol_step`, `protocolPromptBlock`) and reconcile docs/tests.
5. **Restore safety and tool-result integrity** (P1/P2): reinstate or remove-and-redocument
   auto-halt/`abort_engagement`; make sqlmap/nikto/john emit structured findings; add
   `playwright` as an explicit optional dependency or gate DOM/crawl features honestly.
6. **Fix test coverage and dead surfaces** (P2): run the 13 `src/**/*.test.ts` engine
   tests (or move them) in CI; restore/replace deleted tests; wire or remove campaign
   CLI, work-graph execution, `tryAuxiliaryConsole`, near-duplicate guard config.
7. **Foundry and context** (P2): T5 ingestion, T6 export, GOLD adjudication, T3
   diagnosis, `foundry-gate` packaging; stop injecting personal `core/AGENTS.md`.
8. **Docs and hygiene** (P3): READMEs for 5 red-team packages, correct false README/FAQ/
   models/security claims, document `DSH_MCP_ALLOW_PLAINTEXT`, remove dead deps/scaffolding,
   and clean tracked logs/duplicate trees.
