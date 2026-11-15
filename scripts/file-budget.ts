/**
 * The file line budget: one hand-written source file, one responsibility, and
 * no more than {@link FILE_LINE_BUDGET} lines.
 *
 * The budget is a ONE-WAY RATCHET. The tree already carries files far above it,
 * so a plain "fail above 250" check would fail on every commit until the whole
 * tree was refactored — which is how a gate becomes something people disable.
 * `scripts/file-budget-baseline.json` therefore records every file still over
 * budget at the count it is currently allowed, and this module fails on the
 * three ways a ratchet slips:
 *
 *   - `over-budget`  — a file the baseline never saw that is above budget;
 *   - `grew`         — a file above the count the baseline allows it;
 *   - `must-lower`   — a grandfathered file that got smaller but is still over
 *                      budget, so the recorded ceiling is now stale and slack;
 *   - `must-remove`  — a baseline entry whose file is now under budget or gone.
 *
 * Generated files are excepted. Their own headers name the generator that
 * writes them, `verify-*-catalog` freshness-gates them, and splitting generator
 * output by hand is corruption rather than tidiness. They are recorded WITH
 * their generator so the exception stays auditable.
 *
 * The budget itself is a constant here, never a field in the baseline JSON: a
 * rule the data can raise is not a rule.
 *
 * Measurement lives in ./file-budget-scan.ts and is re-exported below, so every
 * existing importer keeps its path and its names.
 */

import type { FileBudgetBaseline, MeasuredFile } from './file-budget-scan.ts'

export {
  BASELINE_PATH,
  countLines,
  generatorFor,
  isOutOfScope,
  listSources,
  measureBudget,
  readBaseline,
} from './file-budget-scan.ts'
export type { FileBudgetBaseline, MeasuredFile } from './file-budget-scan.ts'

/** Maximum lines a hand-written source file may have. */
export const FILE_LINE_BUDGET = 250

/** Why a file failed the budget. */
export interface BudgetViolation {
  file: string
  lines: number
  /** The count the baseline allows; absent for a file the baseline never saw. */
  allowed?: number
  kind: 'over-budget' | 'grew' | 'must-lower' | 'must-remove'
  message: string
}

/**
 * Compare a measurement against the recorded state.
 * @param measured - every in-scope source file.
 * @param baseline - the recorded ratchet state.
 * @returns violations, ordered by path; empty means the budget holds.
 */
export function compareBudget(
  measured: readonly MeasuredFile[],
  baseline: FileBudgetBaseline,
): BudgetViolation[] {
  const violations: BudgetViolation[] = []
  const seen = new Set<string>()
  const excepted = new Set(baseline.generated.map((g) => g.path))
  for (const file of measured) {
    if (file.generator !== null || excepted.has(file.path)) continue
    seen.add(file.path)
    const allowed = baseline.grandfathered[file.path]
    if (file.lines <= FILE_LINE_BUDGET) {
      if (allowed !== undefined) {
        violations.push({
          file: file.path,
          lines: file.lines,
          allowed,
          kind: 'must-remove',
          message: `is ${file.lines} lines, within budget — drop its baseline entry so the ratchet holds`,
        })
      }
      continue
    }
    if (allowed === undefined) {
      violations.push({
        file: file.path,
        lines: file.lines,
        kind: 'over-budget',
        message: `is ${file.lines} lines, ${file.lines - FILE_LINE_BUDGET} over the ${FILE_LINE_BUDGET}-line budget, and the baseline has no entry for it`,
      })
    } else if (file.lines > allowed) {
      violations.push({
        file: file.path,
        lines: file.lines,
        allowed,
        kind: 'grew',
        message: `grew to ${file.lines} lines; the baseline allows ${allowed}`,
      })
    } else if (file.lines < allowed) {
      violations.push({
        file: file.path,
        lines: file.lines,
        allowed,
        kind: 'must-lower',
        message: `shrank to ${file.lines} lines but the baseline still allows ${allowed} — lower it so the ratchet does not slacken`,
      })
    }
  }
  for (const path of Object.keys(baseline.grandfathered)) {
    if (seen.has(path) || excepted.has(path)) continue
    // The key came from Object.keys(baseline.grandfathered), so the entry exists;
    // the guard is for noUncheckedIndexedAccess, which types the lookup as possibly
    // undefined and breaks exactOptionalPropertyTypes on BudgetViolation.allowed.
    const allowed = baseline.grandfathered[path]
    if (allowed === undefined) continue
    violations.push({
      file: path,
      lines: 0,
      allowed,
      kind: 'must-remove',
      message: 'baseline entry no longer describes a hand-written file in the tree',
    })
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * Build the baseline that describes a measurement exactly.
 * @param measured - every in-scope source file.
 * @returns the ratchet state that makes `compareBudget` return no violations.
 */
export function baselineFrom(measured: readonly MeasuredFile[]): FileBudgetBaseline {
  const generated: FileBudgetBaseline['generated'] = []
  const grandfathered: Record<string, number> = {}
  for (const file of measured) {
    if (file.generator !== null) generated.push({ path: file.path, generator: file.generator })
    else if (file.lines > FILE_LINE_BUDGET) grandfathered[file.path] = file.lines
  }
  generated.sort((a, b) => a.path.localeCompare(b.path))
  return { generated, grandfathered }
}
