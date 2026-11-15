/**
 * Auth gate: a `tools/pre-execute` hook that keeps active testing scoped.
 *
 * Scan tools exposed to the fleet are namespaced as
 * `mcp__<serverName>__<tool>` — e.g. `mcp__secscan__scan_url`. This gate is
 * the agent-layer backstop so an explicit active-testing request can never
 * dispatch without proof of domain ownership.
 *
 * Verification is LOCAL: before allowing an active-testing scan, the gate
 * consults the app's own verified-domain record and allows only listed
 * domains. The app itself issues the challenge token, checks the
 * `_secscan-challenge.<domain>` DNS TXT record itself, and records the
 * result in a local file (@secscan/redteam-auth-gate's local.ts). That
 * record is the sole source of truth — there is no operator allowlist or
 * other out-of-band bypass, and no external verification service or token
 * is involved, matching the runner's own gate. Any check error fails
 * closed (deny).
 *
 * SCOPE OF THIS HOOK — the scan half only. Host-family probes (`mcp__redteam__*`
 * with a `targetProfile` of secscan, seclayer, windows or linux) pass through
 * here by design: host scope is the engagement engine's authority, and the
 * engine is the runner those calls reach. A second scope check at this layer
 * would have to either duplicate the engine's in-scope host list — two sources
 * of truth about one authorization question — or assert nothing the model could
 * not already read with its own token. Neither is defence in depth, so neither
 * is done. The full argument lives in
 * @secscan/redteam-auth-gate's src/hook.ts module doc comment.
 *
 * Field names verified against @deepseek-ai/dsh-tools 0.2.0-rc.2:
 * ToolExecution has `name` (tool name) and `arguments` (unknown).
 */
import { decide, LocalDomainVerifier, } from '@secscan/redteam-auth-gate';
function gateContext() {
    const verifier = LocalDomainVerifier.create();
    return {
        // Fail closed twice: the verifier already returns false on any
        // error, and the wrapper below swallows anything unexpected.
        isVerified: async (domain) => {
            try {
                return await verifier.isVerified(domain);
            }
            catch {
                return false;
            }
        },
    };
}
/**
 * Installs the gate on `ctx`. Matches the documented hook-plugin pattern
 * (docs/cookbook/extension-cookbook.md: `ctx.on('tools/pre-execute',
 * async (exec, next) => ...)` returning a PreToolDecision).
 */
export function installAuthGate(ctx) {
    const gate = gateContext();
    ctx.on('tools/pre-execute', async (exec, next) => {
        const decision = await decide({
            toolName: exec.name,
            arguments: (exec.arguments ?? {}),
        }, gate);
        if (decision.kind === 'deny')
            return decision;
        return next();
    });
}
