/**
 * Q-REPORT-DETAIL — the fixed tables behind report/detail.ts (spec
 * §§4–7): severity order and anchored deduction weights, the arm →
 * risk-area and arm → pillar maps, pillar definitions, the family
 * classification for engine findings, and the impact clauses. Data
 * and lookups only; derivations live in detail.ts + detail-blocks.ts.
 */
import type { DetailFindingInput, DetailSeverity, DetailTier } from './detail.js'

/** Severity order, worst first — the rank drives every sort below. */
export const SEVERITY_ORDER: readonly DetailSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
]

export const SEVERITY_RANK: Record<DetailSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

/** The anchored engine's deduction weights (report/grading.ts):
 * the order in which fixing findings recovers the grade. */
export const DEDUCTION_WEIGHT: Record<DetailSeverity, number> = {
  critical: 35,
  high: 25,
  medium: 15,
  low: 5,
  info: 0,
}

/** Grade-cap clauses (§3 line 2), from grading.ts's documented math. */
export const ANCHOR_CLAUSE: Partial<Record<DetailSeverity, string>> = {
  critical: 'one confirmed critical caps the score at 20',
  high: 'one confirmed high caps the score at 45',
}

/** Recorded source labels normalize to one token form: lowercase,
 * `-`/space runs collapse to single underscores (B's inventory rule). */
export function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Label spellings that name a canonical arm indirectly. */
const ARM_ALIASES: Record<string, string> = {
  bola_idor: 'bola',
  api_sec: 'api',
  webhook_signature: 'webhook',
  redteam_probe: 'redteam',
}

/** §4.2 — arm → key risk area. Keys are exactly the 21 battery arms. */
export const ARM_AREA: Record<string, string> = {
  bola: 'API & Object Access',
  api: 'API & Object Access',
  webhook: 'API & Object Access',
  csrf: 'Browser Injection & Session Integrity',
  dom_xss: 'Browser Injection & Session Integrity',
  stored_xss: 'Browser Injection & Session Integrity',
  aggressive_ssti: 'Server-Side Injection & Code Execution',
  aggressive_nosql: 'Server-Side Injection & Code Execution',
  aggressive_xxe: 'Server-Side Injection & Code Execution',
  aggressive_crlf: 'Server-Side Injection & Code Execution',
  aggressive_host_header: 'Server-Side Injection & Code Execution',
  deserialization: 'Server-Side Injection & Code Execution',
  prototype_pollution: 'Server-Side Injection & Code Execution',
  auth_rate_limit: 'Authentication & Session',
  weak_session: 'Authentication & Session',
  price_manipulation: 'Business Logic',
  credential_chain: 'Credential & Secret Exposure',
  edge_function: 'Platform, Edge & AI Surface',
  i18n: 'Platform, Edge & AI Surface',
  llm: 'Platform, Edge & AI Surface',
  redteam: 'Red Team — Chained Exploitation',
}

/** §7.1 — arm → its ONE primary pillar (no double counting). */
export const ARM_PILLAR: Record<string, string> = {
  bola: 'API SEC',
  api: 'API SEC',
  webhook: 'API SEC',
  csrf: 'DAST',
  dom_xss: 'DAST',
  stored_xss: 'DAST',
  deserialization: 'DAST',
  prototype_pollution: 'DAST',
  price_manipulation: 'DAST',
  auth_rate_limit: 'DAST',
  weak_session: 'DAST',
  i18n: 'DAST',
  edge_function: 'DAST',
  llm: 'DAST',
  redteam: 'RED TEAM',
  credential_chain: 'RED TEAM',
  aggressive_ssti: 'RED TEAM',
  aggressive_nosql: 'RED TEAM',
  aggressive_xxe: 'RED TEAM',
  aggressive_crlf: 'RED TEAM',
  aggressive_host_header: 'RED TEAM',
}

