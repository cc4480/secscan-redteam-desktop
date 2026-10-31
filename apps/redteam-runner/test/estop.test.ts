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
 * Below the module sections: config resolution (estopPaths), the
 * runEngagement launch gate (typed refusal, no state created, mid-flight
 * drops do not stop a running engagement, delete-to-resume), the watch
 * cycle surfacing a refused launch as an error, and the readiness item
 * (ready / paused, never required, never flips the report's ok).
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
import { resolveConfig } from '../src/phases/config.js'
import { runEngagement, type RunOptions } from '../src/phases.js'
import { runWatchCycle } from '../src/continuous/watch/cycle.js'
import { readinessReport, type ReadinessReport } from '../src/tools/readiness.js'
import type { EngagementInput } from '../src/types.js'

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


// ---------------------------------------------------------------------------
// Config resolution: ResolvedRunnerConfig.estopPaths
// ---------------------------------------------------------------------------

describe('estop config resolution', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rt-estop-cfg-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const keys = { mcpToken: 'test', deepseekApiKey: 'test', qwenApiKey: 'test' }

  it('defaults the primary sentinel beside the resolved registry path', () => {
    const registryPath = join(dir, 'registry.json')
    const config = resolveConfig({}, { ...keys, registryPath })
    assert.equal(config.registryPath, registryPath)
    assert.deepEqual(config.estopPaths, [join(dir, ESTOP_FILE_NAME)])
  })

  it('adds the REDTEAM_HOME fleet-root sentinel as secondary', () => {
    const home = join(dir, 'home')
    const config = resolveConfig({ REDTEAM_HOME: home }, { ...keys, registryPath: join(dir, 'registry.json') })
    assert.deepEqual(config.estopPaths, [join(dir, ESTOP_FILE_NAME), join(home, ESTOP_FILE_NAME)])
  })

  it('REDTEAM_ESTOP_PATH override wins outright', () => {
    const override = join(dir, 'custom', 'STOP')
    const config = resolveConfig(
      { [ESTOP_PATH_ENV]: override, REDTEAM_HOME: join(dir, 'home') },
      { ...keys, registryPath: join(dir, 'registry.json') },
    )
    assert.deepEqual(config.estopPaths, [override])
  })
})

// ---------------------------------------------------------------------------
// Launch gate: runEngagement refuses while the sentinel is engaged
// ---------------------------------------------------------------------------

describe('estop launch gate (runEngagement)', () => {
  let dir: string
  let savedSkip: string | undefined
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rt-estop-gate-'))
    // The dist-freshness guard is not what this section tests; the
    // module's own documented bypass keeps the gate observable while
    // the shared tree's dist stamp lags mid-harvest (it is refreshed
    // by the build that precedes the house test chain).
    savedSkip = process.env['REDTEAM_SKIP_DIST_CHECK']
    process.env['REDTEAM_SKIP_DIST_CHECK'] = '1'
  })
  afterEach(() => {
    if (savedSkip === undefined) delete process.env['REDTEAM_SKIP_DIST_CHECK']
    else process.env['REDTEAM_SKIP_DIST_CHECK'] = savedSkip
    rmSync(dir, { recursive: true, force: true })
  })

  const yesVerify = async () => true
  const sentinelPath = () => join(dir, ESTOP_FILE_NAME)
  const opts = (extra: Partial<RunOptions> = {}): RunOptions => ({
    mcpToken: 'test',
    deepseekApiKey: 'test',
    qwenApiKey: 'test',
    engagementsDir: dir,
    registryPath: join(dir, 'registry.json'),
    dryRunAgents: true,
    deps: { verify: yesVerify },
    ...extra,
  })
  const input = (): EngagementInput => ({
    target: 'secscan.us',
    mode: 'red',
    objective: 'estop gate test',
    roe: { scope: ['secscan.us'] },
  })

  it('refuses the launch with the typed error and creates no state', async () => {
    engageEstop(sentinelPath(), { reason: 'gate test' })
    await assert.rejects(
      () => runEngagement(input(), opts()),
      (err: unknown) => {
        assert.ok(err instanceof EstopEngagedError)
        assert.equal(err.code, 'ESTOP_ENGAGED')
        assert.equal(err.path, sentinelPath())
        return true
      },
    )
    assert.equal(existsSync(join(dir, 'registry.json')), false)
    assert.deepEqual(readdirSync(dir), [ESTOP_FILE_NAME])
  })

  it('runs normally when no sentinel exists', async () => {
    const res = await runEngagement(input(), opts())
    assert.equal(res.status, 'complete')
  })

  it('a sentinel dropped mid-flight does not stop the running engagement, but pauses the next launch', async () => {
    let dropped = false
    const droppingVerify = async () => {
      if (!dropped) {
        dropped = true
        engageEstop(sentinelPath(), { reason: 'mid-flight drop' })
      }
      return true
    }
    const res = await runEngagement(input(), opts({ deps: { verify: droppingVerify } }))
    assert.equal(res.status, 'complete')
    await assert.rejects(() => runEngagement(input(), opts()), EstopEngagedError)
  })

  it('deleting the sentinel resumes launches', async () => {
    engageEstop(sentinelPath(), { reason: 'resume test' })
    await assert.rejects(() => runEngagement(input(), opts()), EstopEngagedError)
    disengageEstop(sentinelPath())
    const res = await runEngagement(input(), opts())
    assert.equal(res.status, 'complete')
  })
})

