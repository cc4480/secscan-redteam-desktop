/**
 * Linux target profile — host.
 *
 * EXHAUSTIVE battery (v0.8.0): surface × technique. Every distinct attacker
 * intent against a Linux host's real surface is one item. Surfaces: recon
 * (host enumeration plus prober-reachable web ports), SSH hardening & access,
 * privilege escalation (SUID/SGID, sudo, capabilities, cron/at, PATH and
 * linker hijacking, systemd, kernel, NFS, containers/LXD), exposed services
 * (audited as FINDINGS via read-only checks), file-permission & secret
 * auditing, persistence FINDINGS (reported, never planted), accounts &
 * authentication, logging & detection, network posture, kernel & system
 * hardening, cross-cutting chains.
 *
 * Execution model (v0.10.0): the runner's `ssh_exec` host tool executes this
 * battery — non-interactive SSH command execution with the safety core
 * (scope, denylist, timeouts) — plus `ssh_agent_audit` (LX-018/LX-019: agent
 * socket exposure + abuse-path analysis via agent-forwarded sessions) and
 * `nfs_enum` (LX-041: userland RPC/MOUNT export enumeration, no kernel
 * mount). One item keeps an honest prerequisite in `needs` (NOT plan-only —
 * it executes when the prerequisite is met): LX-041's mount+file proof
 * needs a privileged test client (operator-designated, in scope).
 *
 * Non-destructive always: read-only enumeration preferred; no service
 * crashing; no destructive payloads; persistence mechanisms REPORTED as
 * findings, never planted; privesc proofs are safe non-destructive checks
 * (version output, permission bits, --help, dry reads) — never a real root
 * shell. Credential testing against client-PROVIDED authorized test accounts
 * ONLY (T1078) — never guessed, never stuffed.
 */
import type { TargetProfile } from "./types.js";
export declare const LINUX_PROFILE: TargetProfile;
