/**
 * Ready-order comparator — extracted from graph.ts to keep the graph module
 * under the 300-line budget.
 */
import type { GraphTask } from './types.js'

/**
 * The one ready-order comparator, exported so both sort sites use it and
 * can never drift: earliest deadline first, no-deadline tasks last, then
 * priority ascending. With no deadlines anywhere it degenerates to
 * exactly the historical priority sort.
 */
export function compareReadyTasks(a: GraphTask, b: GraphTask): number {
  if (a.deadline !== undefined && b.deadline !== undefined && a.deadline !== b.deadline) {
    return a.deadline < b.deadline ? -1 : 1
  }
  if (a.deadline !== undefined && b.deadline === undefined) return -1
  if (a.deadline === undefined && b.deadline !== undefined) return 1
  return a.priority - b.priority
}
