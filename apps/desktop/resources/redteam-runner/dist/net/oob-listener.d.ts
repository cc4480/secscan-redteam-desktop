/**
 * Loopback out-of-band collaborator.
 *
 * The Seclayer blind classes (SSRF, blind XXE, blind RCE) can only be proven by a
 * callback the target makes to an address the engagement controls. The vendored
 * `#seclayer/server/oob` module defines that contract but ships only a client for a
 * HOSTED collaborator, so a standalone app has nothing to point a payload at and the
 * honest verdict for those classes is "not run".
 *
 * This module supplies the missing half: an HTTP listener bound to the loopback
 * interface, which is the one address this app can offer without a hosting
 * dependency. It implements the same `OobCollaborator` contract the probes already
 * accept, so wiring it in changes no probe code.
 *
 * What it can and cannot prove: a target that runs on THIS machine (the canonical
 * local-assessment engagement) can reach it, so a callback is genuine proof of a
 * blind class. A target elsewhere cannot reach this machine's loopback, so no
 * callback arrives — and no callback is not evidence of safety. A scan of a remote
 * target that finds nothing here must still report the class as not-run.
 *
 * Tokens are 24 random bytes: unguessable, so an unrelated scanner cannot forge a
 * callback by guessing a URL, and a token that was never issued is refused.
 */
import type { OobCollaborator } from '#seclayer/server/oob.js';
/** Options for {@link createLoopbackOob}. */
export interface LoopbackOobOptions {
    /** Bind address. Only loopback is accepted — see {@link assertLoopback}. */
    host?: string;
    /** Interval between arrival checks while polling. */
    pollIntervalMs?: number;
}
/** A loopback collaborator, plus the teardown the hosted client does not need. */
export interface LoopbackOob extends OobCollaborator {
    /** Stop the listener and release its port. Idempotent. */
    close(): Promise<void>;
}
/**
 * Whether a target hostname names THIS machine.
 *
 * Deliberately stricter than the runner's `isPrivateOrLoopbackHost`: a collaborator
 * bound to 127.0.0.1 is reachable only from the machine running this app, so a LAN
 * target at 192.168.x.x is as unreachable as an internet target. Offering the
 * collaborator to either would make the blind-class probe wait its full poll budget
 * for a callback that can never come.
 * @param hostname - the target hostname or bracketed IPv6 literal.
 * @returns true when the address is loopback, i.e. the target is this machine.
 */
export declare function isLoopbackTarget(hostname: string): boolean;
/**
 * Run a scan step with a collaborator attached exactly when one can work.
 *
 * A blind class (SSRF, blind XXE) is proven only by a callback the target makes to
 * an address this app controls. The collaborator this app can offer without a
 * hosting dependency is a loopback listener, which only a target on THIS machine
 * can reach. So a local target gets one, and a remote target gets none: the blind
 * probe no-ops, and the class is reported not-run rather than clean.
 *
 * The listener is always closed, including when the step throws, so a scan cannot
 * leak a bound port.
 * @param targetUrl - the URL under test; its hostname decides whether a collaborator is offered.
 * @param run - the scan step; receives the collaborator, or undefined when none applies.
 * @returns whatever `run` returns.
 */
export declare function withLoopbackOob<T>(targetUrl: string, run: (oob: OobCollaborator | undefined) => Promise<T>): Promise<T>;
/**
 * Start a loopback out-of-band collaborator.
 *
 * The listener is unref'd so an idle collaborator never keeps the process alive on
 * its own; callers that need it running hold a scan open, which they already do.
 * @param options - bind address and poll interval; loopback and 400ms by default.
 * @returns the collaborator, listening and ready to issue probes.
 */
export declare function createLoopbackOob(options?: LoopbackOobOptions): Promise<LoopbackOob>;
