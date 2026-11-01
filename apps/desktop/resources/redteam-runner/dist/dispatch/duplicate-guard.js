/**
 * Duplicate-call guard (PentAGI alignment A1).
 *
 * PentAGI's performer fingerprints tool calls and blocks repeats; this
 * runner had no equivalent, so a stuck agent could re-fire the identical
 * probe for the whole engagement. The guard lives at the dispatch choke
 * point and covers the calls that generate target traffic — exactly the
 * calls that carry a target host at dispatch (the rate-limited family).
 * State-dependent tools (bookkeeping, registry reads, MCP) are out of
 * scope: their correct result can change between identical calls.
 *
 * Semantics, per role + phase, keyed to the engagement's Ctx:
 * - A call identical to one that already completed cleanly is refused
 *   immediately; the refusal carries a digest of the previous result so
 *   the agent keeps the information without the traffic.
 * - A call identical to one that already failed twice is refused from
 *   the third attempt; one retry of a failed call stays legal (a
 *   transient network failure must not wedge a target).
 * - Near-duplicates (runner corrections Item 9): a call whose arguments
 *   differ from an executed call's ONLY in that tool's listed
 *   non-semantic keys (NEAR_DUP_IGNORED_KEYS — timeout/retry-style
 *   knobs that cannot change what the target receives) is refused at
 *   the SECOND call, whether the first succeeded (digest carried) or
 *   failed (no failure grace: cosmetic variation was never a new
 *   probe). The table is empty by default, so an unlisted tool's near
 *   key IS its exact key and behavior is literally the exact rule.
 * - Refusals are DENIED-prefixed results, so the agent loop's existing
 *   wall detection and turn-integrity treat them as no-progress, and
 *   each refusal is written to the engagement event log — never silent.
 */
import { createHash } from 'node:crypto';
/** Per-engagement guard state, keyed by the engagement's Ctx object. */
const seen = new WeakMap();
function mapFor(ctx) {
    let m = seen.get(ctx);
    if (!m) {
        m = new Map();
        seen.set(ctx, m);
    }
    return m;
}
/**
 * Per-tool argument keys whose variation cannot change what the target
 * receives (timeout, delay/jitter, retry knobs, output verbosity). A
 * key may be listed ONLY if varying it cannot change the request the
 * target receives — never a URL/path/query, method, body, port, scheme,
 * or a header that is itself the probe. Entries are added per tool
 * only with the handler owner's review. EMPTY BY DEFAULT: a tool with
 * no entry gets nearKey === toolCallKey, so the near-duplicate rule
 * cannot fire for it and behavior is literally today's.
 */
