/**
 * Staging → production graduation (v0.13.0) — the production safety case.
 *
 * Buyers graduate testing: the full battery runs against staging freely;
 * production requires an explicit operator decision plus tighter limits.
 * This is MECHANICAL, not prompt-based:
 *
 *  - `staging` (default): full battery, configured rate limits.
 *  - `production`: requires explicit confirmation
 *    (REDTEAM_PROD_CONFIRM=1 or CLI --confirm-production) — without it the
 *    runner refuses to start, fail fast, before any packet. Production also
 *    caps the per-host rate limit at 2 rps even if configured higher.
 *
 * The manifest records the environment and whether confirmation was given,
 * so the compliance pack's safety section shows the graduation decision.
 */
export type TestEnvironment = "staging" | "production";
export declare const PROD_CONFIRM_ENV = "REDTEAM_PROD_CONFIRM";
export declare const ENV_SELECT_ENV = "REDTEAM_ENV";
/** Parse the environment from CLI/env; anything unknown fails closed to staging? No — fails LOUD. */
export declare function parseEnvironment(raw: string | undefined): TestEnvironment;
/** True when the operator explicitly confirmed a production run. */
export declare function productionConfirmed(env?: NodeJS.ProcessEnv): boolean;
/**
 * Mechanical graduation gate. Call before ANY active testing (the runner
 * calls it at engagement start, before the authorize phase). Production
 * without explicit confirmation is a hard refusal — the operator must type
 * the confirmation, not the agent.
 */
export declare function requireGraduation(environment: TestEnvironment, confirmed: boolean): void;
/** One-line description for the manifest and the engagement_start event. */
export declare function describeEnvironment(environment: TestEnvironment, confirmed: boolean): string;
