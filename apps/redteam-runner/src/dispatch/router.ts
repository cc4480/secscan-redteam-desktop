/**
 * Tool dispatcher: router + safety wrapper (v0.19.0 refactor — extracted from dispatch.ts).
 *
 * dispatchToolInner (dispatch/handlers.ts) routes each tool call to its
 * handler module in the original order. dispatchTool wraps it with
 * the v0.13.0 safety wrapper: rate limiting + per-target auto-halt +
 * autonomy-tier enforcement, all mechanical.
 */
import { type ActorRole, type EngagementPhase } from "../types.js";
import { type Ctx, HaltError } from "../context.js";
import { type ToolCallRequest } from "@secscan/redteam-llm-router";
import { checkTierAllows, recordExploitStep, readTierFile, TIER_NAMES } from "../accountability/index.js";
import { distressEscalationResult, isTargetDistress, readAbortFile, consumeAbortFile, classifyCredentialAttempt, classifyAuthOutcome, lockoutGuardFor, type CredentialClassification } from "../safety/index.js";
import { type DispatchResult } from "./types.js";
import { TOOL_TIMEOUT } from "./timeout.js";
import { recordItemAttempt } from "./verdicts.js";
import { checkVariantCap, recordVariantExecution } from "../variants/index.js";
import { postDispatchHooks, preDispatchGate } from "./policy-gate.js";
import { checkScopeGate } from "./scope-gate.js";
import { toolTargetHost } from "./target-host.js";
export { RATE_LIMITED_TOOLS } from "./target-host.js";
import { duplicateRefusal, recordCallOutcome } from "./duplicate-guard.js";
import { dispatchToolInner } from "./handlers.js";

/**
 * v0.24.0: mid-run tier changes. The operator may raise/lower the tier via
 * `redteam-runner escalate` or the UI; both rewrite tier.json in the
 * engagement dir (atomically). The dispatcher re-reads it before every tier
 * check so the new tier takes effect without restarting the engagement.
 * The change lands in the audit log — never silent. A missing or corrupt
 * file means "no change". Exported for tests; dispatchTool calls it.
 */
export function refreshTierFromDisk(ctx: Ctx, phase: EngagementPhase): void {
  const tf = readTierFile(ctx.events.dir);
  if (!tf || tf.tier === ctx.tier.current) return;
  const from = ctx.tier.current;
  ctx.tier.current = tf.tier;
  ctx.events.append({
    phase,
    actor: "runner",
    action: "tier_changed",
    result:
      `Autonomy tier changed mid-run: Tier ${from} (${TIER_NAMES[from]}) → Tier ${tf.tier} (${TIER_NAMES[tf.tier]})` +
      `${tf.by ? ` by ${tf.by}` : ""}${tf.reason ? ` — ${tf.reason}` : ""}. ` +
      `Picked up from tier.json; see approvals.jsonl for the operator approval record. No restart needed.`,
  });
}

/**
 * v0.25.0: cross-process kill switch. The UI cannot reach into a
 * CLI-launched engagement's process, so it writes abort.json into the
 * engagement dir; the dispatcher checks for it here on every dispatch
 * cycle. When the marker is found, the abort sequence is identical to the
 * in-process kill switch: set the flag, terminate every in-flight
 * execution via the registered controllers (shared ctx — covers parallel
 * tasks), count it for the safety manifest, log abort_engagement, consume
 * the marker (the audit event is the durable record), and throw HaltError
 * so the run unwinds to "halted". Exported for tests; dispatchTool calls
 * it. A missing or corrupt file means "no abort requested" — never a
 * crash, never a spurious abort.
 */
export function checkAbortSignal(ctx: Ctx, phase: EngagementPhase): void {
  if (ctx.hostKill.aborted) return;
  const sig = readAbortFile(ctx.events.dir);
  if (!sig) return;
  ctx.hostKill.aborted = true;
  for (const c of ctx.hostKill.controllers) {
    try {
      c.abort();
    } catch {
      /* best effort */
    }
  }
  ctx.hostKill.controllers.clear();
  ctx.safety.killSwitchAborts++;
  ctx.events.append({
    phase,
    actor: "coordinator",
    action: "abort_engagement",
    result:
      `ABORTED by operator: ${sig.reason ?? "operator abort"} ` +
      `(cross-process kill switch; requested ${sig.requestedAt}${sig.by ? ` by ${sig.by}` : ""})`,
  });
  consumeAbortFile(ctx.events.dir);
  throw new HaltError("aborted by operator (kill switch)");
}