export const NEAR_DUP_IGNORED_KEYS = {};
/** Near-duplicate state, same per-Ctx WeakMap lifecycle as the exact map. */
const nearSeen = new WeakMap();
function nearMapFor(ctx) {
    let m = nearSeen.get(ctx);
    if (!m) {
        m = new Map();
        nearSeen.set(ctx, m);
    }
    return m;
}
/** Stable JSON for argument values: object keys sorted, arrays in order. */
function canonical(value) {
    if (value === null || value === undefined)
        return 'null';
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (typeof value === 'object') {
        const rec = value;
        const keys = Object.keys(rec).filter(k => rec[k] !== undefined).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(rec[k])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}
/** Identity of a call itself: tool name + canonical arguments, hashed. */
export function toolCallKey(call) {
    return createHash('sha256')
        .update(`${call.name}\n${canonical(call.arguments ?? {})}`)
        .digest('hex');
}
function fingerprint(role, phase, call) {
    return `${role}|${phase}|${toolCallKey(call)}`;
}
/**
 * Near-identity of a call: tool name + canonical arguments with the
 * tool's listed non-semantic keys removed. Reuses `canonical`, so
 * key-order normalization is shared with the exact key. A tool with no
 * NEAR_DUP_IGNORED_KEYS entry gets nearKey === toolCallKey.
 */
export function nearKey(call) {
    const ignored = NEAR_DUP_IGNORED_KEYS[call.name];
    if (!ignored || ignored.length === 0)
        return toolCallKey(call);
    const strip = new Set(ignored);
    const args = {};
    for (const [k, v] of Object.entries(call.arguments ?? {})) {
        if (!strip.has(k))
            args[k] = v;
    }
    return createHash('sha256')
        .update(`${call.name}\n${canonical(args)}`)
        .digest('hex');
}
function nearFingerprint(role, phase, call, host) {
    // The host is part of the near scope even though it usually also sits
    // inside the arguments: target identity is semantic and never
    // stripped, so two hosts can never share a near entry.
    return `${role}|${phase}|${host}|${nearKey(call)}`;
}
/** The dispatcher's own clean-result heuristic, mirrored from router.ts. */
function isClean(d) {
    return d.ok === undefined
        ? !/^(DENIED|HALTED)/i.test(d.result) && !d.result.startsWith('probe failed')
        : d.ok;
}
/**
 * Refusal for an identical repeat call, or undefined when the call may
 * execute. Only calls carrying a target host are guarded; `host`
 * undefined means the tool generates no target traffic.
 */
export function duplicateRefusal(ctx, role, phase, call, host) {
    if (!host)
        return undefined;
    const entry = mapFor(ctx).get(fingerprint(role, phase, call));
    if (entry) {
        // Exact checks first, unchanged: an exact repeat keeps today's
        // refusal text and today's failure grace.
        let result;
        if (entry.cleanResult !== undefined) {
            result =
                `DENIED: duplicate call refused — ${call.name} with identical arguments already ` +
                    `completed in this ${phase} phase; repeating it sends the same traffic for no new ` +
                    `information. Vary the probe or move on. Previous result digest: ${entry.cleanResult.slice(0, 500)}`;
        }
        else if (entry.failures >= 2) {
            result =
                `DENIED: duplicate call refused — ${call.name} with identical arguments already ` +
                    `failed ${entry.failures} times in this ${phase} phase. Change the probe, the ` +
                    `target, or the approach. Last failure digest: ${(entry.lastFailure ?? '').slice(0, 300)}`;
        }
        else {
            return undefined;
        }
        ctx.events.append({ phase, actor: 'runner', action: 'duplicate_refused', target: host, result });
        return { result, target: host, ok: false };
    }
    // Near-duplicate check (Item 9): only when this call is not itself an
    // exact repeat. The second substantially-identical call is refused
    // whether the first succeeded (digest carried) or failed (no failure
    // grace — the varied call was never a new probe).
    const near = nearMapFor(ctx).get(nearFingerprint(role, phase, call, host));
    if (near && near.executions >= 1) {
        let result;
        if (near.cleanDigest !== undefined) {
            result =
                `DENIED: duplicate call refused — ${call.name} is a near-duplicate of a call that already ` +
                    `completed in this ${phase} phase: same tool and target, arguments differing only in ` +
                    'non-semantic fields (listed cosmetic keys, e.g. timeouts). Cosmetic variation is not a ' +
                    `new probe and earns no extra traffic. Previous result digest: ${near.cleanDigest.slice(0, 500)}`;
        }
        else {
            result =
                `DENIED: duplicate call refused — ${call.name} is a near-duplicate of a call that already ` +
                    `failed in this ${phase} phase: same tool and target, arguments differing only in ` +
                    'non-semantic fields (listed cosmetic keys, e.g. timeouts). Near-duplicates get no ' +
                    'failure grace — cosmetic variation was never a new probe. Change the probe, the ' +
                    'target, or the approach.';
        }
        ctx.events.append({ phase, actor: 'runner', action: 'duplicate_refused', target: host, result });
        return { result, target: host, ok: false };
    }
    return undefined;
}
/**
 * Record an executed call's outcome so a later identical call can be
 * refused. Called only for calls that actually executed (post-hooks
 * result); gate denials never reach it and never seed the guard.
 */
export function recordCallOutcome(ctx, role, phase, call, host, d) {
    if (!host)
        return;
    const map = mapFor(ctx);
    const key = fingerprint(role, phase, call);
    const entry = map.get(key) ?? { failures: 0 };
    if (isClean(d)) {
        entry.cleanResult = d.result.slice(0, 4000);
    }
    else {
        entry.failures++;
        entry.lastFailure = d.result.slice(0, 1000);
    }
    map.set(key, entry);
    // Near map: every executed guarded call also seeds its near entry,
    // so a later cosmetically-varied repeat can be refused at the second
    // call. Gate denials never reach this function and seed neither map.
    const nearMap = nearMapFor(ctx);
    const nKey = nearFingerprint(role, phase, call, host);
    const near = nearMap.get(nKey) ?? { executions: 0 };
    near.executions++;
    if (isClean(d)) {
        near.cleanDigest = d.result.slice(0, 4000);
    }
    nearMap.set(nKey, near);
}
//# sourceMappingURL=duplicate-guard.js.map