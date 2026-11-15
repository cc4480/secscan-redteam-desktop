# REFACTOR-BOARD

First pass: hand-written source over 900 lines. Partitioned by whole package; a file
belongs to exactly one worker. Claim on this board BEFORE touching a file.

States: `unclaimed` -> `claimed` -> `splitting` -> `verified` -> `done`, or `parked`.

Files: **42** · Packages: **31** · Lines: **57765**

## W1 — typert generator + core services

Owner: W1 · Files: 5 · Lines: 8780

| state | lines | file | pkg |
|---|---:|---|---|
| verified | 3285 → 12 | `packages/typert/generator/src/analyzer.ts` | `packages/typert/generator` |
| verified | 1983 → 105 | `packages/core/tools/src/index.ts` | `packages/core/tools` |
| reverted | 1310 → 1310 | `packages/core/session/src/index.ts` | `packages/core/session` |
| verified | 1128 → 9 | `packages/typert/generator/src/emitter.ts` | `packages/typert/generator` |
| verified | 1069 → 11 | `packages/typert/generator/src/cordis-catalog.ts` | `packages/typert/generator` |

## W2 — trajectory + slot/icon surfaces

Owner: W2 · Files: 4 · Lines: 7966

| state | lines | file | pkg |
|---|---:|---|---|
| verified | 3507 → 7 | `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx` | `packages/client/ui-trajectory` |
| verified | 1670 → 47 | `packages/client/ui-slots/src/index.ts` | `packages/client/ui-slots` |
| verified | 1632 → 55 | `packages/client/ui-primitives/src/icons/index.tsx` | `packages/client/ui-primitives` |
| verified | 1157 → 9 | `packages/client/ui-trajectory/src/client/layout.ts` | `packages/client/ui-trajectory` |

### W2 notes

All four are now thin barrels re-exporting exactly their previous names (export lists
diffed before/after: icons 189→189, ui-slots 71→71, layout 5→5, TrajectoryTable 4→4).
Each package's `tsc --noEmit` is clean and its focused tests are at baseline.

**43 sibling modules created; 40 are under the 250-line budget.** Three are not, because in
each file the overflow was a *single declaration* that cannot be split by moving code:
`slot-core.ts` 720 (`class SlotCore`), `layout-fold.ts` 434 (`deriveTrajectoryLayout`),
`TrajectoryTablePane.tsx` 1503 (`function TrajectoryTable`). Getting these under 250 means
decomposing the declaration — a separate step under REFACTOR-METHOD rule 1, not a move.

**Baseline re-record is required** (`scripts/file-budget-baseline.json`, coordinator-owned):
drop the four now-under-budget entries (icons `index.tsx` 1631, ui-slots `index.ts` 1669,
`TrajectoryTable.tsx` 3506, `layout.ts` 1156) and add the three oversized modules above.
`pnpm run verify-file-budget --write` does both; until then the gate reports
`must-remove` ×4 and `over-budget` ×3.

Process note: W2 touched three of these files before flipping their rows off `unclaimed`.
Ownership was exclusive so nothing collided, but the claim order was not followed.


## W3 — client shell pages

Owner: W3 · Files: 7 · Lines: 8569

| state | lines | file | pkg |
|---|---:|---|---|
| unclaimed | 1413 | `packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` | `packages/client/ui-workspace` |
| unclaimed | 1365 | `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx` | `packages/client/ui-plugin-manager` |
| verified | 1325 → 9 | `packages/client/ui-renderer/src/client/scoped-slots.tsx` | `packages/client/ui-renderer` |
| unclaimed | 1216 | `packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts` | `packages/client/ui-chat` |
| unclaimed | 1160 | `packages/client/modules/src/index.ts` | `packages/client/modules` |
| unclaimed | 1053 | `packages/client/ui-directory-picker-browse/src/client/DirectoryBrowser.tsx` | `packages/client/ui-directory-picker-browse` |
| unclaimed | 1036 | `packages/client/ui-plugin-manager/src/client/manager-store.ts` | `packages/client/ui-plugin-manager` |

## W4 — session persistence + boot + skill

