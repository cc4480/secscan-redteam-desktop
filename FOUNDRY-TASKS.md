# Foundry — task breakdown (Carlos's orders 2026-10-25, 2026-11-07 09:05, 2026-11-07 13:28)

Directive: the Foundry lives **in the app** — in every scan, creating dataset
cases from the scans themselves, visible in the console. **Not a standalone.**
Plus (2026-11-07): synthetic-data creation must actually start, and the app's
test-run reports are an additional data source.

## Layout — where everything lives

| Piece | Location |
|---|---|
| In-app surface | The **Foundry panel** in the console client: `packages/client/ui-redteam-console/src/client/FoundryPage.tsx` (state cards + Verify / Run Gold / Run Loop buttons), driven by `foundry-face.ts` → `api.ts` → same-origin share routes `redteam-console/api/foundry[/verify\|/run-gold\|/loop]` |
| Host data channel | `packages/redteam/console-share` — registers the share prefix on the Host's webServer and proxies `/api/*` to the runner console with the bearer attached in-process (`src/index.ts`, `src/proxy.ts`) |
| Runner API | `apps/redteam-runner/src/ui/routes/foundry.ts` — GET state, POST verify / run-gold / loop; routed in `src/ui/server.ts` |
| Engine | `apps/redteam-runner/src/foundry/` — `capture.ts` (scan → cases), `sanitize.ts` (fail-closed DLP), `classify.ts`, `store.ts` (registry), `loop.ts` + `mutate.ts` + `fitness.ts` (Gold Loop: synthetic mutants), `locate.ts` + `gate.ts` (frozen-snapshot gate), gate package `packages/redteam/foundry-gate` (snapshot + CLI) |
| Creation trigger | Automatic: `runEngagement`'s finally block (`src/phases/run.ts`) → `captureEngagementTrajectory` (`src/harness2/trajectory.ts`) → `captureFoundryCases`. Reached from every launch path: console POST / chat `engagement_launch` tool (`src/ui/engagement-tools.ts` → `handleLaunch`), CLI, campaign, watch |
| Where minted cases persist | The **app-data Foundry store**: `<engagements root>/../foundry-store/` — `registry.json`, `bundles/<case-id>/case.json`, `sanitizer-notes.jsonl`, `loop-state.json`. On the PC desktop app the engagements root is `<userData>/engagements/live` (supervisor: `apps/desktop/src/main.ts`, spawn in `apps/desktop/src/redteam-runner.ts`), so the store is `<userData>/foundry-store/` |
| Where finished datasets land | **Not yet built in-app** (Task T6). Target: PC `C:\Users\Cho-zen\Desktop\SecScan-Training-Datasets\` (facility JSONL shape); server copies: an export dir under the app data dir |
| Test reports as data source | **Not yet built** (Task T5). Source: completed engagements' report/deliverables in the engagements root |

## Slice 1 trace (2026-11-07, this tree @ bedb17cd + working changes) — every link PRESENT + WIRED

Chain proven end to end in-process (no server started): a fake completed
engagement with one cell-proven live finding → completion hook minted
`case-df133bf7e61ee29d` (SILVER, sqli) into the store → the real
`handleFoundry` returned that exact id in `store.cases` → one Gold Loop cycle
scored it, generated 1 mutant, registered 1 survivor (store: 2 cases).

Suites (all run 2026-11-07 in this tree):

- runner foundry files (`foundry-capture|store|locate|loop|loop-state` +
  `harness2-trajectory`): **67 tests / 21 suites — 67 pass, 0 fail**
  (package-native route: `npm run build` in apps/redteam-runner, then
  `tsc -p tsconfig.test.json`, then `node --test` on the compiled files;
  root `vitest run` does not cover `apps/redteam-runner/test/*.test.ts`)
- `packages/redteam/foundry-gate`: **16/16 pass**
- `packages/redteam/console-share`: **16/16 pass**
- `packages/client/ui-redteam-console` specs (api, library-face,
  library-pages): **18/18 pass**, incl. "foundry shows state and a fired
  verify's totals"

## The one proven break — the web composition has no Foundry channel

`redteam-console-share` (the host plugin that serves `redteam-console/api/*`)
is mounted **only** in the desktop bundle
(`packages/redteam/desktop-bundle/cordis.patch.yml`, row
`redteam-console-share`; dependency declared in that bundle's package.json).
The **web-app composition mounts the console client — Foundry panel included —
but has no `redteam-console-share` row, and `packages/bundle/web-app/package.json`
does not declare the dependency.** On every web surface (`pnpm start:web`;
the ornith1 and GPU-box copies), the Foundry page renders and every call it
makes has no registered route: no state load, no verify, no run-gold, no loop.
Same family as the dead Application button: desktop-only wiring, no web
counterpart. Web mode also has no console supervisor — the desktop app starts
the runner console (port 8787, `--engagements-dir <userData>/engagements/live`);
a web instance needs a console running beside it (or an operator-supplied
`REDTEAM_MCP_URL` / `REDTEAM_UI_TOKEN`) for the proxy to reach.

## Still unexplained — PC desktop engagements minted nothing (2026-11-04)

Not reproduced in-tree: the chain mints whenever an engagement completes with
a confirmed state finding or any live finding. The instrument that answers it
already exists on the PC: every engagement's `events.jsonl` ends with a
`foundry_capture` event recording added / skipped-duplicate / sanitizer-dropped
counts or the capture error, and drops are also in the store's
`sanitizer-notes.jsonl`. Task T3 reads them. Candidate causes the receipt
distinguishes: engagements ending blocked/halted with zero confirmed findings
at capture time; sanitizer drops; a capture error.

Residual fragility (noted, not claimed as the break): in
`captureEngagementTrajectory` the Foundry block runs after the metrics /
trajectory computation inside one `try`. `writeTrajectory` never throws and
`readEvents` tolerates absence, but a throw in the metrics/spec5 computation
would skip capture silently. Task T4 decouples it.

## Tasks — ordered, small; a task counts only with its receipts

### T1 — Slice 1 trace + suites + in-process proof — **DONE 2026-11-07**
Receipts: this document; suite counts above; proof run output (case id
`case-df133bf7e61ee29d`, loop survivorsRegistered 1).

### T2 — Give the web composition its Foundry channel
Add the `redteam-console-share` row to `packages/bundle/web-app/cordis.patch.yml`
(config from env, same pattern as the desktop row), declare
`@secscan/redteam-console-share` in `packages/bundle/web-app/package.json`,
and settle the web-mode console story: the web instance's runner console runs
beside the web host with a shared engagements root and token (deploy-side),
or the row documents an operator-supplied console.
Done when: on a running web instance, `GET redteam-console/api/foundry`
returns 200 with the store counts, and POST `.../loop` completes a cycle —
receipts: the HTTP responses + the before/after registry count.
Suites: console-share + ui-redteam-console green; `verify-cordis-config` clean.

### T3 — PC diagnostic: why the Nov-4 engagements minted nothing (read-only)
On the PC: grep `foundry_capture` in the engagements' `events.jsonl` under
`<userData>/engagements/live`, and check `<userData>/foundry-store/`
(registry + sanitizer-notes). Classify each zero: no confirmed findings /
sanitizer drops / capture error / store written somewhere else.
Done when: the cause is named per engagement with the file lines as receipts.
(Rides the landing verification — the PC tree stays frozen.)

### T4 — Decouple Foundry capture from trajectory/metrics failure
In `captureEngagementTrajectory`, run the Foundry block in its own guard so a
metrics/spec5/trajectory failure can never skip minting; keep the
`foundry_capture` event note in all outcomes.
Done when: a new regression test sabotages the metrics path and the case
still mints + the note still lands; foundry suites stay green (receipts:
test output).

### T5 — Test-run reports as a Foundry data source
Ingest completed engagements' report/deliverables (the reports Carlos
collects from app test runs) into candidate cases through the same
sanitize → classify → gate path. Design constraint: dedupe against live
capture by (engagement, content hash) — `registerCase` already dedupes on
that pair, so a report from an already-captured engagement must add nothing.
Done when: a report-only fixture engagement (no live capture) produces ≥1
case through the new path, a captured engagement's report produces 0 new
cases, and the Foundry page shows the report-sourced cases with their origin
named (receipts: store listings before/after + suite output).

### T6 — Dataset export: store → training datasets folder
Export the store's cases as facility-shape JSONL (train/heldout split +
split-manifest + top-level manifest, GOLD/SILVER export-grade, BRONZE
flagged) to `C:\Users\Cho-zen\Desktop\SecScan-Training-Datasets\` on the PC
and an export dir under the app data dir on server copies — one action on
the Foundry surface or the runner CLI.
Done when: exporting a seeded store produces files whose record counts and
sha256 reconcile with the registry totals (receipts: manifest + hashes).

### T7 — Snapshot/gate presence in the packaged app (at next packaging)
The desktop packer packs `packages/redteam/foundry-gate` into the dsh
payload (`apps/desktop/scripts/package-target.ts`); verify in the installed
app that `locateFoundry` (from the installed runner payload) finds the
snapshot + gate CLI, so Verify / Run Gold and bundle evolution stop
reporting "not located".
Done when: the Foundry page shows the snapshot as available and a Verify
run returns per-family totals (receipt: page state + response body).

### T8 — Landing acceptance (Cho-zen1 verifies personally)
A real scan in the landed PC app mints ≥1 case, visible on the Foundry page.
Done when: screenshot of the page with the new case + the registry entry +
the engagement's `foundry_capture` event line all agree.
