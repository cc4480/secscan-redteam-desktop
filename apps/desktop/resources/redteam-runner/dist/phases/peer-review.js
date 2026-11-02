/**
 * Q-FLEET-XCHECK — the fleet peer cross-check (Carlos's order,
 * 2026-10-31; spec: fleet-peer-cross-check-2026-10-31.md).
 *
 * Before the report, every live finding is challenged by a DIFFERENT
 * fleet seat than the one that produced it: does the evidence actually
 * prove it, was the scope respected, is the severity honest? Producer
 * and checker are never the same seat — the checker is picked from a
 * fixed preference list with the producer removed, so a same-seat
 * challenge is impossible by construction, not by prompt discipline.
 *
 * The checker answers a structured verdict (upheld / downgraded /
 * needs-evidence / killed) through the same completion seam the agent
 * loop uses (deps seam in tests, chartered seam in production). The
 * RUNNER applies the verdict mechanically — the model proposes, the
 * runner disposes:
 *  - upheld        → the finding flows to the reporter, stamped.
 *  - downgraded    → severity lowered on the ladder (the checker's
 *                    proposed rung when it is strictly lower, else one
 *                    notch; at the floor the finding flows unchanged).
 *  - needs-evidence → the finding leaves the confirmed flow and is
 *                    reported as deferred, stamped.
 *  - killed        → the finding leaves the confirmed flow, joins the
 *                    killed record (shared state + registry), stamped.
 * A PROVEN cell verdict outranks a peer kill (proven wins — the cell's
 * dual signatures + negative control are the stronger evidence the
 * spec lets a kill fall to); the override is recorded on the stamp's
 * disposition and in the verdict event, never silently.
 *
 * Every challenge and verdict is an engagement event (peer_challenge /
 * peer_verdict / peer_review_failed / peer_review_complete) — the
 * exchange is model-visible to the reporter through the stamps, and
 * every stamp is reconstructable from the log. A checker call that
 * fails or answers unparseably never halts the engagement and never
 * fabricates a verdict (Q-HALT discipline): the finding flows
 * unstamped and the failure is an event carrying the cause. A
 * HaltError (deliberate stop) rethrows untouched.
 */
import { describeErrorCause } from "@secscan/redteam-llm-router";
import { promptCtx } from "../agents.js";
import { createCharteredComplete } from "../charter-completion.js";
import { buildFleetPrompt } from "../prompts/fleet-assembly.js";
import { HaltError } from "../context.js";
import { extractJsonBlock } from "../util.js";
import { tokenMeterFor } from "../harness2/trajectory-normalize.js";
import { syncLiveFindingsToState, writeKilledToRegistry } from "../dispatch/verdicts.js";
/** Checker preference: the Architect owns review; then the coordinator
 * (the sign-off seat), reporter, recon, exploiter. The producer is
 * removed from the list before picking — see selectChecker. */
export const CHECKER_PREFERENCE = ["architect", "coordinator", "reporter", "recon", "exploiter"];
/**
 * The checker for a finding: the first preferred seat that is NOT the
 * producer. Pure and total — for every producer (including 'runner'
 * and an absent stamp) some other seat is returned, so the pass can
 * never seat a finding's producer as its own checker.
 */
export function selectChecker(producer) {
    for (const seat of CHECKER_PREFERENCE) {
        if (seat !== producer)
            return seat;
    }
    // Unreachable: the preference list holds five distinct seats and a
    // producer can exclude at most one. Fail loud if that ever changes.
    throw new Error(`[peer-review] no checker seat available for producer ${String(producer)}`);
}
export const SEVERITY_LADDER = ["info", "low", "medium", "high", "critical"];
function coerceSeverity(s) {
    const l = s.toLowerCase();
    return SEVERITY_LADDER.includes(l)
        ? l
        : "low";
}
function oneNotchDown(sev) {
    const i = SEVERITY_LADDER.indexOf(coerceSeverity(sev));
    return i > 0 ? SEVERITY_LADDER[i - 1] : null;
}
const VERDICTS = ["upheld", "downgraded", "needs-evidence", "killed"];
/** Parse the checker's answer. Anything off-shape is null — the caller
 * records a failed challenge, never a guessed verdict. */
