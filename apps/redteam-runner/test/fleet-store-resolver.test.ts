/**
 * Store-backed fleet resolver tests — the runner host resolves the
 * fleet's provider keys from the app credentials store
 * ($DSH_HOME/.credentials.yaml) at dispatch time.
 *
 * What we prove here:
 *  - a key seated in the store after the resolver was created is picked
 *    up by the next read, with no restart
 *  - a rotated key replaces the old one on the next read
 *  - the launching environment wins over the store (per-run override),
 *    and a blank environment value does not shadow the store
 *  - a malformed document fails loud at creation, never silently
 *  - resolution is name-agnostic: the provider selector resolves through
 *    the same path as any provider key
 *  - the provider selector also resolves from the desktop's published
 *    fleet provider record ($DSH_HOME/fleet-provider.json), consulted
 *    after the store: environment and store references outrank it, a
 *    republished selection is picked up by the next read, and the record
 *    never serves any other name
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStoreFleetConfigResolver } from '../src/fleet-store-resolver.js'

const KEY = 'DEEPSEEK_API_KEY'
const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tempHome(): { env: NodeJS.ProcessEnv; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-store-resolver-'))
  dirs.push(dir)
  return { env: { DSH_HOME: dir }, file: join(dir, '.credentials.yaml') }
}

function writeStore(file: string, refs: Record<string, string>): void {
  const lines = Object.entries(refs).map(([name, value]) => `  ${name}: ${value}`)
  writeFileSync(file, `version: 1\nrefs:\n${lines.join('\n')}\n`, { mode: 0o600 })
  // Distinct mtimes keep the resolver's change detection honest even
  // when two writes land inside one filesystem timestamp tick.
  const later = new Date(Date.now() + 1100)
  utimesSync(file, later, later)
}

describe('createStoreFleetConfigResolver', () => {
  it('serves a key seated in the store', () => {
    const { env, file } = tempHome()
    writeStore(file, { [KEY]: 'sk-stored' })
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(KEY), 'sk-stored')
    assert.equal(resolver.valueFor('QWEN_API_KEY'), undefined)
  })

  it('picks up a key seated after creation, with no restart', () => {
    const { env, file } = tempHome()
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(KEY), undefined)
    writeStore(file, { [KEY]: 'sk-arrived-late' })
    assert.equal(resolver.valueFor(KEY), 'sk-arrived-late')
  })

  it('picks up a rotated key on the next read', () => {
    const { env, file } = tempHome()
    writeStore(file, { [KEY]: 'sk-first' })
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(KEY), 'sk-first')
    writeStore(file, { [KEY]: 'sk-second-rotated' })
    assert.equal(resolver.valueFor(KEY), 'sk-second-rotated')
  })

  it('the launching environment wins over the store', () => {
    const { env, file } = tempHome()
    writeStore(file, { [KEY]: 'sk-stored' })
    env[KEY] = 'sk-from-env'
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(KEY), 'sk-from-env')
  })

  it('a blank environment value does not shadow the store', () => {
    const { env, file } = tempHome()
    writeStore(file, { [KEY]: 'sk-stored' })
    env[KEY] = ''
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(KEY), 'sk-stored')
  })

  it('fails loud at creation on a malformed document', () => {
    const { env, file } = tempHome()
    writeFileSync(file, 'version: 1\nbogus: true\n', { mode: 0o600 })
    assert.throws(() => createStoreFleetConfigResolver(env))
  })

  it('resolves the provider selector through the same name-agnostic path', () => {
    const { env } = tempHome()
    env['REDTEAM_LLM_PROVIDER'] = 'deepseek'
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor('REDTEAM_LLM_PROVIDER'), 'deepseek')
  })
})

const SELECTOR = 'REDTEAM_LLM_PROVIDER'

function recordFile(storeFile: string): string {
  return join(dirname(storeFile), 'fleet-provider.json')
}

function writeRecord(storeFile: string, provider: string): void {
  const file = recordFile(storeFile)
  writeFileSync(
    file,
    `${JSON.stringify({ version: 1, provider, updatedAt: 1700000000000 }, null, 2)}\n`,
  )
  // Distinct mtimes keep the resolver's change detection honest even
  // when two writes land inside one filesystem timestamp tick.
  const later = new Date(Date.now() + 1100)
  utimesSync(file, later, later)
}

function writeRawRecord(storeFile: string, text: string): void {
  const file = recordFile(storeFile)
  writeFileSync(file, text)
  const later = new Date(Date.now() + 1100)
  utimesSync(file, later, later)
}

describe('createStoreFleetConfigResolver — desktop fleet provider record', () => {
  it('serves the selection from the record when env and store do not carry it', () => {
    const { env, file } = tempHome()
    writeRecord(file, 'deepseek')
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(SELECTOR), 'deepseek')
  })

  it('a record published after creation is picked up by the next read, with no restart', () => {
    const { env, file } = tempHome()
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(SELECTOR), undefined)
    writeRecord(file, 'local')
    assert.equal(resolver.valueFor(SELECTOR), 'local')
  })

  it('a republished selection replaces the old one on the next read', () => {
    const { env, file } = tempHome()
    writeRecord(file, 'meta')
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(SELECTOR), 'meta')
    writeRecord(file, 'local')
    assert.equal(resolver.valueFor(SELECTOR), 'local')
  })

  it('a store-seated selector wins over the record', () => {
    const { env, file } = tempHome()
    writeStore(file, { [SELECTOR]: 'deepseek' })
    writeRecord(file, 'local')
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(SELECTOR), 'deepseek')
  })

  it('the launching environment wins over the record', () => {
    const { env, file } = tempHome()
    writeRecord(file, 'local')
    env[SELECTOR] = 'meta'
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(SELECTOR), 'meta')
  })

  it('the record never serves a key name', () => {
    const { env, file } = tempHome()
    writeRecord(file, 'deepseek')
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(KEY), undefined)
  })

  it('fails loud at creation on a malformed record', () => {
    const { env, file } = tempHome()
    writeRawRecord(file, 'this is not json\n')
    assert.throws(() => createStoreFleetConfigResolver(env))
  })

  it('fails loud at creation on a record naming an unknown provider', () => {
    const { env, file } = tempHome()
    writeRecord(file, 'qwen')
    assert.throws(() => createStoreFleetConfigResolver(env))
  })

  it('fails loud at creation on a record with an unsupported version', () => {
    const { env, file } = tempHome()
    writeRawRecord(file, `${JSON.stringify({ version: 2, provider: 'meta', updatedAt: 1 })}\n`)
    assert.throws(() => createStoreFleetConfigResolver(env))
  })

  it('a record malformed after creation keeps serving the last good selection', () => {
    const { env, file } = tempHome()
    writeRecord(file, 'deepseek')
    const resolver = createStoreFleetConfigResolver(env)
    assert.equal(resolver.valueFor(SELECTOR), 'deepseek')
    writeRawRecord(file, '{ torn write')
    assert.equal(resolver.valueFor(SELECTOR), 'deepseek')
  })
})
