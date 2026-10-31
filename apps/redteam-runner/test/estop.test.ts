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
 * Appended sections (the wiring commits):
 *  - config resolution: resolveConfig stores the same paths the gate and
 *    the readiness probe read — override, registry-relative primary, and
 *    fleet-root secondary all survive resolution.
 *  - launch gate (run-level, temp REDTEAM_HOME): an engaged sentinel
 *    refuses with the typed error BEFORE any engagement state exists;
 *    a sentinel dropped mid-flight never touches the running engagement;
 *    deleting the file resumes launches; a watch cycle on the default
 *    run path is refused the same way.
 *  - readiness: the estop item renders ready/paused with the spec's
 *    exact strings and never flips the report's ok.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConfig } from '../src/phases/config.js'
import { runEngagement } from '../src/phases/run.js'
import { runWatchCycle } from '../src/continuous/index.js'
import { formatReadiness, readinessReport } from '../src/tools/readiness.js'
import type { EngagementInput } from '../src/types.js'
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


// ---------------------------------------------------------------------------
// Config resolution — the gate and the readiness probe read the same paths
// ---------------------------------------------------------------------------

describe('resolveConfig estopPaths', () => {
  it('resolves the primary beside registry.json plus the REDTEAM_HOME fleet root', () => {
    const cfg = resolveConfig({ REDTEAM_HOME: tmp }, { modelApiKey: 'test', deepseekApiKey: 'test', dryRunAgents: true })
    assert.deepEqual(cfg.estopPaths, [join(tmp, 'engagements', ESTOP_FILE_NAME), join(tmp, ESTOP_FILE_NAME)])
  })

  it('REDTEAM_ESTOP_PATH wins outright in the resolved config', () => {
    const explicit = join(tmp, 'ops', 'HALT')
    const cfg = resolveConfig({ REDTEAM_HOME: tmp, [ESTOP_PATH_ENV]: explicit }, { modelApiKey: 'test', deepseekApiKey: 'test', dryRunAgents: true })
    assert.deepEqual(cfg.estopPaths, [explicit])
  })

  it('a custom registryPath moves the primary sentinel with it', () => {
    const cfg = resolveConfig(
      { REDTEAM_HOME: tmp },
      { modelApiKey: 'test', deepseekApiKey: 'test', dryRunAgents: true, registryPath: join(tmp, 'custom', 'registry.json') },
    )
    assert.deepEqual(cfg.estopPaths, [join(tmp, 'custom', ESTOP_FILE_NAME), join(tmp, ESTOP_FILE_NAME)])
  })
})

// ---------------------------------------------------------------------------
// Launch gate — run-level, temp REDTEAM_HOME
// ---------------------------------------------------------------------------