/** The 21-arm universe in §7.1 listing order (§8.2's "of 21 arms"). */
export const ARM_UNIVERSE: readonly string[] = [
  'bola', 'api', 'webhook',
  'csrf', 'dom_xss', 'stored_xss', 'deserialization', 'prototype_pollution',
  'price_manipulation', 'auth_rate_limit', 'weak_session', 'i18n',
  'edge_function', 'llm',
  'redteam', 'credential_chain', 'aggressive_ssti', 'aggressive_nosql',
  'aggressive_xxe', 'aggressive_crlf', 'aggressive_host_header',
]

/** The normalized label of the SecScan engine pseudo-arm. */
export const ENGINE_ARM = 'secscan_engine'

/** The canonical arm a recorded source label names, or null when the
 * label is not an arm (an engine category, or an unknown token —
 * detail.ts decides which, and fails loud on the latter). */
export function armOf(rawLabel: string): string | null {
  const n = normalizeLabel(rawLabel)
  const arm = ARM_ALIASES[n] ?? n
  return Object.prototype.hasOwnProperty.call(ARM_AREA, arm) ? arm : null
}

export interface PillarDef {
  name: string
  scopeLabel: string
  arms: readonly string[]
  /** Set only for the pillars that have no arm at all (§7.1). */
  noArmReason?: string
}

const DAST_ARMS: readonly string[] = [
  'csrf', 'dom_xss', 'stored_xss', 'deserialization', 'prototype_pollution',
  'price_manipulation', 'auth_rate_limit', 'weak_session', 'i18n',
  'edge_function', 'llm',
]

const RED_TEAM_ARMS: readonly string[] = [
  'redteam', 'credential_chain', 'aggressive_ssti', 'aggressive_nosql',
  'aggressive_xxe', 'aggressive_crlf', 'aggressive_host_header',
]

/** §7 — the seven pillar cards, in the reference's fixed order. */
export const PILLARS: readonly PillarDef[] = [
  {
    name: 'SAST', scopeLabel: 'Static Analysis', arms: [],
    noArmReason: 'The product performs no source-code analysis.',
  },
  { name: 'DAST', scopeLabel: 'Dynamic Audit', arms: DAST_ARMS },
  {
    name: 'IAST', scopeLabel: 'Interactive Policies', arms: [],
    noArmReason: "No instrumentation agent exists in the target's runtime.",
  },
  {
    name: 'SCA', scopeLabel: 'Composition Review', arms: [],
    noArmReason:
      'Technology and version detection in recon is fingerprinting, not ' +
      'composition analysis; CVE/EPSS matching lives in monitoring, not ' +
      'in the engagement battery.',
  },
  { name: 'EASM', scopeLabel: 'Attack Surface', arms: [] },
  { name: 'API SEC', scopeLabel: 'API Security Testing', arms: ['bola', 'api', 'webhook'] },
  { name: 'RED TEAM', scopeLabel: 'Red Team Active Probes', arms: RED_TEAM_ARMS },
]

/** §4.3 family classes for engine findings and unlisted sources. */
export type FamilyClass = 'headers' | 'exposure' | 'transport' | 'auth'

export const FAMILY_AREA: Record<FamilyClass, string> = {
  headers: 'Security Headers & Configuration',
  exposure: 'Information Exposure',
  transport: 'Transport Security',
  auth: 'Authentication & Session',
}

/**
 * The §4.3 family a finding's recorded signals identify, evaluated in
 * the table's order: CWE/WSTG refs from `signals` + `attackIds`, plus
 * the SecScan engine's own category names carried in the source label.
 * Returns null when no family signal is present.
 */
