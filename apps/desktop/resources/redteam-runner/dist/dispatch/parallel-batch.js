import { dispatchTool } from "./router.js";
import { toolCallKey } from "./duplicate-guard.js";
export const MAX_PARALLEL_CALLS = 4;
/**
 * Partition one response's calls into sequential groups. Consecutive
 * independent traffic calls accumulate into a parallel group; any other
 * call flushes the group and runs alone, in the original order. When
 * `eligible` is false (any phase but recon), every call is its own
 * sequential group — the pre-A2 behavior, exactly.
 */
export function partitionToolCalls(calls, hostOf, eligible) {
    if (!eligible)
        return calls.map((call) => ({ parallel: false, calls: [call] }));
    const groups = [];
    let run = [];
    // Twins are tracked across a size-flush: a duplicate of a call in an
    // earlier parallel group of the same run must not join a later one —
    // it would dispatch before its twin's outcome is recorded. A
    // sequential barrier resets the run (and the guard at dispatch has
    // the earlier outcome by then).
    const seen = new Set();
    const flush = () => {
        if (run.length)
            groups.push({ parallel: run.length > 1, calls: run });
        run = [];
    };
    for (const call of calls) {
        const key = toolCallKey(call);
        if (hostOf(call) !== undefined && !seen.has(key)) {
            seen.add(key);
            run.push(call);
            if (run.length >= MAX_PARALLEL_CALLS)
                flush();
        }
        else {
            flush();
            groups.push({ parallel: false, calls: [call] });
            seen.clear();
        }
    }
    flush();
    return groups;
}
/**
 * Execute one group and settle every call, in call order. Parallel
 * groups dispatch concurrently; a singleton group is a plain await —
 * same settle shape either way.
 */
export async function executeToolGroup(ctx, role, phase, group, dispatchImpl = dispatchTool) {
    const run = async (call) => {
        try {
            return { call, d: await dispatchImpl(ctx, role, phase, call) };
        }
        catch (err) {
            return { call, error: err };
        }
    };
    if (!group.parallel)
        return [await run(group.calls[0])];
    return Promise.all(group.calls.map(run));
}
//# sourceMappingURL=parallel-batch.js.map