describe('ESTOP launch gate (runEngagement)', () => {
  const ENV_KEYS = ['REDTEAM_ESTOP_PATH', 'REDTEAM_HOME', 'REDTEAM_SKIP_DIST_CHECK', 'MODEL_API_KEY'] as const
  let savedEnv: Record<string, string | undefined> = {}
  let sentinel = ''

  beforeEach(() => {
    savedEnv = {}
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
    sentinel = join(tmp, ESTOP_FILE_NAME)
    process.env['REDTEAM_ESTOP_PATH'] = sentinel
    process.env['REDTEAM_HOME'] = tmp
    process.env['REDTEAM_SKIP_DIST_CHECK'] = '1'
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  const input = (): EngagementInput => ({
    target: 'secscan.us',
    mode: 'red',
    objective: 'estop gate test',
    roe: { scope: ['secscan.us'] },
  })
  const opts = (engagementId: string) => ({
    modelApiKey: 'test',
    deepseekApiKey: 'test',
    qwenApiKey: 'test',
    mcpToken: 'test',
    engagementsDir: join(tmp, 'live'),
    registryPath: join(tmp, 'engagements', 'registry.json'),
    dryRunAgents: true,
    engagementId,
    deps: { verify: async () => true },
  })

  it('an engaged sentinel refuses the launch with the typed ESTOP_ENGAGED error', async () => {
    engageEstop(sentinel, { reason: 'incident freeze' })
    await assert.rejects(
      () => runEngagement(input(), opts('estop-gate-refused')),
      (err: unknown) => {
        assert.ok(err instanceof EstopEngagedError)
        assert.equal(err.code, 'ESTOP_ENGAGED')
        assert.equal(err.path, sentinel)
        assert.equal(err.reason, 'incident freeze')
        return true
      },
    )
  })

  it('a refused launch creates no engagement dir and no registry file', async () => {
    engageEstop(sentinel, { reason: 'incident freeze' })
    await assert.rejects(() => runEngagement(input(), opts('estop-gate-nostate')), /ESTOP engaged/)
    assert.equal(existsSync(join(tmp, 'live', 'estop-gate-nostate')), false)
    assert.equal(existsSync(join(tmp, 'engagements', 'registry.json')), false)
  })

  it('a sentinel dropped mid-flight never touches the running engagement; the next launch refuses', async () => {
    const running = runEngagement(input(), opts('estop-gate-inflight'))
    // The gate runs inside the launch's synchronous head (config + gate
    // precede every await), so engaging now is engaging after the gate:
    // the in-flight engagement must complete untouched.
    engageEstop(sentinel, { reason: 'dropped mid-flight' })
    const res = await running
    assert.equal(res.status, 'complete')
    await assert.rejects(() => runEngagement(input(), opts('estop-gate-after')), /ESTOP engaged/)
  })

  it('deleting the sentinel resumes launches (delete-to-resume)', async () => {
    engageEstop(sentinel, { reason: 'pause' })
    await assert.rejects(() => runEngagement(input(), opts('estop-gate-paused')), /ESTOP engaged/)
    disengageEstop(sentinel)
    const res = await runEngagement(input(), opts('estop-gate-resumed'))
    assert.equal(res.status, 'complete')
  })

  it('a watch cycle on the default run path is refused the same way', async () => {
    process.env['MODEL_API_KEY'] = 'test'
    const profilePath = join(tmp, 'profile.json')
    writeFileSync(
      profilePath,
      JSON.stringify({
        version: 1,
        name: 'estop-watch',
        engagement: {
          target: 'acme.com',
          mode: 'red',
          objective: 'continuous validation',
          roe: { scope: ['acme.com'] },
          fullBattery: true,
        },
        cadence: { intervalHours: 168 },
        scopeValidUntil: '2026-12-31T23:59:59Z',
      }),
    )
    engageEstop(sentinel, { reason: 'fleet maintenance' })
    const r = await runWatchCycle({ profilePath, env: { ...process.env }, now: () => new Date('2026-10-31T12:00:00Z') })
    assert.equal(r.status, 'error')
    assert.match(r.reason ?? '', /ESTOP engaged/)
  })
})

// ---------------------------------------------------------------------------
// Readiness — the estop item in both states, exact strings, ok untouched
// ---------------------------------------------------------------------------

describe('readiness estop item', () => {
  it('clear: the item is ready, not required, with the spec ok-line', async () => {
    const report = await readinessReport({ REDTEAM_HOME: tmp } as NodeJS.ProcessEnv)
    const item = report.items.find(i => i.id === 'estop')
    assert.ok(item, 'estop item present')
    assert.equal(item.state, 'ready')
    assert.equal(item.required, false)
    assert.equal(item.label, 'ESTOP pause sentinel')
    assert.equal(item.detail, 'ESTOP not engaged — new engagements launch normally.')
  })

  it('engaged: paused with path + reason + delete-to-resume fix; the report ok is unchanged', async () => {
    const sentinel = join(tmp, ESTOP_FILE_NAME)
    engageEstop(sentinel, { reason: 'fleet maintenance' })
    const engaged = await readinessReport({ REDTEAM_HOME: tmp, [ESTOP_PATH_ENV]: sentinel } as NodeJS.ProcessEnv)
    const item = engaged.items.find(i => i.id === 'estop')
    assert.ok(item, 'estop item present')
    assert.equal(item.state, 'paused')
    assert.equal(item.required, false)
    assert.ok(item.detail?.includes(`ESTOP engaged at ${sentinel}`))
    assert.ok(item.detail?.includes('fleet maintenance'))
    assert.ok(item.detail?.includes('new engagement launches are paused (in-flight engagements are unaffected)'))
    assert.equal(item.fix, `Delete ${sentinel} to resume.`)
    const clear = await readinessReport({ REDTEAM_HOME: tmp, [ESTOP_PATH_ENV]: join(tmp, 'absent', ESTOP_FILE_NAME) } as NodeJS.ProcessEnv)
    assert.equal(engaged.ok, clear.ok)
  })

  it('formatReadiness renders the PAUS mark and the fix line for a paused item', async () => {
    const sentinel = join(tmp, ESTOP_FILE_NAME)
    engageEstop(sentinel, { reason: 'fleet maintenance' })
    const report = await readinessReport({ REDTEAM_HOME: tmp, [ESTOP_PATH_ENV]: sentinel } as NodeJS.ProcessEnv)
    const out = formatReadiness(report)
    assert.match(out, /PAUS\s+ESTOP pause sentinel/)
    assert.ok(out.includes(`→ Delete ${sentinel} to resume.`))
  })
})
