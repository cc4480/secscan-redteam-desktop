/**
 * Dispatch scope gate — the central choke point for target scope.
 *
 * Every tool call passes through dispatchTool; this gate runs there, after
 * the autonomy-tier check and before the rate limiter, so a refused call
 * sends nothing and consumes no rate token. It enforces the engagement's
 * ScopeGuard (src/safety/scope-guard.ts):
 *
 *   1. Target host: the call's resolved target host must survive the
 *      guard — deny-listed hosts are refused even when they are also in
 *      scope (deny beats allow), and hosts outside the declared scope are
 *      refused. This is the uniform backstop behind the per-handler and
 *      per-executor exact-match checks, which remain in place: a tool
 *      family that forgets its own check (the nmap/xtool gap) is still
 *      fenced here.
 *   2. Command text: a call carrying a shell `command` (the host-exec
 *      family) is scanned for targets the command itself would reach —
 *      an in-scope SSH session must not curl a deny-listed host. Only the
 *      deny list applies to command text, as in the source guard.
 *
 * A refusal is a `scope_violation` audit event plus a DENIED result the
 * coordinator re-plans around — never silent, never a throw.
 */

import type { Ctx } from "../context.js";
import type { EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import type { DispatchResult } from "./types.js";
import { scopeGuardFor } from "../safety/scope-guard.js";

/**
 * Run the scope gate for one dispatch. Returns the denial to send back
 * when the call must not reach its handler, or undefined to proceed.
 *
 * @param ctx - The engagement context.
 * @param phase - The current engagement phase (for the audit event).
 * @param call - The tool call being dispatched.
 * @param host - The call's resolved target host, when it has one.
 * @returns A denial DispatchResult, or undefined when the call is in scope.
 */
export function checkScopeGate(
  ctx: Ctx,
  phase: EngagementPhase,
  call: ToolCallRequest,
  host: string | undefined,
): DispatchResult | undefined {
  const guard = scopeGuardFor(ctx);
  const args = (call.arguments ?? {}) as Record<string, unknown>;

  if (host) {
    const verdict = guard.checkHost(host);
    if (!verdict.allowed) {
      // The scope the denial names is the attested record scope once
      // authorize has stamped it (ctx.verifiedScope governs the guard);
      // before that, the launch ROE is the only declared scope there is.
      const declaredScope = ctx.verifiedScope ?? ctx.input.roe.scope;
      const result =
        verdict.kind === "deny"
          ? `DENIED by scope: ${verdict.reason}. This host must never be touched in this engagement — pivot to an in-scope target or report the block.`
          : `DENIED by scope: ${verdict.reason}. Touch nothing outside the declared scope (scope: ${declaredScope.join(", ") || "(empty)"}) — pivot to an in-scope target or report the block.`;
      ctx.events.append({
        phase,
        actor: "runner",
        action: "scope_violation",
        target: host,
        result,
      });
      return { result, target: host };
    }
  }

  const command = typeof args["command"] === "string" ? args["command"] : "";
  if (command) {
    const violations = guard.checkCommand(command);
    if (violations.length > 0) {
      const named = violations.map((v) => `${v.target} (${v.reason})`).join("; ");
      const result =
        `DENIED by scope: command targets out-of-scope host(s): ${named}. ` +
        `The command runs on an in-scope host but reaches outside the engagement — rewrite it to touch only in-scope targets or report the block.`;
      ctx.events.append({
        phase,
        actor: "runner",
        action: "scope_violation",
        target: host ?? violations[0].target,
        result,
      });
      return { result, target: host };
    }
  }

  return undefined;
}
