/**
 * Harness contracts — imported from the REAL packages, not a structural mirror.
 *
 * Verified 2026-10-01 against the installed deepseek-harness release
 * (@deepseek-ai/dsh 0.2.0-rc.2) and its published type packages:
 *   - Context            from '@deepseek-ai/cordis'
 *   - PreToolDecision    from '@deepseek-ai/dsh-tools'  ({kind:'allow'} | {kind:'deny',reason} | {kind:'ask',reason?})
 *   - ToolExecution      from '@deepseek-ai/dsh-tools'  (fields: name, arguments, callId, signal, agent, token, ...)
 *
 * These are peerDependencies of this plugin: the harness host provides them
 * at load time. devDependencies pin the same versions for standalone
 * typecheck/build.
 */
export {};