Owner: W4 · Files: 7 · Lines: 8020

| state | lines | file | pkg |
|---|---:|---|---|
| unclaimed | 1726 | `packages/session/session-persistence-jsonl/src/index.ts` | `packages/session/session-persistence-jsonl` |
| unclaimed | 1132 | `packages/session-query/session-query-sqlite/src/index.ts` | `packages/session-query/session-query-sqlite` |
| unclaimed | 1065 | `packages/boot/app-boot/src/index.ts` | `packages/boot/app-boot` |
| unclaimed | 1063 | `packages/session/session-format-v0-to-v1/src/payload-validation.ts` | `packages/session/session-format-v0-to-v1` |
| unclaimed | 1060 | `packages/session/session-persistence-jsonl/src/generation.ts` | `packages/session/session-persistence-jsonl` |
| unclaimed | 1050 | `packages/skill/skill-filesystem/src/index.ts` | `packages/skill/skill-filesystem` |
| unclaimed | 924 | `packages/boot/app-boot/src/profile-resolution/resolver.ts` | `packages/boot/app-boot` |

## W5 — repository scripts

Owner: W5 · Files: 6 · Lines: 7632

| state | lines | file | pkg |
|---|---:|---|---|
| unclaimed | 1690 | `scripts/gen-doc-graphs.ts` | `scripts` |
| unclaimed | 1667 | `scripts/run-gates.ts` | `scripts` |
| unclaimed | 1300 | `scripts/gen-cordis-catalog.ts` | `scripts` |
| unclaimed | 1079 | `scripts/publish-npm-baseline.ts` | `scripts` |
| unclaimed | 977 | `scripts/gen-config-catalog.ts` | `scripts` |
| unclaimed | 919 | `scripts/persistence-changes.ts` | `scripts` |

## WAVE-B — second wave (wave A must finish first)

Owner: WAVE-B · Files: 13 · Lines: 16798

| state | lines | file | pkg |
|---|---:|---|---|
| unclaimed | 2455 | `packages/experimental/ptc-runtime-python/src/index.ts` | `packages/experimental/ptc-runtime-python` |
| unclaimed | 1754 | `packages/test-support/session-snapshot/src/suite.ts` | `packages/test-support/session-snapshot` |
| unclaimed | 1598 | `apps/desktop/src/main.ts` | `apps/desktop` |
| unclaimed | 1563 | `packages/api/gateway/src/index.ts` | `packages/api/gateway` |
| unclaimed | 1277 | `packages/extensions/cordis-host-runner/src/index.ts` | `packages/extensions/cordis-host-runner` |
| unclaimed | 1197 | `packages/test-support/llm-replay/src/index.ts` | `packages/test-support/llm-replay` |
| unclaimed | 1154 | `packages/llm/llm/src/index.ts` | `packages/llm/llm` |
| unclaimed | 1047 | `packages/experimental/webworker-runtime/src/storage/memory.ts` | `packages/experimental/webworker-runtime` |
| unclaimed | 1032 | `packages/client/ui-conversation/src/client/conversation/assembler.ts` | `packages/client/ui-conversation` |
| unclaimed | 958 | `packages/llm/llm-pi-ai/src/catalog.ts` | `packages/llm/llm-pi-ai` |
| unclaimed | 942 | `packages/api/session-controller/src/client/sessions/session.ts` | `packages/api/session-controller` |
| unclaimed | 918 | `packages/credentials/credentials-local/src/index.ts` | `packages/credentials/credentials-local` |
| unclaimed | 903 | `packages/subagent/subagent/src/continuation-activation.ts` | `packages/subagent/subagent` |

## Coordinator-only work (never assigned in parallel)

| item | reason |
|---|---|
| `scripts/file-budget.ts` (270 lines) | shared gate; authored by coordinator, over budget, must be split by coordinator |
| `packages/redteam/auth-gate/src/local.ts` (327 lines) | shared gate; authored by coordinator, over budget, must be split by coordinator |
| shared `shared.ts` extraction in any folder | cross-worker shared code is never edited in parallel |
| full test suites, app launches, `madge --circular`, `verify-file-budget` | serialized through the coordinator |
