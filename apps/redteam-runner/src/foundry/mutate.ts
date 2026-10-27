/**
 * Evolution — operators-v1, in-app port (reference: evolution.py).
 *
 * Deterministic, label-preserving transforms. Every operator verifies its
 * anchors and FAILS LOUD on a miss — a mutant that cannot be built exactly
 * as specified is not built (the loop records the failure and moves on).
 *
 * Two surfaces, mirroring the reference's two corpora:
 *   - case operators transform a store live case's pattern fields
 *     (marker-rotate → payload-class rotation, rename-param, rename-route,
 *     reskin, naive-filter → the family's filter-bypass payload class);
 *   - bundle operators transform a snapshot bundle's files (marker-rotate
 *     with a fresh FNDRY token derived from sha256(seed:cycle:operator),
 *     rename-param, rename-route, and naive-filter — a per-class naive
 *     blacklist inserted IDENTICALLY into both twins, with the probe
 *     upgraded to the bypassing payload, twin integrity preserved).
 */

import { createHash } from 'node:crypto'
import type { CasePattern, FoundryCase } from './store.js'
import { caseContentHash } from './store.js'
import { sanitizePattern } from './sanitize.js'

/** The operator set, in the reference's order. */
export const OPERATORS = ['marker-rotate', 'rename-param', 'rename-route', 'reskin', 'naive-filter'] as const
export type Operator = (typeof OPERATORS)[number]

/** An operator outcome: the transformed value, or the loud failure. */
export type OpOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

export function pick<T>(options: readonly T[], seedKey: string, exclude?: T): T {
  const digest = createHash('sha256').update(seedKey, 'utf8').digest()
  const start = (digest[0] ?? 0) % options.length
  for (let i = 0; i < options.length; i++) {
    const candidate = options[(start + i) % options.length]
    if (candidate !== undefined && candidate !== exclude) return candidate
  }
  const first = options[0]
  if (first === undefined) throw new Error('pick requires a non-empty option list')
  return first
}

export const PARAM_NAMES = ['q', 'query', 'id', 'term', 'input', 'name', 'search'] as const
export const ROUTE_SYNONYMS: Record<string, string> = {
  search: 'lookup',
  lookup: 'search',
  preview: 'view',
  view: 'preview',
  download: 'fetch',
  fetch: 'download',
  file: 'document',
  document: 'file',
  products: 'items',
  items: 'products',
}
const STACKS = ['custom', 'wordpress', 'django', 'rails', 'express', 'laravel'] as const

const PAYLOAD_ROTATION: Record<string, readonly string[]> = {
  sqli: ['tautology-quote', 'tautology-numeric', 'union-select', 'comment-terminated'],
  xss: ['script-tag', 'svg-onload', 'event-handler'],
  traversal: ['dotdot-slash', 'dotdot-double', 'dotdot-encoded'],
  ssrf: ['loopback-literal', 'loopback-hostname', 'metadata-ip'],
}
const NAIVE_BYPASS: Record<string, string> = {
  'tautology-quote': 'tautology-numeric-comment',
  'script-tag': 'svg-onload',
  'dotdot-slash': 'dotdot-double',
  'loopback-literal': 'loopback-hostname',
}

/**
 * Apply one operator to a store case's pattern.
 *
 * @param seed - the seed case
 * @param operator - the operator to apply
 * @param cycle - the loop cycle number (deterministic variation input)
 * @returns the mutant pattern, or the loud failure
 */