export function familyClass(input: {
  sourceLabel: string
  signals: readonly string[]
  attackIds: readonly string[]
}): FamilyClass | null {
  const refs = [...input.signals, ...input.attackIds].map(s =>
    s.toUpperCase().replace(/[\s_]+/g, '-'),
  )
  const label = input.sourceLabel.toLowerCase()
  if (
    refs.some(r => r === 'CWE-79' || r === 'CWE-113' || r === 'WSTG-CONF-12') ||
    label.includes('injection defense')
  ) {
    return 'headers'
  }
  if (
    refs.some(r => r === 'CWE-200' || r.startsWith('WSTG-INFO')) ||
    label.includes('information disclosure') ||
    label.includes('information exposure')
  ) {
    return 'exposure'
  }
  if (
    refs.some(r => r === 'WSTG-CONF-01' || r.includes('TLS') || r.includes('CERT')) ||
    label.includes('transport security') ||
    label.includes('certificate')
  ) {
    return 'transport'
  }
  if (
    refs.some(r => r.startsWith('WSTG-SESS') || r.startsWith('WSTG-ATHN')) ||
    label.includes('session') ||
    label.includes('authentication')
  ) {
    return 'auth'
  }
  return null
}

/** §5 — the fixed business-impact clause per risk area. Text states
 * only what findings in the area mechanically imply; nothing else
 * may render in the impact band. */
export const AREA_IMPACT: Record<string, string> = {
  'API & Object Access':
    'Per-user data can be reached across account boundaries, which is a ' +
    'direct confidentiality breach for the users whose objects are exposed.',
  'Credential & Secret Exposure':
    'Exposed credentials or secrets can be replayed until rotated; ' +
    'rotation, not just removal, is part of the fix.',
  'Server-Side Injection & Code Execution':
    'Attacker input reaches server-side interpreters, the usual path ' +
    'from a probe to code execution.',
  'Browser Injection & Session Integrity':
    "Content or session material can be manipulated in a victim's " +
    "browser under the site's own origin.",
  'Authentication & Session':
    'The login and session surface accepts more attempts, or holds ' +
    'sessions longer, than the policy intends.',
  'Business Logic':
    "The application's own rules can be turned against it (pricing, " +
    'workflow, or quota manipulation) without breaking any technical control.',
  'Platform, Edge & AI Surface':
    "Edge, locale, or AI-facing behaviour diverges from the application's " +
    'stated policy in ways an attacker can select deliberately.',
  'Red Team — Chained Exploitation':
    'Individually minor weaknesses chain into a working attack path.',
  'Security Headers & Configuration':
    "Browser-enforced protections are weaker than the application's " +
    'content requires.',
  'Information Exposure':
    'The application discloses structure or paths that shorten an ' +
    "attacker's reconnaissance.",
  'Transport Security':
    'Traffic to or from the application is less protected in transit ' +
    'than the deployment intends.',
  'General':
    'The confirmed weakness is documented with its evidence under Findings.',
}

/** Signed delta rendering for the detail strings (+4 / −1 / 0). */
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

/** Singular/plural pick for the fixed template strings. */
export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** F-id order: numeric suffix ascending (F-2 before F-10). */
export function compareIds(a: string, b: string): number {
  const ma = /^(.*?)(\d+)$/.exec(a)
  const mb = /^(.*?)(\d+)$/.exec(b)
  if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2])
  return a < b ? -1 : a > b ? 1 : 0
}

/** Severity rank, then F-id — the member order inside area cards. */
export const byRankThenId = (a: DetailFindingInput, b: DetailFindingInput): number =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || compareIds(a.id, b.id)

/** §6.1 tier order: PROVEN ranks before CONFIRMED. */
export const TIER_RANK: Record<DetailTier, number> = { proven: 0, confirmed: 1, deferred: 2 }

/** Actionable = a finding of record (PROVEN or CONFIRMED tier). */
export const isActionable = (f: DetailFindingInput): boolean => f.tier !== 'deferred'

/** Fail-loud lookup: a derivation missing its input throws, so the
 * report degrades whole rather than rendering a partial derivation. */
export function req<V>(v: V | undefined, what: string): V {
  if (v === undefined) throw new Error(`report detail: missing ${what}`)
  return v
}
