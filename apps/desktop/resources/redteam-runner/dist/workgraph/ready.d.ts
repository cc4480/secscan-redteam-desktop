/**
 * Ready-order comparator — extracted from graph.ts to keep the graph module
 * under the 300-line budget.
 */
import type { GraphTask } from './types.js';
/**
 * The one ready-order comparator, exported so both sort sites use it and
 * can never drift: earliest deadline first, no-deadline tasks last, then
 * priority ascending. With no deadlines anywhere it degenerates to
 * exactly the historical priority sort.
 */
export declare function compareReadyTasks(a: GraphTask, b: GraphTask): number;
