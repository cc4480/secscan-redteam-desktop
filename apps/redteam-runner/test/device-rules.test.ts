/**
 * Per-device rules of engagement.
 *
 * The point of these rules is to say how hard the runner may push, not to forbid
 * the work. A template whose rules banned exploitation would ship a scanner too
 * timid to prove anything on that device, so the tests below check both halves:
 * every device states its posture, and no rule closes the door on exploiting it.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEVICE_ORDER, DEVICE_TEMPLATES } from '../src/device-templates/catalog.js'
import { DEVICE_RULES, renderDeviceRules } from '../src/device-templates/roe.js'
import { validateDeviceTemplates } from '../src/device-templates/validate.js'

describe('per-device rules of engagement', () => {
  it('every device class states aggression, proof and limits', () => {
    for (const id of DEVICE_ORDER) {
      const rules = DEVICE_RULES[id]
      assert.ok(rules, `${id} has no rules`)
      assert.ok(rules.aggression.length > 0, `${id} states no aggression`)
      assert.ok(rules.proof.length > 0, `${id} states no proof bar`)
      assert.ok(rules.limits.length > 0, `${id} states no limits`)
    }
  })

  it('no device rule forbids exploitation, or leaves the work untestable', () => {
    for (const id of DEVICE_ORDER) {
      const rules = DEVICE_RULES[id]
      const text = [...rules.aggression, ...rules.proof, ...rules.limits].join(' ')
      // The failure this guards: a rule that reads like a ban on the engagement's
      // whole purpose. "Do not exploit", "never exploit", "no exploitation".
      assert.doesNotMatch(text, /\b(never|do not|don't|no)\s+(exploit|exploitation|attack)\b/i,
        `${id} forbids exploitation outright`)
      // And the posture must actually be permissive: each class says what full
      // pressure looks like on it.
      assert.match(text, /in scope|full extent|aggression|chain|escalat/i,
        `${id} does not state what aggressive testing looks like`)
    }
  })

  it('the device templates validate against the catalogue, rules included', () => {
    const violations = validateDeviceTemplates(DEVICE_TEMPLATES)
    assert.deepEqual(violations, [], JSON.stringify(violations, null, 2))
  })

  it('renders a block an agent can act on', () => {
    const block = renderDeviceRules('windows')
    assert.match(block, /Rules of engagement — windows/)
    assert.match(block, /Aggression/)
    assert.match(block, /Proof that counts/)
    assert.match(block, /Limits/)
    // The mechanical limit that is not timidity stays visible.
    assert.match(block, /denial of service/i)
  })
})
