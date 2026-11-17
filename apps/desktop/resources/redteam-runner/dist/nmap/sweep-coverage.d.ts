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
import type { NmapProfile } from './policy.js';
/** What a sweep can actually cover under the engagement's enforced rate and timeout. */
export interface SweepReach {
    /** Ports the profile asks for. */
    requested: number;
    /** Ports probeable within the host timeout at the enforced rate. */
    reachable: number;
    /** Whether the sweep cannot enumerate everything it requested. */
    partial: boolean;
}
/**
 * Estimate whether a profile can finish under the enforced rate and host timeout.
 * @param profile - the profile being run.
 * @param rateLimit - packets per second handed to nmap.
 * @param timeoutS - per-host timeout handed to nmap.
 * @returns the coverage estimate, or undefined when the profile names no port set.
 */
export declare function sweepReach(profile: NmapProfile, rateLimit: number, timeoutS: number): SweepReach | undefined;
