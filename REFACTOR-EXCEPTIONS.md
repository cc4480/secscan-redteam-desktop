# REFACTOR-EXCEPTIONS

Files that cannot reach the 250-line budget by **moving declarations**, as the
owner's rule requires: a written exception, never a silent pass. Each entry
names the indivisible declaration, its span, what decomposition would take, and
the focused suite that would guard it.

The bar was set at 250 with a gate (`scripts/verify-file-budget.ts`). Five files
were split to thin barrels in the first pass; in each, the residual is a single
declaration that a pure move cannot divide. Splitting *inside* one declaration is
a behaviour-risk rewrite, and per `REFACTOR-METHOD.md` rule 1 it is a separate
step with its own baseline — not part of the move.

## Exceptions

### 1. `packages/client/ui-trajectory/src/client/TrajectoryTablePane.tsx` — 1503 lines

- **Indivisible declaration:** `function TrajectoryTable`, ~1441 lines (one React
  component).
- **Why a move cannot fix it:** the file now holds only that function; the other
  16 modules of the original 3507-line file are already extracted.
- **Decomposition:** split the component into presentational sub-components and
  extract the hook sequence into named hooks. This **restructures hook order**,
  which the refactor brief forbids outright.
- **Guard:** `packages/client/ui-trajectory/tests/table.client.spec.tsx` (42
  tests) plus `views.client.spec.tsx` (37).

### 2. `packages/core/tools/src/tool-runtime.ts` — 1285 lines

- **Indivisible declaration:** `class ToolRuntime` (~1097 lines of the original
  1983-line `core/tools/src/index.ts`), moved verbatim.
- **Decomposition:** class-to-collaborators extraction (registration, dispatch,
  presentation); `ToolRuntime` carries the inject list and config schema, so the
  split changes construction order.
- **Guard:** `tools.spec.ts`, `scoped.spec.ts`, `execution-mode.spec.ts`,
  `properties.spec.ts`, `invariant.spec.ts` — 194 tests.

### 3. `packages/typert/generator/src/face-analyzer.ts` — 2190 lines,
###    `emitter-face.ts` 502, `emitter-schema.ts` 372, `workspace-analyzer.ts` 385,
###    `cordis-catalog-runtime.ts` 258

- **Indivisible declarations:** `class FaceAnalyzer`, `class FaceModelEmitter`,
  `class SchemaEmitter`, `class WorkspaceAnalyzer`, and the 248-line
  `renderRuntimeApi`. Each is one cohesive unit.
- **Decomposition:** the analyzer pair share a type graph and are mutually
  recursive through the workspace model; splitting them safely needs a
  differential render harness (old vs new over a whole-workspace catalog).
- **Guard:** `type-model.spec.ts` (57), `remote-model.spec.ts` (48),
  `schema-emitter.spec.ts` (65), and the end-to-end `cordis-catalog.spec.ts`.

### 4. `packages/client/ui-trajectory/src/client/layout-fold.ts` — 434 lines

- **Indivisible declaration:** `deriveTrajectoryLayout`, ~399 lines — one pure
  fold over the event stream.
- **Decomposition:** a differential harness is the right proof here: run the
  original fold and the decomposed one over synthetic snapshots and assert
  identical output. That harness does not exist yet.
- **Guard:** `packages/client/ui-trajectory/tests/layout.client.spec.tsx` (32).

### 5. `packages/client/ui-slots/src/slot-core.ts` — 720 lines

- **Indivisible declaration:** `class SlotCore`, ~683 lines.
- **Decomposition:** split the class into collaborators (registration, live
  state, locale resolution). The package's type-level suite makes this
  checkable but not free.
- **Guard:** `packages/client/ui-slots` suites (34 tests) including the
  type-level `type-chain.client.spec.tsx`.

## What the exceptions do and do not excuse

They do **not** pardon a file being large on purpose. They record that the
remaining overflow is one declaration, that the move already happened, and that
the next step is a decomposition with its own proof. Every one of these five was
4x–7x larger before the split.

## The systemic finding

Every remaining first-pass file (the 37 still to do) is dominated the same way:
`core/tools/src/index.ts` has `ToolRuntime` at 1097 lines of its 1983;
`api/gateway/src/index.ts` has `TypertGatewayService` at 793 of 1563;
`ui-workspace/…/WorkspaceBrowser.tsx` has `WorkspaceBrowser` at 606 of 1413.
A barrel split will therefore keep improving structure substantially while
leaving a 400–1500-line exception in each. Reaching 250 across the tree needs an
authorised decomposition pass, not more moving.

## Reverted slice

### `packages/core/session/src/index.ts` — split reverted to HEAD (1310 lines)

- **What was built:** a 1310 → 26-line barrel with nine sibling modules, its own
  544-test suite green and `tsc` clean.
- **Why it was reverted:** with the split in place, `scripts/gen-doc-graphs.ts`
  fails: *"event-producer-consumer matrix: no dispatcher found for declared
  events session/created, session/disposed, session/event, session/flush"*. The
  split routes dispatch through a `dispatch.ts` helper, and the generator's
  semantic scan does not follow that indirection. Reverting restores the gate
  (verified: `gen-doc-graphs: wrote 6 graph doc(s)`).
- **What it would take:** teach the scan in `scripts/gen-doc-graphs.ts` the
  helper-indirection form — its own error message invites exactly that — as a
  separate, baselined change. Then re-run the split.
- **Not a behavior loss:** the split's own tests and typecheck were green; the
  regression was in tooling blindness, not runtime behavior. It is still the
  correct call to revert a slice that turns a repo-wide gate red.

## Delivered but flagged: `scoped-slots.tsx` split introduces import cycles

**What was done:** 1325 lines → a 9-line barrel plus **ten** named modules, the
best result of this pass — every file lands under 250 with **no exception
needed** (max 232).

| module | lines |
|---|---:|
| binding-cache · inject · entry-keys · standard · entry-render | 232 · 137 · 131 · 150 · 159 |
| factory-runtime · factory-kit · outlets · outlet-content · renderer | 160 · 159 · 157 · 202 · 92 |

**Proof:** `tsc --noEmit` clean; `vitest run packages/client/ui-renderer` →
**137/137 pass** across 12 files (six of them import `createSlotRenderer`);
export surface unchanged (one export, same path).

**The defect:** the ten modules form **11 import cycles** (e.g.
`binding-cache → outlets → binding-cache`, `entry-render ↔ factory-runtime`).
The declarations in the original file constitute one strongly-connected
component: early binding-cache code references `SlotOutlet`/`FactoryOutlet`,
which reference the caches again. The rest of this package has **zero** cycles,
so these are the package's only ones.

**Why I did not break them:** every acyclic partition requires moving
declarations across component boundaries or converting component references into
parameters — a behaviour-changing rewrite, which rule 1 forbids inside a move.

**Owner's call — pick one:**
1. **Accept** the cycles (tests, typecheck and the 250 budget are all green), or
2. **Revert** to the single 1325-line file with a written exception, or
3. **Authorise** a decomposition pass that converts the outlet references into
   parameters so the graph becomes acyclic.

Until ruled on, the split stands as delivered.