export async function dispatchTool(ctx: Ctx, role: ActorRole, phase: EngagementPhase, call: ToolCallRequest): Promise<DispatchResult> {
  // v0.22.0 UI kill switch: the operator abort is mechanically identical to
  // the coordinator's abort_engagement. In-flight work is already dead
  // (controllers aborted when the flag was set); the next tool call throws
  // HaltError so the engagement unwinds to "halted" instead of spinning on
  // preflight refusals. Nothing sets hostKill.aborted and continues — the
  // coordinator's own abort sets it and throws immediately after.
  if (ctx.hostKill.aborted) {
    throw new HaltError("aborted by operator (kill switch)");
  }
  // v0.25.0 cross-process kill switch: a CLI-launched engagement has no
  // abort handle inside the UI server process, so the UI writes abort.json
  // into the engagement dir instead. Check for it on every dispatch — the
  // abort sequence below is identical to the in-process kill switch
  // (flag, controllers, audit event), then HaltError unwinds to "halted".
  // Checked before the rate limiter: an aborted run acquires nothing.
  checkAbortSignal(ctx, phase);
  const host = toolTargetHost(call);
  const args = call.arguments ?? {};
  // v0.17.0 accountability: autonomy tiers are MECHANICAL. A tool above the
  // current tier is refused before any packet and before the rate limiter —
  // v0.28.0: the tier check was moved ahead of limiter.acquire so a refused
  // call consumes no rate token and waits on nothing. The denial is an
  // event, never silent. There is no agent path to raise the tier; mid-run
  // changes arrive only via tier.json, written by `redteam-runner escalate`
  // or the UI with a recorded operator approval (escalateTier()).
  // v0.24.0: pick up operator tier changes without restarting the engagement.
  refreshTierFromDisk(ctx, phase);
  const tierDenial = checkTierAllows(ctx.tier, call.name, args, host);
  if (tierDenial) {
    return { result: tierDenial, target: host };
  }
  // Scope gate: the central target-scope choke point (deny-beats-allow,
  // plus the deny-list scan of command text). Runs before the limiter for
  // the same reason as the tier check — a refused call consumes no rate
  // token and sends nothing. The per-handler/per-executor checks remain
  // as the second layer; this gate is the uniform backstop behind them.
  const scopeDenial = checkScopeGate(ctx, phase, call, host);
  if (scopeDenial) {
    return scopeDenial;
  }
  // Q-LOCKOUT: the call's credential classification, computed at the
  // interlock gate below and consumed by the outcome recording beside
  // auto-halt (one post-dispatch block owns all per-host safety state).
  let lockoutCls: CredentialClassification | undefined;
  if (host) {
    // Auto-halt first: a halted target is refused before any packet AND
    // before waiting on the rate limiter — never hammer, never queue.
    if (ctx.safety.autoHalt.isHalted(host)) {
      const reason = ctx.safety.autoHalt.haltReason(host) ?? "auto-halted";
      return {
        result: `HALTED: target ${host} was auto-halted (${reason}). No further traffic to this host this engagement — pivot to another in-scope target or report the halt.`,
        target: host,
      };
    }
    // Duplicate guard (A1): an identical repeat of a call that already
    // completed (or already failed twice) is refused before the limiter —
    // it consumes no rate token and sends no traffic.
    const dup = duplicateRefusal(ctx, role, phase, call, host);
    if (dup) return dup;
    // Q-LOCKOUT interlock (spec §5.5): classify → trip check → budget
    // reservation, after the duplicate guard and BEFORE limiter.acquire —
    // a refused attempt consumes no rate token and sends no packet, and
    // out-of-scope / auto-halted hosts refused above never touch the
    // budget. The refusal is a result string, never a throw.
    lockoutCls = classifyCredentialAttempt(call);
    if (lockoutCls.kind !== "none") {
      const verdict = lockoutGuardFor(ctx).check(host, lockoutCls, call.name);
      if (!verdict.allowed) {
        if (verdict.refusalKind === "budget" || verdict.refusalKind === "opaque") {
          ctx.events.append({
            phase,
            actor: "runner",
            action: "lockout_budget_exhausted",
            target: host,
            result: verdict.refusal!,
          });
        }
        return { result: verdict.refusal!, target: host };
      }
      if (lockoutCls.kind !== "watch") {
        ctx.events.append({
          phase,
          actor: "runner",
          action: "credential_attempt",
          target: host,
          result: `${call.name} (${lockoutCls.kind}${lockoutCls.protocolClass ? `/${lockoutCls.protocolClass}` : ""}) admitted under the credential lockout budget for ${host}.`,
        });
      }
    }
    await ctx.safety.limiter.acquire(host);
  }
  // v0.20.0 variants: the per-item variant cap is MECHANICAL. A
  // variant-tagged call past the cap is denied before any packet — one
  // item can't spray the target.
  const variantDenial = checkVariantCap(ctx.itemLedger, args);
  if (variantDenial) {
    return { result: variantDenial, target: host };
  }
  // v0.34.0 operator controls: policy (deny-wins) and pre-execute hooks, then
  // post-hooks — all audited individually. A denial sends nothing.
  const gate = await preDispatchGate(ctx, phase, call, host);
  if (gate.denial) return gate.denial;
  let d = await dispatchToolInner(ctx, role, phase, gate.call);
  d = await postDispatchHooks(ctx, phase, gate.call, d, host);
  recordCallOutcome(ctx, role, phase, call, host, d);
  if (host) {
    const haltReason = ctx.safety.autoHalt.recordOutcome(host, isTargetDistress(d.result, d.errorCode));
    if (haltReason) {
      ctx.events.append({
        phase,
        actor: "runner",
        action: "target_auto_halt",
        target: host,
        result: `AUTO-HALT: ${host} — ${haltReason}. Further traffic to this host refused this engagement.`,
      });
      // Spec §6: the halt escalates as a preserved distress record; resume is a recorded decision, never automatic (safety/distress-breaker.ts).
      ctx.events.append({ phase, actor: "runner", action: "distress_escalation", target: host, result: distressEscalationResult(ctx.events.engagementId, host, haltReason) });
    }
    // Q-LOCKOUT: the credential outcome is recorded beside auto-halt —
    // a success resets the key's failed-validation count, a failed
    // validation spends budget, a lockout signal trips the host (and the
    // campaign ceiling can trip the engagement). Watch/event-only calls
    // record signals only; their budgets were settled at admission.
    if (lockoutCls && lockoutCls.kind !== "none") {
      const outcome = classifyAuthOutcome(d.result, d.ok);
      const info = lockoutGuardFor(ctx).recordOutcome(host, lockoutCls, call.name, outcome);
      ctx.events.append({
        phase,
        actor: "runner",
        action: "credential_attempt_outcome",
        target: host,
        result: `${call.name} (${lockoutCls.protocolClass ?? "opaque"}): ${outcome}.`,
      });
      if (outcome === "lockout-signal") {
        ctx.events.append({
          phase,
          actor: "runner",
          action: "lockout_signal_detected",
          target: host,
          result: `LOCKOUT SIGNAL: ${call.name} against ${host} reported a locked or locking account — tripping all credential testing on this host.`,
        });
      }
      if (info.trippedNow) {
        ctx.events.append({
          phase,
          actor: "runner",
          action: "lockout_tripped",
          target: host,
          result:
            info.trippedNow === "campaign"
              ? `CAMPAIGN LOCKOUT TRIP: ${info.reason}. Credential testing is refused engagement-wide; resume requires a recorded operator decision.`
              : `LOCKOUT TRIP: ${host} — ${info.reason}. Credential testing against this host is refused; resume requires a recorded operator decision.`,
        });
      }
    }
    // v0.17.0 accountability: a successful validated exploit step consumes
    // the Tier 1 per-target chain budget. Denials, halts, and failures don't.
    // A failed host-exec or msf call (connection refused, non-zero exit, marker
    // not echoed) carries ok:false and must not consume the budget — the old
    // string heuristic treated "ssh host failed: …" as clean and permanently
    // wedged the target after one failed attempt.
    const clean = d.ok === undefined
      ? !/^(DENIED|HALTED)/i.test(d.result) && !d.result.startsWith("probe failed")
      : d.ok;
    if (clean) recordExploitStep(ctx.tier, call.name, args, host);
  }
  // v0.18.0 per-item verdicts: a clean execution tagged with batteryItem
  // marks that item attempted (pending/blocked → executed-clean). Denials,
  // halts, aborts, refusals, and failed probes never mark anything. The
  // verdict tools (record_finding / record_killed / record_item_verdict)
  // set terminal dispositions in their own handlers — skipped here.
  if (
    call.name !== "record_finding" &&
    call.name !== "record_killed" &&
    call.name !== "record_item_verdict" &&
    call.name !== "variant_list" &&
    // v0.21.0: nuclei template listing is recon for the methodology item —
    // only `run` executions mark the item attempted.
    !(call.name === "nuclei_exec" && (call.arguments as Record<string, unknown> | undefined)?.["action"] !== "run") &&
    // Q-TOOLTIMEOUT §2.3 rule 2: a coded tool timeout executed nothing —
    // it must not mark its battery item attempted or advance a variant.
    d.errorCode !== TOOL_TIMEOUT &&
    !/^(DENIED|HALTED|ABORTED|REFUSED)/i.test(d.result) &&
    !d.result.startsWith("probe failed")
  ) {
    recordItemAttempt(ctx, args, phase);
    // v0.20.0 variants: variant-tagged clean executions advance the item's
    // expansion; exhaustion settles it to executed-clean with honest counts.
    recordVariantExecution(ctx, args, phase);
  }
  return d;
}
