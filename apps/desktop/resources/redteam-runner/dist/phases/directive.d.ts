import { type Ctx } from "../context.js";
import { type CoordinatorDirective } from "./tasks.js";
export declare function coordinatorDirective(ctx: Ctx, kind: "decompose" | "replan", context: string): Promise<CoordinatorDirective>;
