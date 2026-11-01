/**
 * redteam-runner CLI argument parsing: arg/argAll/flag helpers, the usage
 * text, and buildInput() which turns argv into an EngagementInput.
 */
import { ALL_TARGETS, isTargetId } from "../targets.js";
import { parseTier } from "../accountability/index.js";
export function arg(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
export function argAll(flag) {
    const out = [];
    for (let i = 0; i < process.argv.length; i++) {
        if (process.argv[i] === flag && process.argv[i + 1])
            out.push(process.argv[i + 1]);
    }
    return out;
}
export function flag(name) {
    return process.argv.includes(name);
}
/**
 * v0.26.0: --log-max-bytes <n> / --log-max-archives <n> â€” log-rotation
 * overrides for `start` and `watch`. Env REDTEAM_LOG_MAX_BYTES /
 * REDTEAM_LOG_MAX_ARCHIVES. Fail fast with a clear message on bad values.
 */
export function parseLogRotationArgs() {
    const out = {};
    const bytesRaw = arg("--log-max-bytes");
    if (bytesRaw !== undefined) {
        const n = Number(bytesRaw);
        if (!Number.isInteger(n) || n <= 0) {
            console.error(`[runner] bad --log-max-bytes ${JSON.stringify(bytesRaw)}; want a positive integer (bytes per log file before rotation)`);
            process.exit(2);
        }
        out.maxLogBytes = n;
    }
    const archRaw = arg("--log-max-archives");
    if (archRaw !== undefined) {
        const n = Number(archRaw);
        if (!Number.isInteger(n) || n <= 0) {
            console.error(`[runner] bad --log-max-archives ${JSON.stringify(archRaw)}; want a positive integer (archives kept per log file)`);
            process.exit(2);
        }
        out.maxLogArchives = n;
    }
    return out;
}
export function usage() {
    console.error(`Usage:
  redteam-runner start --target <domain|url> --mode <red|black> --objective "<text>" --scope <host> [--scope <host>...] [--out-of-scope <host>...] [--exclude <Txxxx>...] [--blackout "02:00-04:00 America/Chicago"...] [--client "<name>"] [--full-battery] [--targets secscan,seclayer,webapp,windows,linux] [--env staging|production] [--confirm-production] [--max-rps <n>] [--tier 0|1|2] [--confirm-tier2-production] [--operator "<name>"] [--local-sandbox] [--dry-run]
  redteam-runner start --target secscan+seclayer --mode red --objective "<text>" --scope secscan.us   # full-battery unified engagement (web targets only)
  redteam-runner queue  --target ... (same flags)   # enqueue for the watcher / console
  redteam-runner watch [--queue <dir>]              # run queued jobs until aborted
  redteam-runner watch --profile <profile.json> [--once] [--trigger "<change ref>"] [--max-rps <n>] [--log-max-bytes <n>] [--log-max-archives <n>]
    # v0.16.0 continuous testing: run the profile's engagement on its
    # cadence, detect drift vs the rolling baseline, alert on new
    # critical/high findings. --once runs a single cycle and exits
    # (for cron/systemd/CI schedulers). --trigger runs once immediately,
    # tagged with the change reference (CI/CD hook: wire your pipeline's
    # webhook to this command). Without --once/--trigger, loops on the
    # profile's cadence.intervalHours until Ctrl+C. Every cycle re-checks
    # scopeValidUntil â€” expired authorization refuses to run, fail closed.
  redteam-runner escalate --engagement <id> --tier <0|1|2> --operator "<name>" [--reason "<text>"] [--confirm-tier2-production] [--engagements-dir <dir>]
    # v0.24.0 mid-run tier change: records the operator approval in
    # approvals.jsonl and rewrites tier.json; a running engagement picks
    # the new tier up on its next tool dispatch (no restart). Raising the
    # tier requires --reason; lowering it is logged freely. Tier 2 on a
    # production engagement additionally needs --confirm-tier2-production
    # (or REDTEAM_TIER2_PROD_CONFIRM=1). Agents can never call this.

--full-battery (or --target secscan+seclayer): ONE unified engagement running the
target-specific batteries (3 categories Ã— selected targets). The coordinator
prompt carries the selected batteries as the plan skeleton; coverage counts
complete only when every cell is probed or honestly BLOCKED.
--targets <csv>: subset of secscan,seclayer,webapp,windows,linux for a full-battery run
(default: the four vendor targets; add webapp to opt in the generic client-webapp battery).
Only applies with --full-battery. Several battery items
carry honest prerequisites (each tagged [needs: ...] in the plan skeleton,
e.g. the Metasploit items need msfrpcd and the Nuclei items need the nuclei
binary); three need more than operator tooling â€” WS-064: kerberos ticket
material, WS-065: human operator for the shadowing act, LX-041: privileged
test client for the mount proof â€” see docs/ROADMAP.md; --scope must cover
secscan.us for the web targets.

--out-of-scope <host> [--out-of-scope <host>...]: hosts, IPs or CIDRs that must
never be touched, even when they fall inside --scope (e.g. a third-party
subdomain of an in-scope domain). Enforced mechanically at dispatch by the
scope guard — deny beats allow — including targets named inside host-exec
command text. Scope entries may also be CIDRs or parent domains: a listed
domain covers its subdomains for the dispatch scope check (the per-tool
checks still apply their own exact-match rules downstream).

--local-sandbox: LOCAL SANDBOX MODE ONLY. Skips ownership verification and the
private-host rejection, but only for a target that already resolves to a
private/loopback address (e.g. localhost, 127.0.0.1). No effect on a real
domain. Use only against infrastructure you own, e.g. a local Juice
Shop/DVWA container â€” never against a live/internet target.

--dry-run: skip the live agent loops (no DEEPSEEK_API_KEY needed; QWEN_API_KEY
is optional since v0.6) â€” runs gating/authorize/scope/report plumbing only, useful for
smoke-testing the runner itself.

--env staging|production (v0.13.0 safety case): staging (default) runs the
full battery with configured rate limits. production REQUIRES explicit
operator confirmation (--confirm-production or REDTEAM_PROD_CONFIRM=1) â€”
without it the runner refuses to start, mechanically, before any packet.
Production also caps the per-host rate limit at 2 rps even if configured
higher. Env alternative: REDTEAM_ENV=staging|production.
--max-rps <n>: per-host rate limit override (requests/sec). Env
REDTEAM_MAX_RPS. Defaults: 5 staging, 2 production.
--max-variants <n>: per-item payload-variant cap (v0.20.0). Env
REDTEAM_MAX_VARIANTS. Defaults: 25 staging, 10 production. Caps how many
curated variant executions one battery item may run â€” enforced mechanically.
--log-max-bytes <n> / --log-max-archives <n> (v0.26.0): log-rotation
overrides. Env REDTEAM_LOG_MAX_BYTES / REDTEAM_LOG_MAX_ARCHIVES. Defaults:
50 MiB per log file, 5 archives kept. When events.jsonl exceeds the cap it
is archived (immutable, chmod 444) and a log_rotated audit event names the
archive + its seq range; engagement.md rotates alongside, and watch mode's
history.jsonl rotates under the same policy. A watch profile may also set
logRetention.maxBytes / logRetention.maxArchives (CLI/env override it).

--tier 0|1|2 (v0.17.0 accountability): graduated agent autonomy, enforced
mechanically in the tool dispatcher. 0 = observe (read-only recon only);
1 = validate (single-step validated exploitation, one step per target â€”
chaining refused); 2 = chain (multi-step attack chains, still
non-destructive, no-DoS). Default: 2 on staging, 1 on production. Env
alternative: REDTEAM_TIER=0|1|2. Tier 2 on production additionally requires
--confirm-tier2-production (or REDTEAM_TIER2_PROD_CONFIRM=1) â€” without it the
runner refuses to start. Production engagements also require a named human
operator (--operator "<name>" or REDTEAM_OPERATOR) â€” someone must own the
findings, the tier, and the scope.

  redteam-runner reverify --bundle <poc/F-1.json> [--scope <host>...] [--execute] [--out <dir>]
    # v0.14.0 mechanical retest: re-executes a PoC bundle's steps against the
    # target. Without --execute: prints the replay plan only (no traffic).
    # With --execute: requires --scope (exact hosts; enforced mechanically),
    # verdict reproduced/not-reproduced/target-changed is written to the
    # report and â€” v0.15.0 â€” pushed to linked Jira/ServiceNow tickets via
    # integrations.json when those sinks are configured.
    # replays ssh_exec/winrm_exec/msf_exec steps with a FRESH canary marker
    # (credentials resolve from env, never from the bundle), and reports
    # reproduced | not-reproduced | target-changed. Exit: 0 reproduced,
    # 1 not-reproduced, 2 target-changed.

  redteam-runner commands                          # list slash commands (scan/deepscan/nmap/nuclei/metasploit/pcscan/report)
redteam-runner command "<line>" [--execute] [--approve] [--json]  # parse, plan and optionally run a command
redteam-runner ui [--port 8787] [--listen <addr>] [--engagements-dir <dir>]
  redteam-runner doctor [--json]                    # check external tools, wordlist, MSF RPC and required credentials
    # v0.22.0 web console: loopback-only (127.0.0.1) token-authenticated
    # dashboard wired directly to these same CLI code paths â€” launch
    # engagements, stream the operation feed, browse findings with proof
    # bundles, inspect coverage and compliance packs, trigger watch cycles,
    # and manage engagements. The startup token is printed to the terminal
    # and required on every request. --listen overrides the loopback bind
    # and prints a warning. Env: REDTEAM_UI_TOKEN (use your own token),
    # REDTEAM_HOME or engagements default like the CLI.

Env: MODEL_API_KEY (the fleet's model key; DEEPSEEK_API_KEY also supported), QWEN_API_KEY (optional since v0.6), SECSCAN_MCP_TOKEN + SECSCAN_MCP_URL (optional, service-verification opt-in only), REDTEAM_LOCAL_SANDBOX=1, REDTEAM_TEST_MODE=1 (TESTING ONLY — operator order: bypasses the mechanical restraints — ownership verification, tier enforcement, lockout interlock, rate limiting, variant cap, technique exclusions, destructive/DoS denylists — for declared in-scope targets; every bypass is event-logged and the record carries an operator self-attestation, never a fabricated proof. Scope and the out-of-scope deny list stay in force).
Host-exec (v0.9.0, Windows/Linux batteries): REDTEAM_SSH_USER + one of
REDTEAM_SSH_PASSWORD / REDTEAM_SSH_KEY / REDTEAM_SSH_KEY_PATH;
REDTEAM_SMB_USER + REDTEAM_SMB_PASSWORD (+ optional REDTEAM_SMB_DOMAIN);
REDTEAM_WINRM_USER + REDTEAM_WINRM_PASSWORD. Test accounts only, via
environment or Secure Vault â€” never in code, never logged.
Metasploit bridge (v0.11.0, CVE exploit validation): REDTEAM_MSFRPC_USER +
REDTEAM_MSFRPC_PASS (+ optional REDTEAM_MSFRPC_HOST / REDTEAM_MSFRPC_PORT /
REDTEAM_MSFRPC_TLS=0). Requires the operator's msfrpcd running
(msfrpcd -P <pass> -U <user> -a 127.0.0.1 -p 55553 -S) â€” fail closed otherwise.`);
    process.exit(2);
}
export function parseBlackout(s) {
    const m = s.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})(?:\s+(.+))?$/);
    if (!m) {
        console.error(`[runner] bad --blackout ${JSON.stringify(s)}; want "HH:MM-HH:MM [Timezone]"`);
        process.exit(2);
    }
    return { start: m[1], end: m[2], tz: m[3] };
}
export function buildInput() {
    const target = arg("--target");
    const mode = arg("--mode");
    const objective = arg("--objective");
    const scopes = argAll("--scope");
    if (!target || !mode || !objective || scopes.length === 0)
        usage();
    const fullBattery = process.argv.includes("--full-battery") || target === "secscan+seclayer";
    const excludeArgs = argAll("--exclude");
    // --targets narrows the full-battery subset; the secscan+seclayer shortcut pins web targets.
    let targets;
    if (target === "secscan+seclayer") {
        targets = ["secscan", "seclayer"];
    }
    else if (arg("--targets")) {
        const parsed = arg("--targets").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
        const bad = parsed.filter((s) => !isTargetId(s));
        if (bad.length > 0) {
            console.error(`[runner] bad --targets ${JSON.stringify(bad)}; want comma-separated subset of ${ALL_TARGETS.join(",")}`);
            process.exit(2);
        }
        targets = parsed;
    }
    const outOfScope = argAll("--out-of-scope");
    const roe = {
        scope: scopes,
        ...(outOfScope.length > 0 ? { outOfScope } : {}),
        excludedTechniques: excludeArgs.length > 0 ? excludeArgs : null,
        blackoutWindows: argAll("--blackout").map(parseBlackout),
        stopConditions: argAll("--stop"),
        deconflictionContact: arg("--contact"),
        notes: arg("--notes"),
    };
    // v0.13.0 safety case: stagingâ†’production graduation. --env production
    // requires --confirm-production (or REDTEAM_PROD_CONFIRM=1), enforced
    // mechanically at engagement start.
    const envArg = arg("--env");
    let environment;
    if (envArg) {
        const v = envArg.trim().toLowerCase();
        if (v !== "staging" && v !== "production" && v !== "prod") {
            console.error(`[runner] bad --env ${JSON.stringify(envArg)}; want staging|production`);
            process.exit(2);
        }
        environment = v === "staging" ? "staging" : "production";
    }
    // v0.17.0 accountability: graduated autonomy tiers, mechanically enforced.
    let tier;
    const tierArg = arg("--tier");
    if (tierArg !== undefined) {
        try {
            tier = parseTier(tierArg);
        }
        catch (err) {
            console.error(`[runner] ${err.message}`);
            process.exit(2);
        }
    }
    return {
        target: target,
        mode: mode,
        objective: objective,
        roe,
        client: arg("--client"),
        fullBattery,
        targets,
        environment,
        confirmProduction: flag("--confirm-production"),
        tier,
        confirmTier2Production: flag("--confirm-tier2-production"),
        operatorName: arg("--operator"),
    };
}
//# sourceMappingURL=args.js.map