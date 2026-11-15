# REFACTOR-METHOD

Mandatory method for every worker on this pass. Read `REFACTOR-BOARD.md` for
your file assignments and claim each file there **before** you touch it.

Repository root: `C:\Users\Cho-zen\secscan-rebuild-test`

## Hard rules

1. **No behavior change.** A split moves code. If a block must be rewritten to
   be movable, that rewrite is a separate step with its own baseline — do not
   bundle it into a move.
2. **Exports stay stable.** The original file becomes a thin **barrel** that
   re-exports everything it exported before. Every importer's path and every
   imported name keep working unchanged. This is what makes slices independent —
   it means you never edit files outside your assignment.
3. **Stay inside your assignment.** You own whole packages listed on the board.
   Never edit a file owned by another worker, and never edit a shared module
   (anything two packages import). Flag shared-module needs on the board and
   stop — the coordinator handles those serially.
4. **No new dependencies.** Nothing added to any `package.json`.
5. **Files under 250 lines** when you are done with them. That is the budget
   `pnpm run verify-file-budget` enforces.
6. **Do not run** full test suites, app launches, `pnpm run build`, `pnpm run
   typecheck`, `tsc -b`, or any repo-wide gate. Those are serialized through the
   coordinator. They corrupt each other's `.tsbuildinfo` and thrash this
   4-core machine.
7. **Do not touch** `apps/desktop/src/main.ts` or `ollama-shell.ts` (protected —
   coordinator owns that slice), the two MCP hops, or the llm-router base URLs.

## Per file

1. **Snapshot.** `mkdir -p refactor-snapshots/<date>/<worker>/` and copy the file
   plus its tests there before the first cut. Record the path on the board.
2. **Baseline.** Measure the file: `wc -l` equivalent, what it exports (grep),
   who imports it (grep receipt). Run the package's own focused test command
   once and record pass/fail counts.
3. **Extract `shared.ts` first** if two or more of your new modules would need
   the same types or helpers. Do this before any other cut so you never create
   a circular import.
4. **Split mechanically** along the file's existing seams — one responsibility
   per sibling module, named the way this tree names things. Move declarations;
   do not rewrite them.
5. **Barrel.** The original path keeps its filename and re-exports the moved
   symbols.
6. **Verify.** `npx tsc --noEmit -p <your package>/tsconfig.json` (never `-b`),
   then the package's focused tests. Compare to your baseline.
7. **Record.** Update your rows on `REFACTOR-BOARD.md` to `verified` with the
   before/after line counts.

## If it goes red

- Restore the snapshot, mark the row `parked` with the exact failing command and
  output, and move to your next unclaimed file. Blocked never means stopped.
- Never push through a red test to keep moving.

## Report back

For each file: path · lines before → after · new files created and what each
holds · focused tests before → after (named suite, pass counts) · snapshot path ·
any FIX taken (what was wrong, failing→passing proof) · anything needing the
owner's call.
