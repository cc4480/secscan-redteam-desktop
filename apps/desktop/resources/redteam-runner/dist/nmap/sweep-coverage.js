/**
 * How much of a sweep a profile can actually cover.
 *
 * The runner hands the engagement's per-host rate limit to nmap as `--max-rate` and
 * caps each host with `--host-timeout`. Those are set independently, so a wide
 * profile can be structurally unable to finish: `-p-` asks for 65535 ports, and at
 * 5 packets/second a 300-second host timeout reaches roughly 1500 of them. The scan
 * still returns, and its silence is indistinguishable from a genuine all-ports
 * sweep, so the caller has to be told which one it got. A later "no open ports"
 * claim must never rest on ports that were never probed.
 *
 * This lives beside the profile table rather than inside it so the policy module
 * stays within its size budget, and it derives the port count from the profile's
 * own arguments so the two can never drift apart.
 */
/** Ports a profile's arguments ask nmap to probe, or undefined when it names none. */
function requestedPorts(args) {
    // `-p-` means all 65535 TCP ports; the profile table keeps the flag literal.
    if (args.includes('-p-'))
        return 65535;
    const at = args.indexOf('--top-ports');
    if (at === -1)
        return undefined;
    const parsed = Number(args[at + 1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
/**
 * Estimate whether a profile can finish under the enforced rate and host timeout.
 * @param profile - the profile being run.
 * @param rateLimit - packets per second handed to nmap.
 * @param timeoutS - per-host timeout handed to nmap.
 * @returns the coverage estimate, or undefined when the profile names no port set.
 */
export function sweepReach(profile, rateLimit, timeoutS) {
    const requested = requestedPorts(profile.args);
    if (requested === undefined)
        return undefined;
    const reachable = Math.max(1, Math.floor(rateLimit)) * Math.max(1, Math.floor(timeoutS));
    return { requested, reachable, partial: reachable < requested };
}
//# sourceMappingURL=sweep-coverage.js.map