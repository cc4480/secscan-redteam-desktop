import type { Ctx } from "../context.js";
import type { WorkFlow } from "./graph.js";
export declare const FLOW_FILE = "workgraph.json";
export declare function flowPath(dir: string): string;
/** Persist the graph atomically; returns the path written. */
export declare function saveFlow(dir: string, flow: WorkFlow): string;
/** Load and validate a persisted graph, or null when absent/corrupt. */
export declare function loadFlow(dir: string): WorkFlow | null;
/** Attach the live graph to this engagement context. */
export declare function attachFlow(ctx: Ctx, flow: WorkFlow): void;
/** The live graph for this engagement, when one is attached. */
export declare function flowFor(ctx: Ctx): WorkFlow | null;
