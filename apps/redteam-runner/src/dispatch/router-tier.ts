/**
 * Mid-run tier refresh: re-read tier.json so an operator escalation
 * takes effect without restarting the engagement (split from router.ts).
 */
import { type Ctx } from '../context.js'
import { type EngagementPhase } from '../types.js'
import { readTierFile, TIER_NAMES } from '../accountability/index.js'

/**
 * v0.24.0: mid-run tier changes. The operator may raise/lower the tier via
 * `redteam-runner escalate` or the UI; both rewrite tier.json in the
 * engagement dir (atomically). The dispatcher re-reads it before every tier
 * check so the new tier takes effect without restarting the engagement.
 * The change lands in the audit log — never silent. A missing or corrupt
 * file means "no change". Exported for tests; dispatchTool calls it.
 */
export function refreshTierFromDisk(ctx: Ctx, phase: EngagementPhase): void {
  const tf = readTierFile(ctx.events.dir)
  if (!tf || tf.tier === ctx.tier.current) return
  const from = ctx.tier.current
  // Raising autonomy is a governance act, not a file write. Anything able to write
  // the engagement dir could otherwise edit tier.json and move the run from Tier 0
  // to Tier 2 with no approval, no direction check and no record of who asked.
  // Lowering autonomy is always safe, so only an upward change is gated.
  if (tf.tier > from) {
    // A context with no approval log cannot have approved anything: treat a
    // missing log as "not approved" rather than crashing the dispatch path.
    const approved = (ctx.approvals?.list?.() ?? []).some(
      a => a.kind === 'tier-escalation' && a.toTier === tf.tier,
    )
    if (!approved) {
      ctx.events.append({
        phase,
        actor: 'runner',
        action: 'tier_change_refused',
        result:
          `Tier change REFUSED: Tier ${from} (${TIER_NAMES[from]}) → Tier ${tf.tier} (${TIER_NAMES[tf.tier]})`
          + ' has no matching tier-escalation approval in approvals.jsonl'
          + `${tf.by ? ` (tier.json names ${tf.by})` : ''}`
          + '. Raising autonomy requires an operator approval; the run stays at its current tier.',
      })
      return
    }
  }
  ctx.tier.current = tf.tier
  ctx.events.append({
    phase,
    actor: 'runner',
    action: 'tier_changed',
    result:
      `Autonomy tier changed mid-run: Tier ${from} (${TIER_NAMES[from]}) → Tier ${tf.tier} (${TIER_NAMES[tf.tier]})`
      + `${tf.by ? ` by ${tf.by}` : ''}${tf.reason ? ` — ${tf.reason}` : ''}. `
      + (tf.tier > from
        ? 'Picked up from tier.json against a matching operator approval in approvals.jsonl. No restart needed.'
        : 'Picked up from tier.json (a lower tier needs no approval). No restart needed.'),
  })
}
