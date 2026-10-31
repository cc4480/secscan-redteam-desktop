/**
 * FilePoolStateStore: env path resolution, the atomic write discipline,
 * the quarantine rename, and the spec's two file-level proofs — T-P6 (no
 * key material ever reaches the document) and T-P7 (save discipline).
 * Real tmp directories throughout; no fake store.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import type { ClassifiedFailure, FailoverReason } from '../src/classifier.js'
import { CredentialPool } from '../src/pool.js'
import {
  FilePoolStateStore,
  POOL_STATE_FILENAME,
  resolvePoolStateFilePath,
} from '../src/pool-store.js'

const HINTS_OFF = {
  retryable: false,
  rotateCredential: false,
  fallbackModel: false,
  fallbackProvider: false,
  compress: false,
}

function failure(reason: FailoverReason, extra: Partial<ClassifiedFailure> = {}): ClassifiedFailure {
  return { reason, hints: HINTS_OFF, detail: 'test', ...extra }
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'pool-store-'))
}

function fingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 8)
}

describe('resolvePoolStateFilePath', () => {
  test('off values disable persistence (off / 0 / false, any case, padded)', () => {
    for (const value of ['off', '0', 'false', ' OFF ', 'False']) {
      assert.equal(resolvePoolStateFilePath({ REDTEAM_LLM_POOL_PERSIST: value }), undefined)
    }
  })

  test('an explicit state-file path wins over REDTEAM_HOME', () => {
    const env = {
      REDTEAM_LLM_POOL_STATE_FILE: ' /somewhere/custom.json ',
      REDTEAM_HOME: '/redteam-home',
    } as NodeJS.ProcessEnv
    assert.equal(resolvePoolStateFilePath(env), '/somewhere/custom.json')
  })

  test('REDTEAM_HOME roots the default filename', () => {
    const env = { REDTEAM_HOME: '/redteam-home' } as NodeJS.ProcessEnv
    assert.equal(resolvePoolStateFilePath(env), join('/redteam-home', POOL_STATE_FILENAME))
  })

  test('the working directory is the last resort', () => {
    assert.equal(resolvePoolStateFilePath({} as NodeJS.ProcessEnv), join(process.cwd(), POOL_STATE_FILENAME))
  })

  test('fromEnv mirrors the resolver: off is no store, on is a store at the resolved path', () => {
    assert.equal(FilePoolStateStore.fromEnv({ REDTEAM_LLM_POOL_PERSIST: 'off' }), undefined)
    const store = FilePoolStateStore.fromEnv({ REDTEAM_HOME: '/redteam-home' })
    assert.equal(store?.path, join('/redteam-home', POOL_STATE_FILENAME))
  })
})

describe('FilePoolStateStore', () => {
  test('a missing file reads as null (normal first run)', () => {
    const store = new FilePoolStateStore(join(tmpDir(), 'state.json'))
    assert.equal(store.read(), null)
  })

  test('write/read round-trips, creates nested directories, and leaves no tmp sibling', () => {
    const path = join(tmpDir(), 'nested', 'deep', 'state.json')
    const store = new FilePoolStateStore(path)
    store.write('{"version":1}')
    assert.equal(store.read(), '{"version":1}')
    assert.deepEqual(readdirSync(join(path, '..')), ['state.json'])
  })

  test('quarantine renames the document aside with its bytes intact; a second call finds nothing', () => {
    const dir = tmpDir()
    const path = join(dir, 'state.json')
    const store = new FilePoolStateStore(path)
    store.write('corrupt-bytes')
    const quarantined = store.quarantine()
    assert.ok(quarantined !== null && quarantined.startsWith(`${path}.corrupt-`))
    assert.equal(existsSync(path), false)
    assert.equal(readFileSync(quarantined, 'utf8'), 'corrupt-bytes')
    assert.equal(store.quarantine(), null)
  })

  test('T-P5 (file level): a corrupt on-disk document is quarantined by the restoring pool', () => {
    const dir = tmpDir()
    const path = join(dir, 'state.json')
    const store = new FilePoolStateStore(path)
    store.write('{"version":99,"providers":{}}')
    const pool = new CredentialPool('fake', ['key-a'], { store })
    assert.equal(pool.restoreReport?.quarantined, true)
    assert.equal(pool.acquire('model-a')?.apiKey, 'key-a')
    const names = readdirSync(dir)
    assert.equal(names.some(name => name.startsWith('state.json.corrupt-')), true)
    assert.equal(names.includes('state.json'), false, 'the original path is free for the next save')
    pool.reportFailure(0, 'model-a', failure('auth_dead'))
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { version: number }
    assert.equal(doc.version, 1, 'the next mutation wrote a fresh valid document')
  })

  test('T-P6 no key material: the state file holds fingerprints and bookkeeping only', () => {
    const dir = tmpDir()
    const path = join(dir, 'state.json')
    const store = new FilePoolStateStore(path)
    const keys = ['fake-key-DO-NOT-PERSIST-alpha', 'fake-key-DO-NOT-PERSIST-beta']
    const pool = new CredentialPool('fake', keys, { store })
    pool.reportFailure(0, 'model-a', failure('auth_dead'))
    pool.reportFailure(1, 'model-a', failure('rate_limit'))
    pool.benchModel('model-b', 30_000)
    const bytes = readFileSync(path, 'utf8')
    assert.equal(bytes.includes('DO-NOT-PERSIST'), false)
    for (const key of keys) assert.equal(bytes.includes(key), false)
    assert.ok(bytes.includes(fingerprint(keys[0] ?? '')), 'the dead key is identifiable by fingerprint')
    assert.ok(bytes.includes(fingerprint(keys[1] ?? '')), 'the benched key is identifiable by fingerprint')
  })

  test('T-P7 save discipline: after a mutation the file parses, no tmp remains, mode is 0600 on POSIX', () => {
    const dir = tmpDir()
    const path = join(dir, 'state.json')
    const store = new FilePoolStateStore(path)
    const pool = new CredentialPool('fake', ['key-a'], { store })
    pool.reportFailure(0, 'model-a', failure('billing'))
    const doc = JSON.parse(readFileSync(path, 'utf8')) as {
      version: number
      providers: { fake: { entries: Array<{ dead: boolean; deadReason?: string }> } }
    }
    assert.equal(doc.version, 1)
    assert.equal(doc.providers.fake.entries[0]?.dead, true)
    assert.equal(doc.providers.fake.entries[0]?.deadReason, 'billing')
    assert.deepEqual(readdirSync(dir), ['state.json'])
    if (process.platform !== 'win32') {
      assert.equal(statSync(path).mode & 0o777, 0o600)
    }
  })
})
