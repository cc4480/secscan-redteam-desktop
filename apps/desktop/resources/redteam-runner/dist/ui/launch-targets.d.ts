/**
 * Clean a target as typed in conversation: trim, drop surrounding quotes,
 * and strip trailing sentence punctuation. A target typed at the end of a
 * sentence carries its punctuation with it — the keeper's first console
 * launch (eng-2026-10-28-df5a1c0d) took "https://secscan.us," verbatim and
 * the comma became part of the host the scope check saw. Inner characters
 * are never touched: a port or path keeps its punctuation.
 *
 * @param raw - The target exactly as given.
 * @returns The cleaned target.
 */
export declare function cleanTarget(raw: string): string;
/**
 * The host a cleaned target names — the default single-host scope.
 *
 * @param cleaned - A target after {@link cleanTarget}.
 * @returns The hostname, or null when no host can be read from the target.
 */
export declare function targetHost(cleaned: string): string | null;
/**
 * Build the launch request an engagement_launch call hands to the launch
 * handler: cleaned target, red mode unless black was asked for, scope
 * defaulted to the target's host, and a named operator on the record; a
 * named sibling command stamps its registry tier/targets/phases (S2-H2).
 *
 * The operator name matters beyond bookkeeping: authorizePhase attests
 * ownership from the engagement record (operatorName ?? client), so a launch
 * that names neither is REFUSED rather than recorded under a placeholder —
 * the record must carry a real attestation or none at all.
 *
 * @param a - The tool arguments as the agent supplied them.
 * @returns The launch request, or the error the caller should be told.
 */
/**
 * The operator identity a launch records when the caller named nobody.
 * @returns A real identity — REDTEAM_OPERATOR, else the OS account — or undefined.
 */
export declare function resolveLaunchOperator(env?: NodeJS.ProcessEnv): string | undefined;
