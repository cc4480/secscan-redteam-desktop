/** The exact edits, in application order, split into the two sibling data modules. */

import { RECORD_EDITS } from './rescope-vendor-edits-records.ts'
import { WORKSPACE_EDITS } from './rescope-vendor-edits-workspace.ts'
import type { ExactEdit } from './rescope-vendor-types.ts'

/**
 * Every exact edit, in application order. Each `find` is written against the
 * PRE-rename text because these run before the generic pass, so no `find` may
 * quote a neighbouring line the generic pass would rewrite.
 */
export const EXACT_EDITS: readonly ExactEdit[] = [...WORKSPACE_EDITS, ...RECORD_EDITS]
