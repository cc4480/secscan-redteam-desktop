/**
 * Engagement identity and scope types — extracted from types.ts to keep the
 * core type module under the 300-line budget. Pure declarations; the barrel
 * re-exports them so every existing import path is unchanged.
 */

export type EngagementMode = 'red' | 'black'

import type { TargetId } from './targets/types.js'
import type { AutonomyTier } from './accountability/tiers.js'

export type EngagementPhase =
  | 'authorize'
  | 'plan'
  | 'recon'
  | 'exploit'
  | 'report'
  | 'done'
  | 'blocked'
  | 'halted'

export type EngagementStatus =
  | 'queued'
  | 'authorizing'
  | 'running'
  | 'complete'
  | 'blocked'
  | 'halted'

export type ActorRole = 'coordinator' | 'recon' | 'exploiter' | 'reporter' | 'architect' | 'runner' | 'publisher'

/** Daily blackout window, 24h "HH:MM" strings. May cross midnight. */
export interface BlackoutWindow {
  start: string // "02:00"
  end: string // "04:30"
  /** IANA timezone, e.g. "America/Chicago". Defaults to the runner's local tz. */
  tz?: string
}

/**
 * Rules of Engagement — the contract that bounds every action the runner takes.
 * Mirrors engagements/engagement-template.md §1–§3.
 */
export interface RulesOfEngagement {
  /**
   * In-scope hosts, URLs, IPs or CIDRs. Nothing else is ever touched.
   * Membership is decided by the scope guard (safety/scope-guard.ts):
   * exact host, subdomain of a listed domain, listed IP, or CIDR member.
   */
  scope: string[]
  /**
   * Out-of-scope hosts/IPs/CIDRs that must never be touched, even when
   * they fall inside `scope` (e.g. a third-party subdomain of an in-scope
   * domain). Enforced by the scope guard at dispatch; deny beats allow.
   */
  outOfScope?: string[]
  /** ATT&CK technique IDs the engagement must not use, e.g. ["T1110"]. null/omitted = none beyond the mode defaults. */
  excludedTechniques?: string[] | null
  /** Daily windows during which the runner pauses (no traffic). */
  blackoutWindows?: BlackoutWindow[]
  /** Stop conditions, e.g. ["production outage", "WAF hard-block", "scope crossing"]. */
  stopConditions?: string[]
  /** Who to contact on the client side if something goes wrong. */
  deconflictionContact?: string
  /** ISO timestamps bounding the test. The runner refuses to run outside it. */
  testWindow?: { start: string; end: string }
  /** Free-text notes (provided creds reference, out-of-scope remarks…). Never paste secrets. */
  notes?: string
}

export interface EngagementInput {
  /** Target domain or URL, e.g. "secscan.us" or "https://secscan.us". */
  target: string
  mode: EngagementMode
  /** What the client wants proven, e.g. "assess external attack surface". */
  objective: string
  roe: RulesOfEngagement
  client?: string
  /** Named human operator accountable for the engagement (attestation + evidence pack). */
  operatorName?: string
  /**
   * Full-battery unified engagement (target-specific batteries as ONE
   * operation). The coordinator prompt carries the selected target batteries
   * as the plan skeleton; coverage requires all 3 categories × every
   * selected target (or the cell honestly BLOCKED).
   * Set via --full-battery or --target secscan+seclayer.
   */
  fullBattery?: boolean
  /**
   * Local-host engagement (Q-RP-11): the target is the machine the app
   * itself runs on (target = os.hostname(), scope = [hostname]). The
   * collector runs ON-HOST during recon — no network services, no test
   * credentials — and writes host-inventory.json into the engagement
   * dir for the report's inventory sections. Set by /pcscan and by the
   * chat surface's engagement_launch_local; never for a remote target.
   */
  localHost?: boolean
  /**
   * Subset of full-battery targets, set via --targets (comma-separated).
   * Defaults to all four (secscan, seclayer, windows, linux).
   */
  targets?: TargetId[]
  /**
   * Test environment for staging→production graduation (v0.13.0 safety case).
   * "staging" (default): full battery, configured rate limits. "production":
   * requires explicit operator confirmation (confirmProduction or
   * REDTEAM_PROD_CONFIRM=1) and caps the per-host rate limit mechanically.
   * Set via --env staging|production.
   */
  environment?: 'staging' | 'production'
  /**
   * Explicit operator confirmation for a production run. The runner refuses
   * to start a production engagement without it — fail fast, before any
   * packet. Set via --confirm-production.
   */
  confirmProduction?: boolean
  /**
   * Autonomy tier (v0.17.0 accountability): 0 = observe (read-only recon),
   * 1 = validate (single-step validated exploitation, one step per target),
   * 2 = chain (multi-step attack chains, still non-destructive, no-DoS).
   * Enforced mechanically in the tool dispatcher — not by prompt.
   * Unset → environment default (staging: 2, production: 1).
   * Set via --tier 0|1|2 (or REDTEAM_TIER).
   */
  tier?: AutonomyTier
  /**
   * Explicit operator approval for Tier 2 on production. The runner refuses
   * to start a Tier 2 production engagement without it — fail fast, before
   * any packet. Set via --confirm-tier2-production (or
   * REDTEAM_TIER2_PROD_CONFIRM=1).
   */
  confirmTier2Production?: boolean
  /**
   * How deep the verified access runs (L12): carried through authorize
   * into the fleet record's accessLevel (same value set as the record
   * type's). Unset → 'verified-domain' (authorize is the precondition)
   * — the value every run carried before this field existed.
   */
  accessLevel?: 'public' | 'verified-domain' | 'credentialed' | 'second-account' | 'oob-collector'
  /**
   * Whether a session may be opened mechanically after a proven
   * exploit (L12): carried through authorize into the fleet record's
   * sessionsAllowed. Unset → true; the SESSIONS knob still narrows it
   * at prompt assembly.
   */
  sessionsAllowed?: boolean
}

/** One streamed event. Written to events.jsonl as it happens. */
