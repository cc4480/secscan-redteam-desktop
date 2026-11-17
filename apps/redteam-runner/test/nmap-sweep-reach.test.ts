/**
 * Sweep coverage under the enforced rate and host timeout.
 *
 * The failure this guards against is a claim, not a crash: a `full` profile that
 * cannot finish still returns a clean-looking result, and "no non-standard ports"
 * would then rest on ports that were never probed. The assertions pin the case
 * that actually occurred and the cases that must stay clear.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { findProfile } from '../src/nmap/policy.js'
import { sweepReach } from '../src/nmap/sweep-coverage.js'

describe('sweepReach', () => {
  it('reports the observed full-scan case as partial', () => {
    // The live engagement ran: -p- at --max-rate 5 with --host-timeout 300s.
    const reach = sweepReach(findProfile('full')!, 5, 300)
    assert.ok(reach)
    assert.equal(reach.requested, 65535)
    assert.equal(reach.reachable, 1500)
    assert.equal(reach.partial, true)
  })

  it('clears a narrow profile at the same rate and timeout', () => {
    for (const id of ['quick', 'service', 'default', 'udp', 'os'] as const) {
      const reach = sweepReach(findProfile(id)!, 5, 300)
      assert.ok(reach, id)
      assert.equal(reach.partial, false, `${id} fits inside 1500 probes`)
    }
  })

  it('clears the full profile once the rate can finish it', () => {
    const reach = sweepReach(findProfile('full')!, 300, 300)
    assert.ok(reach)
    assert.equal(reach.partial, false)
  })

  it('derives the request from the profile arguments, not a second table', () => {
    // If the profile table changes ports, the estimate follows it automatically.
    assert.equal(sweepReach(findProfile('service')!, 1, 1)?.requested, 200)
    assert.equal(sweepReach(findProfile('udp')!, 1, 1)?.requested, 50)
  })
})
