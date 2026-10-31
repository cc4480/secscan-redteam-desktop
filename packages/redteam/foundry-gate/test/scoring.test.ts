/**
 * Scoring math: discrimination curve, difficulty-fit bands, tier mapping,
 * and the weighted fitness formula checked against hand-computed values.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { attackSurface, detected, internalPath, tierFor } from '../src/panel.js'
import { computeFitness, difficultyFit, discrimination } from '../src/scoring.js'
import type { BundleSpec } from '../src/types.js'

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`)
}

describe('discrimination', () => {
  test('peaks at a 50% pass rate and vanishes at the extremes', () => {
    assert.equal(discrimination(0), 0)
    assert.equal(discrimination(0.25), 0.75)
    assert.equal(discrimination(0.5), 1)
    assert.equal(discrimination(0.75), 0.75)
    assert.equal(discrimination(1), 0)
  })
})

describe('difficultyFit', () => {
  test('is 1 inside the tier band', () => {
    assert.equal(difficultyFit(0.70, 1), 1)
    assert.equal(difficultyFit(0.75, 1), 1)
    assert.equal(difficultyFit(0.95, 1), 1)
    assert.equal(difficultyFit(0.5, 2), 1)
    assert.equal(difficultyFit(0.25, 3), 1)
  })

  test('falls off by distance outside the band', () => {
    close(difficultyFit(0.6, 1), 0.9)
    close(difficultyFit(0.97, 1), 0.98)
    close(difficultyFit(0.3, 2), 0.9)
    close(difficultyFit(0.05, 3), 0.95)
    close(difficultyFit(0, 1), 0.3)
  })
})

describe('tierFor', () => {
  test('maps pass rates to the Foundry bands', () => {
    assert.equal(tierFor(0.75), 1)
    assert.equal(tierFor(0.95), 1)
    assert.equal(tierFor(0.5), 2)
    assert.equal(tierFor(0.4), 2)
    assert.equal(tierFor(0.25), 3)
    assert.equal(tierFor(0.1), 3)
    assert.equal(tierFor(1), null)
    assert.equal(tierFor(0), null)
  })
})

describe('computeFitness', () => {
  test('reproduces the Foundry-issued fitness for the GOLD sqli bundle', () => {
    const score = computeFitness({
      passRate: 0.75,
      tier: 1,
      issued: {
        discrimination: 0.75,
        difficulty_fit: 1.0,
        novelty: 0.0,
        live_similarity: 0.6663,
        coverage_gain: 0.1429,
        cost_efficiency: 0.9431,
      },
      gatePass: true,
    })
    assert.equal(score.components.discrimination, 0.75)
    assert.equal(score.components.difficulty_fit, 1.0)
    assert.deepEqual(score.issued_components, ['novelty', 'live_similarity', 'coverage_gain', 'cost_efficiency'])
    // (0.30*0.75 + 0.20*1 + 0.20*0 + 0.15*0.6663 + 0.10*0.1429 + 0.05*0.9431) / 1.00
    assert.equal(score.fitness, 0.5864)
    assert.equal(score.gate_pass, true)
  })

  test('renormalizes over non-null components only', () => {
    const score = computeFitness({
      passRate: 0.5,
      tier: 2,
      issued: {
        discrimination: 1.0,
        difficulty_fit: 1.0,
        novelty: 0.0,
        live_similarity: null,
        coverage_gain: 0.5,
        cost_efficiency: 0.9324,
      },
      gatePass: true,
    })
    // (0.30*1 + 0.20*1 + 0.20*0 + 0.10*0.5 + 0.05*0.9324) / 0.85 = 0.59662 / 0.85 = 0.70190...
    assert.equal(score.fitness, 0.7019)
    assert.deepEqual(score.issued_components, ['novelty', 'coverage_gain', 'cost_efficiency'])
  })

  test('a failed gate forces fitness 0', () => {
    const score = computeFitness({
      passRate: 0.75,
      tier: 1,
      issued: {
        discrimination: 0.75,
        difficulty_fit: 1.0,
        novelty: 0.0,
        live_similarity: 0.6663,
        coverage_gain: 0.1429,
        cost_efficiency: 0.9431,
      },
      gatePass: false,
    })
    assert.equal(score.fitness, 0)
    assert.equal(score.gate_pass, false)
  })
})

describe('panel helpers', () => {
  const spec: BundleSpec = {
    slug: 'example',
    title: 'Example',
    vuln_class: 'sql-injection',
    cwe: 'CWE-89',
    tier: 1,
    description: '',
    endpoints: ['GET /search?q=', 'GET /internal/report'],
    marker: 'MARKER-1',
  }

  test('attackSurface and internalPath read the spec endpoints', () => {
    assert.deepEqual(attackSurface(spec), ['/search', 'q'])
    assert.equal(internalPath(spec), '/internal/report')
  })

  test('detected watches the marker for non-XSS classes', () => {
    assert.equal(detected(spec, [['payload', 'nothing here']]).hit, false)
    const hit = detected(spec, [['payload', 'rows: MARKER-1']])
    assert.equal(hit.hit, true)
    assert.equal(hit.label, 'payload')
  })

  test('detected watches verbatim reflection for XSS', () => {
    const xss: BundleSpec = { ...spec, vuln_class: 'cross-site-scripting' }
    assert.equal(detected(xss, [['benign-search', '<script>PNL9Z7CANARY</script>']]).hit, false)
    assert.equal(detected(xss, [['<script>PNL9Z7CANARY</script>', 'x <script>PNL9Z7CANARY</script> y']]).hit, true)
  })
})