export function applyCaseOperator(seed: FoundryCase, operator: Operator, cycle: number): OpOutcome<CasePattern> {
  const base: CasePattern = {
    family: seed.family,
    vulnClass: seed.vulnClass,
    cwe: seed.cwe,
    severity: seed.severity,
    endpointShape: [...seed.endpointShape],
    methodMix: [...seed.methodMix],
    payloadClass: seed.payloadClass,
    proofType: seed.proofType,
    techFingerprints: [...seed.techFingerprints],
  }
  const key = `${seed.id}:${operator}:${cycle}`
  switch (operator) {
    case 'marker-rotate': {
      const rotation = PAYLOAD_ROTATION[seed.family]
      if (!rotation) return { ok: false, error: `no payload rotation for family ${seed.family}` }
      const index = rotation.indexOf(base.payloadClass)
      if (index < 0) return { ok: false, error: `payload class ${base.payloadClass} not in the ${seed.family} rotation` }
      const nextClass = rotation[(index + 1) % rotation.length]
      if (nextClass === undefined) return { ok: false, error: 'payload rotation is empty' }
      base.payloadClass = nextClass
      return { ok: true, value: base }
    }
    case 'rename-param': {
      const shapeIndex = base.endpointShape.findIndex(s => s.includes('?'))
      if (shapeIndex < 0) return { ok: false, error: 'no parameterized endpoint shape to rename' }
      const shape = base.endpointShape[shapeIndex]
      if (shape === undefined) return { ok: false, error: 'endpoint shape index out of range' }
      const qIndex = shape.indexOf('?')
      const params = shape.slice(qIndex + 1).split('&').map(p => p.split('=')[0] ?? '')
      const first = params[0]
      if (first === undefined) return { ok: false, error: 'no parameter to rename' }
      const next = pick(PARAM_NAMES, key, first)
      base.endpointShape[shapeIndex] = shape.slice(0, qIndex + 1) + shape.slice(qIndex + 1).replace(`${first}=`, `${next}=`)
      return { ok: true, value: base }
    }
    case 'rename-route': {
      const shapeIndex = base.endpointShape.findIndex(s => s.split('/').some(seg => seg in ROUTE_SYNONYMS))
      if (shapeIndex < 0) return { ok: false, error: 'no renamable route segment in any endpoint shape' }
      const shape = base.endpointShape[shapeIndex]
      if (shape === undefined) return { ok: false, error: 'endpoint shape index out of range' }
      const segments = shape.split('/')
      const segIndex = segments.findIndex(seg => seg in ROUTE_SYNONYMS)
      const segment = segments[segIndex]
      const synonym = segment !== undefined ? ROUTE_SYNONYMS[segment] : undefined
      if (segment === undefined || synonym === undefined) return { ok: false, error: 'route segment has no synonym' }
      segments[segIndex] = synonym
      base.endpointShape[shapeIndex] = segments.join('/')
      return { ok: true, value: base }
    }
    case 'reskin': {
      if (base.techFingerprints.length === 0) return { ok: false, error: 'no stack fingerprint to reskin' }
      base.techFingerprints[0] = pick(STACKS, key, base.techFingerprints[0])
      return { ok: true, value: base }
    }
    case 'naive-filter': {
      const bypass = NAIVE_BYPASS[base.payloadClass]
      if (!bypass) return { ok: false, error: `no naive-filter bypass for payload class ${base.payloadClass}` }
      base.payloadClass = bypass
      return { ok: true, value: base }
    }
  }
}

/**
 * The case-mutant control battery (prove-v2 philosophy, case surface):
 * structure, sanitizer, family-aware dedup, determinism. A control failure
 * rejects the mutant; nothing is repaired.
 *
 * @param mutant - the mutant case to validate
 * @param existing - every case already in the store
 * @param rederive - rebuilds the mutant from its seed; must hash identically
 * @returns pass/fail plus per-control notes
 */
export function validateCaseMutant(
  mutant: FoundryCase,
  existing: readonly FoundryCase[],
  rederive: () => FoundryCase | null,
): { pass: boolean; notes: string[] } {
  const notes: string[] = []
  let pass = true
  // structure
  const required: Array<keyof FoundryCase> = ['id', 'family', 'vulnClass', 'severity', 'payloadClass', 'proofType', 'tier', 'contentHash']
  for (const field of required) {
    if (mutant[field] === undefined || mutant[field] === null || mutant[field] === '') {
      pass = false
      notes.push(`structure: missing ${field}`)
    }
  }
  // sanitizer (fail-closed re-scan of the pattern)
  const pattern: CasePattern = {
    family: mutant.family,
    vulnClass: mutant.vulnClass,
    cwe: mutant.cwe,
    severity: mutant.severity,
    endpointShape: mutant.endpointShape,
    methodMix: mutant.methodMix,
    payloadClass: mutant.payloadClass,
    proofType: mutant.proofType,
    techFingerprints: mutant.techFingerprints,
  }
  const sanitized = sanitizePattern(pattern)
  if (!sanitized.ok) {
    pass = false
    notes.push(`sanitizer: ${sanitized.reasons.join(', ')}`)
  }
  // family-aware dedup: hash collision with ANY case fails; a fingerprint
  // collision inside the family passes with a note; across families fails.
  const fingerprint = (c: FoundryCase): string =>
    [c.vulnClass, c.cwe ?? '', c.endpointShape.join(','), c.payloadClass].join('|')
  for (const other of existing) {
    if (other.id === mutant.id) continue
    if (other.contentHash === mutant.contentHash) {
      pass = false
      notes.push(`dedup: content hash collides with ${other.id}`)
    } else if (fingerprint(other) === fingerprint(mutant)) {
      if (other.family !== mutant.family) {
        pass = false
        notes.push(`dedup: fingerprint collides across families (${other.id})`)
      } else {
        notes.push(`dedup: fingerprint shared with ${other.id} inside the family (allowed)`)
      }
    }
  }
  // determinism
  const again = rederive()
  if (!again || again.contentHash !== mutant.contentHash || caseContentHash(pattern) !== mutant.contentHash) {
    pass = false
    notes.push('determinism: re-derivation does not reproduce the mutant hash')
  }
  return { pass, notes }
}
