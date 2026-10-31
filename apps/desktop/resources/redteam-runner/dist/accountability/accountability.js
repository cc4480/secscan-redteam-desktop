/**
 * Named accountability + approval log (v0.17.0) — the human side of the
 * autonomy tiers.
 *
 * Buyers reject AI-only testing without a named human accountable per
 * finding. This module provides:
 *
 *  - `requireNamedOperator`: production engagements refuse to start without
 *    a named human operator (fail fast, before any packet). Staging warns
 *    via the existing "(operator name not supplied)" fallback.
 *  - `ApprovalLog`: every approval (tier declared, tier escalation,
 *    production confirmation, scope renewal) appended to an
 *    append-only-per-engagement log (approvals.jsonl), with who/what/when.
 *    The log is embedded in the compliance pack and the safety manifest.
 *  - `escalateTier`: the ONLY path to change the tier mid-engagement. Raising
 *    it requires an operator name + reason; lowering it is allowed freely but
 *    still logged. The approval is recorded FIRST, then the tier moves. There
 *    is no agent tool that calls this — a tier change is an operator act,
 *    never a silent agent decision.
 *
 * Honesty: tiers describe what the agents MAY do, never imply the human did
 * the work. The accountability record adds who supervised and approved.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TIER_NAMES } from "./tiers.js";
export const OPERATOR_ENV = "REDTEAM_OPERATOR";
/** Resolve the named human operator: explicit input wins, then env. */
export function resolveOperatorName(inputName, env = process.env) {
    const v = (inputName ?? "").trim() || (env[OPERATOR_ENV] ?? "").trim();
    return v || undefined;
}
/**
 * Mechanical: production engagements refuse to start without a named human
 * operator. Someone must be accountable. Staging keeps the existing
 * fallback labeling (honest "(not supplied)" marker downstream).
 */
export function requireNamedOperator(environment, operator) {
    if (environment === "production" && !operator) {
        throw new Error(`[accountability] PRODUCTION engagements require a named human operator accountable for the run. ` +
            `Pass --operator "<name>" (or set ${OPERATOR_ENV}=<name>). Someone must own the findings, the tier, and the scope.`);
    }
}
/**
 * Append-only approval log, one file per engagement (approvals.jsonl).
 * Entries are never edited or deleted — the log is the record.
 */
export class ApprovalLog {
    seq = 0;
    file;
    engagementId;
    constructor(dir, engagementId) {
        mkdirSync(dir, { recursive: true });
        this.file = join(dir, "approvals.jsonl");
        this.engagementId = engagementId;
        // Resume sequence if the file already exists (re-entrant runs).
        if (existsSync(this.file)) {
            for (const line of readFileSync(this.file, "utf8").split("\n")) {
                if (!line.trim())
                    continue;
                try {
                    const e = JSON.parse(line);
                    if (typeof e.seq === "number" && e.seq >= this.seq)
                        this.seq = e.seq + 1;
                }
                catch {
                    /* corrupt line: skip, keep counting */
                }
            }
        }
    }
    append(kind, operator, detail, fromTier, toTier) {
        const entry = {
            seq: this.seq++,
            ts: new Date().toISOString(),
            engagementId: this.engagementId,
            operator,
            kind,
            detail,
            ...(fromTier !== undefined ? { fromTier } : {}),
            ...(toTier !== undefined ? { toTier } : {}),
        };
        appendFileSync(this.file, JSON.stringify(entry) + "\n");
        return entry;
    }
    list() {
        if (!existsSync(this.file))
            return [];
        const out = [];
        for (const line of readFileSync(this.file, "utf8").split("\n")) {
            if (!line.trim())
                continue;
            try {
                out.push(JSON.parse(line));
            }
            catch {
                /* skip corrupt lines */
            }
        }
        return out;
    }
    get path() {
        return this.file;
    }
}
/**
 * The ONLY path to change the tier mid-engagement. Raising the tier requires
 * a named operator and a reason; the approval is recorded BEFORE the tier
 * moves. Lowering the tier mid-run is harmless (it only shrinks what agents
 * may do), so it is allowed freely — but it is still logged with the
 * operator's name. There is no agent tool that calls this — a tier change is
 * an operator act, never a silent agent decision.
 *
 * Returns the recorded approval entry. Refuses no-op moves.
 */
export function escalateTier(state, toTier, log, approval) {
    const operator = (approval.operator ?? "").trim();
    if (!operator) {
        throw new Error("[accountability] tier change requires a named operator — refusing anonymous tier change.");
    }
    if (toTier === state.current) {
        throw new Error(`[accountability] tier is already ${state.current} (${TIER_NAMES[state.current]}) — no-op tier change refused.`);
    }
    const up = toTier > state.current;
    const reason = (approval.reason ?? "").trim();
    if (up && !reason) {
        throw new Error("[accountability] raising the tier requires a recorded reason — refusing unexplained escalation.");
    }
    const fromTier = state.current;
    const kind = up ? "tier-escalation" : "tier-de-escalation";
    const entry = log.append(kind, operator, up
        ? `Tier escalated ${fromTier} (${TIER_NAMES[fromTier]}) → ${toTier} (${TIER_NAMES[toTier]}): ${reason}`
        : `Tier lowered ${fromTier} (${TIER_NAMES[fromTier]}) → ${toTier} (${TIER_NAMES[toTier]}) by ${operator}${reason ? `: ${reason}` : ""}`, fromTier, toTier);
    state.current = toTier;
    return entry;
}
//# sourceMappingURL=accountability.js.map