/**
 * ESTOP fleet pause sentinel tests (Q-ESTOP-APP, Spec 1).
 *
 * What we prove here:
 *  - path resolution: REDTEAM_ESTOP_PATH wins outright; the primary
 *    sentinel sits beside registry.json; the REDTEAM_HOME fleet root is
 *    the secondary (Hermes's two-path rule), deduplicated.
 *  - presence engages: absent -> clear; empty file -> engaged; corrupt
 *    body -> engaged with no reason; a JSON body surfaces reason +
 *    engaged_at; a stat error (path under a regular file) -> engaged —
 *    pause is the fail-safe direction, the opposite polarity from
 *    abort.json's tolerant read.
 *
 * Config-resolution, launch-gate, watch-cycle, and readiness sections are
 * appended at the end of this file as those commits land.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ESTOP_FILE_NAME,
  ESTOP_PATH_ENV,
  EstopEngagedError,
  disengageEstop,
  engageEstop,
  readEstopState,
  requireEstopClear,
  resolveEstopPaths,
} from '../src/safety/index.js'

let tmp = ''
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), `estop-test-${process.pid}-`))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('resolveEstopPaths', () => {
  it('puts the primary sentinel beside registry.json', () => {
    const registryPath = join(tmp, 'engagements', 'registry.json')
    assert.deepEqual(resolveEstopPaths({}, { registryPath }), [join(tmp, 'engagements', ESTOP_FILE_NAME)])
  })

  it('adds the REDTEAM_HOME fleet root as secondary when it differs', () => {
    const registryPath = join(tmp, 'engagements', 'registry.json')
    assert.deepEqual(resolveEstopPaths({ REDTEAM_HOME: tmp }, { registryPath }), [
      join(tmp, 'engagements', ESTOP_FILE_NAME),
      join(tmp, ESTOP_FILE_NAME),
    ])
  })

  it('deduplicates when the registry sits directly in REDTEAM_HOME', () => {
    const registryPath = join(tmp, 'registry.json')
    assert.deepEqual(resolveEstopPaths({ REDTEAM_HOME: tmp }, { registryPath }), [join(tmp, ESTOP_FILE_NAME)])
  })

  it('REDTEAM_ESTOP_PATH wins outright — one explicit path', () => {
    const explicit = join(tmp, 'elsewhere', 'HALT')
    assert.deepEqual(
      resolveEstopPaths({ [ESTOP_PATH_ENV]: explicit, REDTEAM_HOME: tmp }, { registryPath: join(tmp, 'engagements', 'registry.json') }),
      [explicit],
    )
  })

  it('resolves nothing when there is no registry path, no home, no override', () => {
    assert.deepEqual(resolveEstopPaths({}, {}), [])
    assert.deepEqual(readEstopState(resolveEstopPaths({}, {})), { engaged: false })
  })
})

// ---------------------------------------------------------------------------
// Presence semantics
// ---------------------------------------------------------------------------

describe('readEstopState', () => {
  it('absent everywhere -> not engaged', () => {
    assert.deepEqual(readEstopState([join(tmp, ESTOP_FILE_NAME)]), { engaged: false })
    requireEstopClear([join(tmp, ESTOP_FILE_NAME)]) // does not throw
  })

  it('empty file -> engaged (presence alone engages)', () => {
    const p = join(tmp, ESTOP_FILE_NAME)
    writeFileSync(p, '')
    const s = readEstopState([p])
    assert.equal(s.engaged, true)
    assert.equal(s.path, p)
    assert.equal(s.reason, undefined)
  })

  it('corrupt body -> engaged, no reason surfaced', () => {
    const p = join(tmp, ESTOP_FILE_NAME)
    writeFileSync(p, '{not json at all')
    const s = readEstopState([p])
    assert.equal(s.engaged, true)
    assert.equal(s.reason, undefined)
    assert.equal(s.engagedAt, undefined)
  })

  it('JSON body -> reason and engaged_at surfaced verbatim', () => {
    const p = join(tmp, ESTOP_FILE_NAME)
    writeFileSync(p, JSON.stringify({ reason: 'maintenance window', engaged_at: '2026-10-31T00:00:00.000Z' }))
    const s = readEstopState([p])
    assert.equal(s.engaged, true)
    assert.equal(s.reason, 'maintenance window')
    assert.equal(s.engagedAt, '2026-10-31T00:00:00.000Z')
  })

  it('stat error (sentinel path under a regular file) -> engaged, fail-safe', () => {
    const blocker = join(tmp, 'blocker')
    writeFileSync(blocker, 'a file, not a directory')
    const s = readEstopState([join(blocker, ESTOP_FILE_NAME)])
    assert.equal(s.engaged, true)
    assert.equal(s.path, join(blocker, ESTOP_FILE_NAME))
  })

  it('secondary engages when the primary is absent; the first match wins', () => {
    const primary = join(tmp, 'engagements', ESTOP_FILE_NAME)
    const secondary = join(tmp, ESTOP_FILE_NAME)
    writeFileSync(secondary, '')
    const s = readEstopState([primary, secondary])
    assert.equal(s.engaged, true)
    assert.equal(s.path, secondary)
  })

  it('engage/disengage round-trip: body written atomically, delete resumes', () => {
    const p = join(tmp, ESTOP_FILE_NAME)
    engageEstop(p, { reason: 'round trip', engagedAt: '2026-10-31T01:02:03.000Z' })
    const s = readEstopState([p])
    assert.equal(s.engaged, true)
    assert.equal(s.reason, 'round trip')
    assert.equal(s.engagedAt, '2026-10-31T01:02:03.000Z')
    disengageEstop(p)
    assert.deepEqual(readEstopState([p]), { engaged: false })
  })

  it('requireEstopClear throws the typed error carrying code, path, and the resume instruction', () => {
    const p = join(tmp, ESTOP_FILE_NAME)
    writeFileSync(p, JSON.stringify({ reason: 'incident freeze' }))
    assert.throws(
      () => requireEstopClear([p]),
      (err: unknown) => {
        assert.ok(err instanceof EstopEngagedError)
        assert.equal(err.code, 'ESTOP_ENGAGED')
        assert.equal(err.path, p)
        assert.equal(err.reason, 'incident freeze')
        assert.match(err.message, /ESTOP engaged — new engagements are paused \(reason: incident freeze\)/)
        assert.match(err.message, /In-flight engagements are unaffected/)
        assert.ok(err.message.includes(`Delete ${p} to resume.`))
        return true
      },
    )
  })
})

