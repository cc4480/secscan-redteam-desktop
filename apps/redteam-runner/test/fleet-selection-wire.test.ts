/**
 * Fleet selection wire — end-to-end shape proof for the follow-on to the
 * store-backed fleet resolver: a selection written through the DESKTOP's
 * own code path (the fleet provider record both processes share through
 * @secscan/redteam-llm-router, published by the desktop's llama shell)
 * is read back through the RUNNER's resolver and steers the router's
 * role policy, in the same processes, with no restart between the write
 * and the read — and a second write re-seats the fleet on the next read.
 *
 * The writer module is imported from the shared router package on
 * purpose: it is the exact module the desktop ships, and it carries no
 * Electron dependency, so this test exercises the production write
 * path rather than a copy of it.
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  LLM_PROVIDER_ENV,
  effectiveFleetProvider,
  readFleetProviderRecord,
  resolveFleetProviderPath,
  roleModelPolicy,
  writeFleetProviderRecord,
} from '@secscan/redteam-llm-router'
import { createStoreFleetConfigResolver } from '../src/fleet-store-resolver.js'

const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tempHome(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-selection-wire-'))
  dirs.push(dir)
  return { DSH_HOME: dir }
}

/**
 * Assert every fleet role routes to one provider family.
 * @param env - the dispatch environment the router would resolve against.
 * @param provider - the provider family every role must name.
 */
function assertAllRolesRouteTo(env: NodeJS.ProcessEnv, provider: string): void {
  const policy = roleModelPolicy(env)
  for (const [role, route] of Object.entries(policy)) {
    assert.equal(route.provider, provider, `role ${role} must route to ${provider}`)
  }
}

describe("effectiveFleetProvider — the desktop's selection computation", () => {
  it('an explicit operator value names its own family and beats a serving local server', () => {
    assert.equal(effectiveFleetProvider('meta', true), 'meta')
    assert.equal(effectiveFleetProvider('deepseek', true), 'deepseek')
    assert.equal(effectiveFleetProvider('local', false), 'local')
  })

  it("any other explicit value reaches the explicit-selector family, as the router's policy maps it", () => {
    assert.equal(effectiveFleetProvider('qwen', false), 'deepseek')
  })

  it('with no explicit value, a serving local server selects local and anything else leaves the Meta default', () => {
    assert.equal(effectiveFleetProvider(undefined, true), 'local')
    assert.equal(effectiveFleetProvider(undefined, false), 'meta')
    assert.equal(effectiveFleetProvider('', true), 'local')
    assert.equal(effectiveFleetProvider('  ', false), 'meta')
  })
})

describe('desktop write path → runner resolver → router policy', () => {
  it('the desktop writer and the runner resolver name the same record file', () => {
    const env = tempHome()
    writeFleetProviderRecord(env, 'deepseek', () => 1700000000000)
    const record = readFleetProviderRecord(env)
    assert.equal(record?.provider, 'deepseek')
    assert.equal(record?.updatedAt, 1700000000000)
    assert.equal(
      resolveFleetProviderPath(env),
      join(env['DSH_HOME']!, 'fleet-provider.json'),
    )
  })

  it('publishing the same selection twice writes once', () => {
    const env = tempHome()
    writeFleetProviderRecord(env, 'meta')
    const first = statSync(resolveFleetProviderPath(env)).mtimeMs
    writeFleetProviderRecord(env, 'meta')
    assert.equal(statSync(resolveFleetProviderPath(env)).mtimeMs, first)
  })

  it('a selection written by the desktop steers dispatch, and the next write re-seats it — no restart', () => {
    const env = tempHome()
    // The runner's resolver exists before any selection is published,
    // exactly as a long-running runner predates the operator's change.
    const resolver = createStoreFleetConfigResolver(env)
    const dispatchEnv = (): NodeJS.ProcessEnv => {
      const selection = resolver.valueFor(LLM_PROVIDER_ENV)
      return selection === undefined ? { ...env } : { ...env, [LLM_PROVIDER_ENV]: selection }
    }

    // Nothing published: the router's own default (Meta) governs.
    assertAllRolesRouteTo(dispatchEnv(), 'meta')

    // The desktop publishes DeepSeek (the operator flipped the app to it).
    writeFleetProviderRecord(env, 'deepseek')
    assert.equal(resolver.valueFor(LLM_PROVIDER_ENV), 'deepseek')
    assertAllRolesRouteTo(dispatchEnv(), 'deepseek')

    // The desktop publishes local (the bundled server started serving).
    // The dispatch environment for a local seat also carries the model
    // name, which the runner's own local plumbing supplies from the
    // desktop's published server state.
    writeFleetProviderRecord(env, 'local')
    assert.equal(resolver.valueFor(LLM_PROVIDER_ENV), 'local')
    assertAllRolesRouteTo(
      { ...dispatchEnv(), REDTEAM_LOCAL_MODEL: 'qwen-local' },
      'local',
    )

    // And back to Meta (the server stopped; no operator value seated).
    writeFleetProviderRecord(env, 'meta')
    assert.equal(resolver.valueFor(LLM_PROVIDER_ENV), 'meta')
    assertAllRolesRouteTo(dispatchEnv(), 'meta')
  })

  it('the launching environment still wins over a desktop-published selection', () => {
    const env = tempHome()
    writeFleetProviderRecord(env, 'deepseek')
    const runnerEnv = { ...env, [LLM_PROVIDER_ENV]: 'meta' }
    const resolver = createStoreFleetConfigResolver(runnerEnv)
    assert.equal(resolver.valueFor(LLM_PROVIDER_ENV), 'meta')
  })
})