export function parsePeerVerdict(text) {
    const parsed = extractJsonBlock(text);
    if (!parsed || typeof parsed.verdict !== "string")
        return null;
    if (!VERDICTS.includes(parsed.verdict))
        return null;
    return {
        verdict: parsed.verdict,
        severity: typeof parsed.severity === "string" ? parsed.severity : undefined,
        rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 500) : "",
    };
}
function challengeMessages(ctx, lf, checker) {
    const producer = lf.producer ?? "unknown seat (recorded before producer stamps)";
    // The checker prompt is fleet-assembled for the ARCHITECT seat
    // (buildFleetPrompt + the verified record), not a hardcoded system.
    const system = buildFleetPrompt("reporter", `You are the ${checker} seat of an autonomous red-team fleet whose seats check each other's work. ` +
        `For this task you are NOT the producer — you are the PEER REVIEWER of the finding in the record below, ` +
        `and your job is to challenge the claim, not the target: producer and checker are never the same seat, and no finding ` +
        `reaches the report on its producer's say-so alone. Judge ONLY the record below — never invent evidence you were not shown.\n\n` +
        `Challenge three things: (1) EVIDENCE — does the recorded evidence actually prove the title, or is it equally consistent ` +
        `with a benign explanation? (2) SCOPE — does the finding stay inside the engagement's authorized scope below? ` +
        `(3) SEVERITY — is it honest for the impact the evidence actually demonstrates?\n\n` +
        `Answer with a JSON object only: {"verdict": "upheld" | "downgraded" | "needs-evidence" | "killed", ` +
        `"severity": "<only for downgraded: the honest lower severity>", "rationale": "<one or two concrete sentences>"}\n` +
        `- upheld: the evidence proves it and the severity is honest.\n` +
        `- downgraded: real, but the claimed severity overstates the demonstrated impact.\n` +
        `- needs-evidence: plausible, but the recorded evidence does not prove it yet — send it back rather than let it print as confirmed.\n` +
        `- killed: the evidence refutes it or shows the benign explanation. A kill stands unless stronger proof exists.`, promptCtx(ctx));
    const user = `FINDING UNDER CHALLENGE\n` +
        `Producer seat: ${producer}\n` +
        `Title: ${lf.title}\n` +
        `Severity claimed: ${lf.severity}\n` +
        `ATT&CK: ${lf.attackId}${lf.vulnClass ? ` · class: ${lf.vulnClass}` : ""}\n` +
        `Cell adjudication: ${lf.cellState ? lf.cellState.toUpperCase() : "none"}` +
        `${lf.cellState === "proven" ? " (dual-exploiter cell: both signatures + a passing negative control)" : ""}\n` +
        `Evidence: ${lf.evidence}\n` +
        (lf.payload ? `Payload used: ${lf.payload}\n` : "") +
        `Target: ${ctx.input.target}\n` +
        `Authorized scope (ROE hosts): ${ctx.hosts.join(", ")}`;
    return [
        { role: "system", content: system },
        { role: "user", content: user },
    ];
}
/** Apply one parsed verdict mechanically. Pure: mutates only the
 * finding's severity/stamp; list moves are the caller's. */
function applyVerdict(lf, checker, parsed) {
    const { verdict, rationale } = parsed;
    if (verdict === "upheld") {
        return { stamp: { checker, verdict, rationale, disposition: "flows" }, flow: "flows" };
    }
    if (verdict === "downgraded") {
        const from = coerceSeverity(lf.severity);
        const proposed = parsed.severity ? coerceSeverity(parsed.severity) : null;
        const to = proposed && SEVERITY_LADDER.indexOf(proposed) < SEVERITY_LADDER.indexOf(from)
            ? proposed
            : oneNotchDown(from);
        if (!to) {
            return {
                stamp: {
                    checker,
                    verdict,
                    rationale: `${rationale} (downgrade proposed at the severity floor — severity unchanged)`.slice(0, 500),
                    disposition: "flows",
                },
                flow: "flows",
                note: "downgrade at severity floor — flows unchanged",
            };
        }
        lf.severity = to;
        return {
            stamp: { checker, verdict, rationale, disposition: "downgraded", fromSeverity: from, toSeverity: to },
            flow: "flows",
            note: `severity ${from} → ${to}`,
        };
    }
    if (verdict === "needs-evidence") {
        return { stamp: { checker, verdict, rationale, disposition: "deferred" }, flow: "deferred" };
    }
    // killed — unless a PROVEN cell verdict already stands: proven wins.
    if (lf.cellState === "proven") {
        return {
            stamp: { checker, verdict, rationale, disposition: "flows" },
            flow: "flows",
            note: "kill overridden — PROVEN cell verdict stands (proven wins)",
        };
    }
    return { stamp: { checker, verdict, rationale, disposition: "killed" }, flow: "killed" };
}
/**
 * The reviewer pass: challenge every live finding with a different
 * seat and apply the outcomes. Runs after exploitation, before the
 * report (wired in phases/run.ts ahead of the exploit→report
 * sign-off, so sign-off counts are post-challenge). No-ops on dry
 * runs — there are no agent findings to challenge.
 */
