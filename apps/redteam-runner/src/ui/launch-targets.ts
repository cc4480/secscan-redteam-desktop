/**
 * Launch-input resolution for the chat-shaped engagement tools: target
 * cleaning, host reading, and operator identity (split from
 * engagement-tools.ts — the 300-line budget).
 */
import { userInfo } from 'node:os'

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
export function cleanTarget(raw: string): string {
  let t = raw.trim().replace(/^["'`]+/, '')
  // Sentence punctuation and the closing quote travel together — `"…".` —
  // so strip both classes until the tail is stable, never just one pass.
  while (/[.,;:"'`]$/.test(t)) t = t.slice(0, -1)
  return t.trim()
}

/**
 * The host a cleaned target names — the default single-host scope.
 *
 * @param cleaned - A target after {@link cleanTarget}.
 * @returns The hostname, or null when no host can be read from the target.
 */
export function targetHost(cleaned: string): string | null {
  try {
    const host = new URL(cleaned).hostname
    if (host) return host
    // "secscan.us:8443" parses as a URL with scheme "secscan.us:" and an
    // empty host — fall through to the bare-host reading below.
  } catch {
    // Not a URL at all: also the bare-host reading below.
  }
  // A bare host ("secscan.us", optionally with a port) is a normal way to
  // name a target in chat.
  if (/^[A-Za-z0-9.-]+(:\d+)?$/.test(cleaned)) return cleaned.replace(/:\d+$/, '')
  return null
}

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
export function resolveLaunchOperator(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = (env['REDTEAM_OPERATOR'] ?? '').trim()
  if (configured) return configured
  try {
    return userInfo().username.trim() || undefined
  } catch {
    return undefined
  }
}
