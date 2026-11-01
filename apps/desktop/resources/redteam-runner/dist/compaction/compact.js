import { SummaryCache, summaryCacheFor, summaryKey } from './summary-cache.js';
export const DEFAULT_BUDGET_CHARS = 96_000;
export const DEFAULT_PRESERVE_LAST = 6;
export const SUMMARY_MARKER = '[COMPACTED HISTORY';
/** Approximate chain size: content bytes plus any tool-call payloads. */
export function estimateChars(messages) {
    let total = 0;
    for (const m of messages) {
        total += m.content.length;
        if (m.toolCalls)
            total += JSON.stringify(m.toolCalls).length;
    }
    return total;
}
/** True when `message` opens a tool group whose results must stay beside it. */
function opensToolGroup(message) {
    return message?.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0;
}
function renderSlice(slice) {
    return slice
        .map((m) => {
        const calls = m.toolCalls
            ? `\n[tool calls: ${m.toolCalls.map(c => `${c.name} ${JSON.stringify(c.arguments)}`).join('; ')}]`
            : '';
        return `${m.role.toUpperCase()}: ${m.content}${calls}`;
    })
        .join('\n\n');
}
const SUMMARY_SYSTEM = 'You are the compaction summarizer for a penetration-testing agent. ' +
    'Summarize the transcript slice you are given so the agent can continue ' +
    'working without it. Preserve VERBATIM: every target host and URL; every ' +
    'finding id, title, and status (PROVEN, DETECTED, confirmed, killed); ' +
    'evidence digests and quoted bytes; tool calls that were DENIED, REFUSED, ' +
    'or failed, with the reason; open leads and untested hypotheses; numbers, ' +
    'ports, and parameter names. Drop conversational filler and duplicated ' +
    'observations. Keep the summary under 4000 characters, as a dense fact list.';
/** Build the production summarizer over the engagement's completion seam. */
export function makeSummarizer(complete, role, onUsage) {
    return async (sliceText) => {
        const res = await complete(role, [
            { role: 'system', content: SUMMARY_SYSTEM },
            { role: 'user', content: sliceText },
        ], { tools: [] });
        if (onUsage && res.usage !== undefined)
            onUsage(res.usage);
        return res.text.trim();
    };
}
/**
 * Compact `messages` in place until it fits the budget or nothing more
 * can be compacted. Returns null when no compaction was needed or
 * possible. Never throws — the caller treats null as "run as-is".
 */
export async function compactMessages(messages, summarize, opts = {}) {
    const budget = opts.budgetChars ?? DEFAULT_BUDGET_CHARS;
    const preserveLast = opts.preserveLast ?? DEFAULT_PRESERVE_LAST;
    const cache = opts.cache ?? new SummaryCache();
    const beforeChars = estimateChars(messages);
    if (beforeChars <= budget)
        return null;
    let passes = 0;
    let compactedCount = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    // Head = system + objective (indices 0..1); tail = last preserveLast raw
    // messages. Everything between is one compactable slice per pass.
    while (passes < 4) {
        if (estimateChars(messages) <= budget)
            break;
        const head = Math.min(2, messages.length);
        let tailStart = messages.length - preserveLast;
        if (tailStart <= head)
            break; // nothing between head and tail to compact
        // Start guard: a slice may not OPEN with a tool message — its owning
        // assistant sits inside the pinned head, so splicing would strand the
        // result in the summary while its call survives (or vice versa), and no
        // boundary move can repair that from here. Production cannot produce
        // this shape — agentLoop seeds [system, user] and only ever appends an
        // assistant message before its tool results — so a tool message at the
        // head means malformed input; skip compaction (failure-isolated, as
        // this module is by design) rather than emit a wire-invalid chain.
        if (messages[head]?.role === 'tool')
            return passes > 0 ? finish() : null;
        // End-boundary pullback: the slice may not CLOSE on an assistant message
        // carrying tool calls — its results are the tail's first messages and
        // would be orphaned, serializing with a tool_call_id that points at a
        // compacted-away call (a wire-invalid sequence; a 400 class of its own).
        // Pull the boundary back so the whole pending group — call and results —
        // stays together in the preserved tail; the slice shrinks from the end.
        while (tailStart - 1 >= head && opensToolGroup(messages[tailStart - 1]))
            tailStart--;
        const slice = messages.slice(head, tailStart);
        if (slice.length < 2)
            break; // a single message is not worth summarizing
        const sliceText = renderSlice(slice);
        const key = summaryKey(sliceText);
        let summary = cache.get(key);
        if (summary !== null)
            cacheHits++;
        else {
            cacheMisses++;
            summary = await summarize(sliceText);
            if (!summary)
                return passes > 0 ? finish() : null;
            cache.set(key, summary);
        }
        const summaryMessage = {
            role: 'user',
            content: `${SUMMARY_MARKER} — summary of ${slice.length} earlier messages, digest ${key.slice(0, 12)}]\n${summary}`,
        };
        messages.splice(head, slice.length, summaryMessage);
        compactedCount += slice.length;
        passes++;
    }
    return finish();
    function finish() {
        return {
            beforeChars,
            afterChars: estimateChars(messages),
            compactedCount,
            passes,
            cacheHits,
            cacheMisses,
        };
    }
}
function envInt(name) {
    const raw = process.env[name];
    if (!raw)
        return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}
/**
 * The agentLoop seam: compact before a completion when the chain is over
 * budget. Configuration is data — REDTEAM_COMPACTION=0 disables,
 * REDTEAM_COMPACTION_BUDGET_CHARS and REDTEAM_COMPACTION_PRESERVE_LAST
 * override the defaults. Failure-isolated: logs and returns on any error.
 */
export async function maybeCompactMessages(ctx, role, phase, messages, complete, onUsage) {
    if (process.env['REDTEAM_COMPACTION'] === '0')
        return null;
    try {
        const result = await compactMessages(messages, makeSummarizer(complete, role, onUsage), {
            budgetChars: envInt('REDTEAM_COMPACTION_BUDGET_CHARS') ?? DEFAULT_BUDGET_CHARS,
            preserveLast: envInt('REDTEAM_COMPACTION_PRESERVE_LAST') ?? DEFAULT_PRESERVE_LAST,
            cache: summaryCacheFor(ctx),
        });
        if (result) {
            ctx.events.append({
                phase,
                actor: 'runner',
                action: 'compaction',
                result: `Compacted ${result.compactedCount} message(s) in ${result.passes} pass(es): ` +
                    `${result.beforeChars} → ${result.afterChars} chars ` +
                    `(summary cache ${result.cacheHits} hit(s), ${result.cacheMisses} miss(es)).`,
            });
        }
        return result;
    }
    catch (err) {
        ctx.events.append({
            phase,
            actor: 'runner',
            action: 'compaction_failed',
            result: `Compaction failed (failure-isolated; loop continues uncompacted): ${err.message}`,
        });
        return null;
    }
}
//# sourceMappingURL=compact.js.map