export async function peerReviewPhase(ctx) {
    if (ctx.config.dryRunAgents)
        return;
    ctx.peerKilledLive ??= [];
    ctx.peerDeferredLive ??= [];
    const complete = ctx.deps.completeForRole ?? createCharteredComplete(ctx, "report");
    const counts = { challenged: 0, flows: 0, downgraded: 0, deferred: 0, killed: 0, failed: 0 };
    const survivors = [];
    for (const lf of [...ctx.liveFindings]) {
        const checker = selectChecker(lf.producer);
        counts.challenged++;
        ctx.events.append({
            phase: "report",
            actor: checker,
            action: "peer_challenge",
            target: ctx.input.target,
            result: `Challenging "${lf.title}" (${lf.attackId}, severity ${lf.severity}) produced by ${lf.producer ?? "unknown seat"}: ` +
                `evidence ${lf.evidence.length} chars${lf.cellState ? `, cell ${lf.cellState}` : ""}.`,
        });
        let parsed;
        try {
            const res = await complete(checker, challengeMessages(ctx, lf, checker), {
                tools: [],
                responseFormat: { type: "json_object" },
            });
            tokenMeterFor(ctx).record(res.usage);
            parsed = parsePeerVerdict(res.text);
            if (!parsed) {
                counts.failed++;
                ctx.events.append({
                    phase: "report",
                    actor: "runner",
                    action: "peer_review_failed",
                    target: ctx.input.target,
                    result: `"${lf.title}": ${checker} answered no parseable verdict — finding flows UNSTAMPED (no verdict fabricated).`,
                });
                survivors.push(lf);
                continue;
            }
        }
        catch (err) {
            if (err instanceof HaltError)
                throw err;
            counts.failed++;
            ctx.events.append({
                phase: "report",
                actor: "runner",
                action: "peer_review_failed",
                target: ctx.input.target,
                result: `"${lf.title}": checker call failed (${describeErrorCause(err)}) — finding flows UNSTAMPED (no verdict fabricated).`,
            });
            survivors.push(lf);
            continue;
        }
        const { stamp, flow, note } = applyVerdict(lf, checker, parsed);
        lf.peerReview = stamp;
        if (flow === "flows") {
            survivors.push(lf);
            if (stamp.disposition === "downgraded")
                counts.downgraded++;
            else
                counts.flows++;
        }
        else if (flow === "deferred") {
            ctx.peerDeferredLive.push(lf);
            counts.deferred++;
        }
        else {
            ctx.peerKilledLive.push(lf);
            counts.killed++;
            const kl = {
                hypothesis: lf.title,
                killingObservation: `Peer-review kill by ${checker}: ${parsed.rationale}`.slice(0, 500),
                attackId: lf.attackId,
                vulnClass: lf.vulnClass,
                payload: lf.payload,
            };
            ctx.killedLive.push(kl);
            writeKilledToRegistry(ctx, kl);
        }
        ctx.events.append({
            phase: "report",
            actor: checker,
            action: "peer_verdict",
            target: ctx.input.target,
            result: `"${lf.title}": verdict=${parsed.verdict} disposition=${stamp.disposition}` +
                `${note ? ` (${note})` : ""} — ${parsed.rationale}`,
        });
    }
    ctx.liveFindings = survivors;
    syncLiveFindingsToState(ctx);
    ctx.events.append({
        phase: "report",
        actor: "runner",
        action: "peer_review_complete",
        target: ctx.input.target,
        result: `Peer review: ${counts.challenged} challenged — ${counts.flows} upheld, ${counts.downgraded} downgraded, ` +
            `${counts.deferred} deferred, ${counts.killed} killed, ${counts.failed} unchallenged (checker failed — flowed unstamped).`,
    });
}
//# sourceMappingURL=peer-review.js.map