// ---------------------------------------------------------------------------
// Watch cycle: a refused launch surfaces as an error naming the ESTOP
// ---------------------------------------------------------------------------

describe('estop watch cycle', () => {
  let dir: string
  let savedEstop: string | undefined
  let savedKey: string | undefined
  let savedSkip: string | undefined
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rt-estop-watch-'))
    savedEstop = process.env[ESTOP_PATH_ENV]
    savedKey = process.env['MODEL_API_KEY']
    savedSkip = process.env['REDTEAM_SKIP_DIST_CHECK']
    process.env['REDTEAM_SKIP_DIST_CHECK'] = '1'
  })
  afterEach(() => {
    if (savedEstop === undefined) delete process.env[ESTOP_PATH_ENV]
    else process.env[ESTOP_PATH_ENV] = savedEstop
    if (savedKey === undefined) delete process.env['MODEL_API_KEY']
    else process.env['MODEL_API_KEY'] = savedKey
    if (savedSkip === undefined) delete process.env['REDTEAM_SKIP_DIST_CHECK']
    else process.env['REDTEAM_SKIP_DIST_CHECK'] = savedSkip
    rmSync(dir, { recursive: true, force: true })
  })

  it('a refused launch surfaces as a cycle error naming the ESTOP', async () => {
    const sentinel = join(dir, 'ESTOP')
    engageEstop(sentinel, { reason: 'watch test' })
    process.env[ESTOP_PATH_ENV] = sentinel
    process.env['MODEL_API_KEY'] = 'test'
    const profilePath = join(dir, 'profile.json')
    writeFileSync(
      profilePath,
      JSON.stringify({
        version: 1,
        name: 'estop-watch',
        cadence: { intervalHours: 24 },
        scopeValidUntil: '2999-01-01T00:00:00.000Z',
        engagement: {
          target: 'secscan.us',
          mode: 'red',
          objective: 'estop watch test',
          roe: { scope: ['secscan.us'] },
        },
      }),
    )
    const result = await runWatchCycle({ profilePath })
    assert.equal(result.status, 'error')
    assert.match(result.reason ?? '', /ESTOP engaged/)
  })
})

// ---------------------------------------------------------------------------
// Readiness: the estop item reports the pause without ever blocking
// ---------------------------------------------------------------------------

describe('estop readiness item', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rt-estop-ready-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const estopOf = (report: ReadinessReport) => {
    const item = report.items.find((i) => i.id === 'estop')
    assert.ok(item, 'readiness report carries the estop item')
    return item
  }

  it('reports ready when no sentinel exists', async () => {
    const report = await readinessReport({ [ESTOP_PATH_ENV]: join(dir, 'ESTOP') } as NodeJS.ProcessEnv)
    const item = estopOf(report)
    assert.equal(item.state, 'ready')
    assert.equal(item.detail, 'ESTOP not engaged — new engagements launch normally.')
    assert.equal(item.required, false)
    assert.equal(item.fix, undefined)
  })

  it('reports paused with path, reason, and resume fix when engaged — and never flips ok', async () => {
    const sentinel = join(dir, 'ESTOP')
    const clear = await readinessReport({ [ESTOP_PATH_ENV]: sentinel } as NodeJS.ProcessEnv)
    engageEstop(sentinel, { reason: 'readiness test' })
    const engaged = await readinessReport({ [ESTOP_PATH_ENV]: sentinel } as NodeJS.ProcessEnv)
    const item = estopOf(engaged)
    assert.equal(item.state, 'paused')
    assert.ok(item.detail?.includes(sentinel))
    assert.ok(item.detail?.includes('readiness test'))
    assert.equal(item.fix, `Delete ${sentinel} to resume.`)
    assert.equal(engaged.ok, clear.ok)
  })

  it('says "no reason recorded" when the sentinel body carries none', async () => {
    const sentinel = join(dir, 'ESTOP')
    writeFileSync(sentinel, '')
    const report = await readinessReport({ [ESTOP_PATH_ENV]: sentinel } as NodeJS.ProcessEnv)
    const item = estopOf(report)
    assert.equal(item.state, 'paused')
    assert.ok(item.detail?.includes('no reason recorded'))
  })
})
