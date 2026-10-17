/**
 * Operator pairing for the UI console (v0.34.0).
 *
 * Today the console generates a 256-bit bearer token at startup and prints it.
 * That is fine when the operator sits at the machine and wrong when they do not:
 * a long token gets pasted into chat, into a ticket, into a shell history. The
 * pairing flow replaces the paste with a short-lived, single-use, guess-limited
 * code exchanged for a session token over the authenticated channel.
 *
 * Ported from AlterEgo's verified implementation (6-digit, 30-minute TTL,
 * single-use, 5-guess lockout, manual re-arm). Deliberately transport-agnostic:
 * `exchange()` takes the presented code and returns a token, so the server route
 * and the CLI can share one implementation, and the whole thing is unit-testable
 * without a socket.
 *
 * Opt-in: REDTEAM_PAIRING=1 enables it. Without that the console keeps the
 * printed-token behaviour exactly as before.
 */
export declare const PAIRING_TTL_MS: number;
export declare const PAIRING_MAX_ATTEMPTS = 5;
export declare const PAIRING_ENV_ENABLE = "REDTEAM_PAIRING";
export interface PairingState {
    locked: boolean;
    consumed: boolean;
    attemptsRemaining: number;
    expiresAt: number;
}
export interface ExchangeResult {
    ok: boolean;
    token?: string;
    reason?: string;
    state: PairingState;
}
/** True when the operator opted into pairing. */
export declare function pairingEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare class PairingManager {
    private code;
    private expiresAt;
    private consumed;
    private failures;
    private readonly now;
    /** Token factory is injectable so tests are deterministic. */
    private readonly mintToken;
    constructor(opts?: {
        now?: () => number;
        mintToken?: () => string;
    });
    /** Mint a fresh 6-digit code, resetting consumption and failures. */
    newCode(): string;
    state(): PairingState;
    isLocked(): boolean;
    /** True when a fresh code should be minted (consumed or expired, not locked). */
    needsRefresh(): boolean;
    /** Operator-side re-arm: clears the lockout. */
    rearm(): void;
    /** Constant-time code comparison. Never reveals how close a guess was. */
    private matches;
    /**
     * Exchange a presented code for a session token. Fails closed and never
     * distinguishes "wrong code" from "expired" beyond the honest reason text.
     */
    exchange(presented: string): ExchangeResult;
}
/** Render the operator-facing instructions for the console banner. */
export declare function pairingInstructions(code: string): string;
