/**
 * Reflector: a bounded reflection step for agentLoop (runner corrections
 * Item 7, 2026-10-31). Written in turn-integrity.ts's style: a small
 * stateful class, no I/O beyond the injected model call.
 *
 * After a tool batch settles, a stuck batch may spend one REFLECTION — a
 * tool-less model call through the same completion seam the loop already
 * uses — which answers a structured verdict (continue / change_approach /
 * escalate) whose steering text is injected as the next user message. It
 * is not a new agent and not a roster member: it is the performer pausing
 * to think, with a hard budget.
 *
 * Cap semantics: the count lives on the instance, one per agentLoop
 * invocation (loop-local, like TurnIntegrity) — the cap is per phase run,
 * not per engagement. Exhausting the cap stops further reflection and
 * NEVER halts the engagement; it is announced exactly once
 * (`reflector_exhausted`), and every spent reflection is itself an event
 * (`reflector`, with trigger, verdict, count) — model-visible ⟺ logged.
 */
import type { Ctx } from './context.js'
import type { EngagementPhase } from './types.js'
import { extractJsonBlock } from './util.js'

/** Directive default: at most 3 reflections per agentLoop invocation. */
export const DEFAULT_REFLECTOR_CAP = 3

/**
 * A denied streak at or past this is a wall — the same threshold
 * agentLoop's redirect block uses. A batch ending in a wall is a stuck
 * batch even if an earlier call in it succeeded.
 */
export const REFLECTOR_WALL_STREAK = 4

/** What one settled tool batch did, as the loop's bookkeeping saw it. */
export interface BatchOutcome {
  /** Tool calls that settled in the batch. */
  calls: number
  /** Results that advanced the work (not blocked, not ok === false). */
  successes: number
  /** Results refused, blocked, cooled down, or OPSEC-signaled. */
  denied: number
  /** The engagement's consecutive-denied streak after the batch. */
  deniedStreak: number
}

export type ReflectionTrigger = 'zero_progress' | 'denied_streak'

/** One spent reflection: what fired it, what the model answered. */
export interface Reflection {
  trigger: ReflectionTrigger
  /** continue | change_approach | escalate | unparsed | error */
  verdict: string
  /** The steering text injected as the next user message. */
  steering: string
  /** Reflections spent so far, including this one. */
  count: number
  /** The cap this loop is running under. */
  cap: number
}

/** The injected model call: prompt in, raw model text out. */
export type ReflectionAsk = (prompt: string) => Promise<string>

/**
 * Whether a settled batch is stuck, and why. A batch that made progress
 * below the wall threshold is not stuck; a batch with no calls at all
 * never reaches the reflector.
 */
export function reflectionTrigger(outcome: BatchOutcome): ReflectionTrigger | null {
  if (outcome.calls === 0) return null
  if (outcome.deniedStreak >= REFLECTOR_WALL_STREAK) return 'denied_streak'
  if (outcome.successes === 0) return 'zero_progress'
  return null
}

/** Fresh assembly naming the stuck state; the model answers JSON only. */
export function buildReflectionPrompt(role: string, phase: EngagementPhase, outcome: BatchOutcome, trigger: ReflectionTrigger): string {
  const shape =
    trigger === 'denied_streak'
      ? `the batch ended in a wall: ${outcome.deniedStreak} consecutive probes denied, blocked, cooled down, or OPSEC-signaled`
      : 'the batch made no progress at all: every call was denied, blocked, or failed'
  return (
    `REFLECTION — you are the ${role} in the ${phase} phase, and ${shape}. ` +
    `Batch totals: ${outcome.calls} call(s), ${outcome.successes} succeeded, ${outcome.denied} denied/blocked. ` +
    'Stop and think before the next batch: what is the wall made of, what assumption is failing, ' +
    'and what is the single most promising different move? ' +
    'Answer with a JSON object only: {"verdict": "continue" | "change_approach" | "escalate", ' +
    '"steering": "<one short paragraph: the concrete next move, in your own words>"}'
  )
}

/**
 * Read the model's answer. A JSON object with a steering string keeps its
 * verdict; anything else is carried verbatim as steering with verdict
 * "unparsed" — the reflection still counts, and the transcript shows what
 * the model actually said.
 */
export function parseReflection(raw: string): { verdict: string; steering: string } {
  const parsed = extractJsonBlock(raw)
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const rec = parsed as Record<string, unknown>
    if (typeof rec['steering'] === 'string' && rec['steering'].trim() !== '') {
      const v = rec['verdict']
      const verdict = v === 'continue' || v === 'change_approach' || v === 'escalate' ? v : 'unparsed'
      return { verdict, steering: rec['steering'].trim() }
    }
  }
  return { verdict: 'unparsed', steering: raw.trim() }
}

export class Reflector {
  private spent = 0
  private exhaustedAnnounced = false
  /** The cap in force; a fixture that never resolved config gets the default. */
  readonly cap: number

  constructor(
    private readonly ctx: Ctx,
    private readonly phase: EngagementPhase,
    cap: number | undefined,
  ) {
    this.cap = cap ?? DEFAULT_REFLECTOR_CAP
  }

  /** Reflections spent so far in this loop invocation. */
  get reflectionsSpent(): number {
    return this.spent
  }

  /**
   * Spend one reflection on a stuck batch, or return null when the batch
   * is not stuck, reflection is disabled (cap 0), or the cap is spent.
   * A failed model call is spent and logged (verdict "error") but returns
   * null: reflection is advisory and must never halt the engagement, and
   * the mechanical redirect stays available for the same batch.
   */
  async maybeReflect(role: string, outcome: BatchOutcome, ask: ReflectionAsk): Promise<Reflection | null> {
    if (this.cap <= 0) return null
    const trigger = reflectionTrigger(outcome)
    if (trigger === null) return null
    if (this.spent >= this.cap) {
      if (!this.exhaustedAnnounced) {
        this.exhaustedAnnounced = true
        this.ctx.events.append({
          phase: this.phase,
          actor: 'runner',
          action: 'reflector_exhausted',
          result:
            `reflector_exhausted: the reflection cap (${this.cap}) for this loop is spent; ` +
            'further stuck batches proceed without reflection. The engagement is NOT halted.',
        })
      }
      return null
    }
    this.spent++
    let verdict: string
    let steering: string
    try {
      const raw = await ask(buildReflectionPrompt(role, this.phase, outcome, trigger));
      ({ verdict, steering } = parseReflection(raw))
    } catch (err) {
      this.ctx.events.append({
        phase: this.phase,
        actor: 'runner',
        action: 'reflector',
        result: `reflector (${this.spent}/${this.cap}) trigger=${trigger} verdict=error: reflection call failed: ${(err as Error).message}`,
      })
      return null
    }
    this.ctx.events.append({
      phase: this.phase,
      actor: 'runner',
      action: 'reflector',
      result: `reflector (${this.spent}/${this.cap}) trigger=${trigger} verdict=${verdict}: ${steering.slice(0, 300)}`,
    })
    return { trigger, verdict, steering, count: this.spent, cap: this.cap }
  }
}
