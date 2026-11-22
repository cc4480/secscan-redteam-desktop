/**
 * M0 acceptance: the authorization decision on the shipped chat launch path.
 *
 * Every case drives the real MCP tool list (`TOOLS_BY_NAME` from
 * ui/mcp-tools.ts): `engagement_launch` -> handleLaunch -> runEngagement ->
 * authorizePhase -> checkAuthorization, which reads the verified-domain store
 * selected by REDTEAM_VERIFIED_DOMAINS_FILE. No verifier is injected (no
 * `deps.verify`), and REDTEAM_TEST_MODE is unset except in the fence cases.
 *
 * The launches pass `dryRun: true`, which sets `dryRunAgents`: the authorize
 * phase runs unchanged, and every later phase (plan, sign-off, recon, exploit,
 * peer review, report) takes its dry-run branch instead of an agent loop, so
 * no model is called. Model provider keys are removed from the environment and
 * `globalThis.fetch` is replaced with a recorder that rejects, so a model or
 * network call would surface as a recorded fetch.
 *
 * The verify_domain_list case writes its record through LocalDomainVerifier
 * with a stub `resolveTxt` that answers with the issued token. That stub is the
 * only fake in this file.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalDomainVerifier, SERVER_TOKEN_PREFIX, writeFileAtomic, type StoreDoc } from '@secscan/redteam-auth-gate'
import { TOOLS_BY_NAME, type Captured, type ToolDef } from '../src/ui/mcp-tools.js'
import { UiStore, engagementDir } from '../src/ui/store.js'
import { readEvents } from '../src/events.js'
import type { EngagementEvent } from '../src/types.js'

/** Environment keys this file controls; each is restored after every case. */
const CONTROLLED_ENV = [
  'REDTEAM_VERIFIED_DOMAINS_FILE',
  'REDTEAM_TEST_MODE',
  'REDTEAM_LOCAL_SANDBOX',
  'DEEPSEEK_API_KEY',
  'MODEL_API_KEY',
  'META_API_KEY',
  'REDTEAM_LLM_PROVIDER',
] as const

const REMEDIATION =
  'domain acme.example is not ownership-verified in the local app store. ' +
  'Run verify_domain_start for acme.example, publish the TXT record at ' +
  '_secscan-challenge.acme.example, then run verify_domain_check.'

let dir = ''
let storeFile = ''
let store: UiStore
let savedEnv: Map<string, string | undefined>
let savedFetch: typeof globalThis.fetch
let fetchCalls: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'm0-acceptance-'))
  storeFile = join(dir, 'verified-domains.json')
  store = new UiStore(join(dir, 'engagements'))
  savedEnv = new Map(CONTROLLED_ENV.map(k => [k, process.env[k]]))
  for (const k of CONTROLLED_ENV) delete process.env[k]
  process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = storeFile
  savedFetch = globalThis.fetch
  fetchCalls = []
  globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
    fetchCalls.push(input instanceof Request ? input.url : String(input))
    return Promise.reject(new Error('m0-acceptance: network is not available to this test'))
  }
})

afterEach(() => {
  globalThis.fetch = savedFetch
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(dir, { recursive: true, force: true })
})

function tool(name: string): ToolDef {
  const t = TOOLS_BY_NAME.get(name)
  assert.ok(t, `${name} is registered on the MCP tool list`)
  return t
}

/** Seed the store with canonical StoreDoc records, written the way the app writes them. */
async function seedVerified(...domains: string[]): Promise<void> {
  const doc: StoreDoc = { version: 1, pending: {}, verified: {} }
  for (const d of domains) {
    doc.verified[d] = { token: `${SERVER_TOKEN_PREFIX}${randomBytes(16).toString('hex')}`, verifiedAt: new Date().toISOString(), method: 'dns-txt' }
  }
  await writeFileAtomic(storeFile, `${JSON.stringify(doc, null, 2)}\n`)
}

interface LaunchOutcome {
  launch: Captured
  status: Record<string, unknown>
  events: EngagementEvent[]
}

/**
 * Launch through engagement_launch, wait for the detached run to settle, then
 * read the outcome through engagement_status and the engagement's event log.
 */
async function launchAndSettle(target: string): Promise<LaunchOutcome> {
  const launch = await tool('engagement_launch').run(store, {
    target,
    objective: 'M0 acceptance: authorization decision only',
    operatorName: 'M0 Acceptance Operator',
    dryRun: true,
  })
  assert.equal(launch.status, 202, JSON.stringify(launch.body))
  const id = (launch.body as { id?: string }).id ?? ''
  assert.ok(id, 'launch returns an engagement id')
  const deadline = Date.now() + 120_000
  while (store.get(id)?.running === true) {
    assert.ok(Date.now() < deadline, `engagement ${id} did not settle within 120s`)
    await new Promise(r => setTimeout(r, 50))
  }
  const rec = store.get(id)
  assert.equal(rec?.error, undefined, `run threw instead of deciding: ${String(rec?.error)}`)
  const statusOut = await tool('engagement_status').run(store, { id })
  assert.equal(statusOut.status, 200, JSON.stringify(statusOut.body))
  const stateDir = engagementDir(store.engagementsDir, id)
  assert.ok(stateDir, 'engagement directory exists')
  return { launch, status: statusOut.body as Record<string, unknown>, events: readEvents(stateDir, 0, 10_000) }
}

function actions(events: EngagementEvent[], phase: string): string[] {
  return events.filter(e => e.phase === phase).map(e => e.action)
}

/** The run passed authorization and every later phase took its no-model dry-run branch. */
function assertStoppedBeforeAnyModel(events: EngagementEvent[]): void {
  const results = events.map(e => e.result)
  assert.ok(results.includes('dry-run: planning skipped.'), 'plan phase took the dry-run branch')
  assert.ok(results.includes('dry-run: recon skipped.'), 'recon phase took the dry-run branch')
  assert.ok(results.includes('dry-run: exploitation skipped.'), 'exploit phase took the dry-run branch')
  assert.deepEqual(fetchCalls, [], 'no fetch (model or network) call was made')
}

describe('M0 acceptance — launch authorization on the real MCP tool path', () => {
  it('case 1: a seeded canonical record for acme.example authorizes the launch', async () => {
    await seedVerified('acme.example')
    const { status, events } = await launchAndSettle('https://acme.example')

    assert.equal(status['verified'], true)
    assert.notEqual(status['status'], 'blocked')
    assert.equal(status['blockedReason'], undefined)
    const authorize = actions(events, 'authorize')
    assert.ok(authorize.includes('authorization_basis'), `authorize events: ${authorize.join(', ')}`)
    assert.equal(authorize.includes('authorization_denied'), false)
    assert.equal(authorize.includes('scope_authorization_denied'), false)
    assert.equal(authorize.includes('test_mode_active'), false)
    const basis = events.find(e => e.action === 'authorization_basis')
    assert.match(basis?.result ?? '', /^acme\.example is verified in the local app store \(DNS TXT challenge\)\./)
    assertStoppedBeforeAnyModel(events)
  })

  it('case 2: an empty store refuses acme.example with the verification remediation', async () => {
    const { status, events } = await launchAndSettle('https://acme.example')

    assert.equal(status['status'], 'blocked')
    assert.notEqual(status['verified'], true)
    assert.match(String(status['blockedReason']), new RegExp(`^${REMEDIATION.replace(/[.]/g, '\\.')}`))
    const authorize = actions(events, 'authorize')
    assert.ok(authorize.includes('authorization_denied'), `authorize events: ${authorize.join(', ')}`)
    assert.equal(authorize.includes('authorization_basis'), false)
    assert.deepEqual(fetchCalls, [])
  })

  it('case 3: verify_domain_list lists a record freshly written by LocalDomainVerifier', async () => {
    let published = ''
    const verifier = new LocalDomainVerifier({
      storePath: storeFile,
      readFile: p => readFile(p, 'utf8'),
      writeFile: writeFileAtomic,
      mkdir: async () => {},
      // The one fake: DNS answers with the token the verifier issued.
      resolveTxt: async name => (name === '_secscan-challenge.fresh.example' && published ? [[published]] : []),
      newToken: () => `${SERVER_TOKEN_PREFIX}${randomBytes(16).toString('hex')}`,
    })
    const challenge = await verifier.startVerification('https://fresh.example')
    assert.equal(challenge.recordName, '_secscan-challenge.fresh.example')

    const before = await tool('verify_domain_list').run(store, {})
    assert.equal(before.status, 200, JSON.stringify(before.body))
    assert.deepEqual((before.body as { domains?: string[] }).domains, [], 'a pending challenge is not a verified domain')

    published = challenge.token
    assert.equal(await verifier.checkVerification('fresh.example'), true)

    const after = await tool('verify_domain_list').run(store, {})
    assert.equal(after.status, 200, JSON.stringify(after.body))
    assert.deepEqual(after.body, { ok: true, store: storeFile, domains: ['fresh.example'] })
  })

  it('case 4a: REDTEAM_TEST_MODE=1 does not lift verification for a public target', async () => {
    process.env['REDTEAM_TEST_MODE'] = '1'
    const { status, events } = await launchAndSettle('https://acme.example')

    assert.equal(status['status'], 'blocked')
    assert.notEqual(status['verified'], true)
    assert.match(String(status['blockedReason']), new RegExp(`^${REMEDIATION.replace(/[.]/g, '\\.')}`))
    const authorize = actions(events, 'authorize')
    assert.equal(authorize.includes('test_mode_active'), false)
    assert.ok(authorize.includes('authorization_denied'), `authorize events: ${authorize.join(', ')}`)
    assert.equal(authorize.includes('authorization_basis'), false)
    assert.deepEqual(fetchCalls, [])
  })

  it('case 4b: REDTEAM_TEST_MODE=1 lifts verification for an all-loopback engagement', async () => {
    process.env['REDTEAM_TEST_MODE'] = '1'
    const { status, events } = await launchAndSettle('http://127.0.0.1:8080')

    assert.equal(status['verified'], true)
    assert.notEqual(status['status'], 'blocked')
    const authorize = actions(events, 'authorize')
    assert.ok(authorize.includes('test_mode_active'), `authorize events: ${authorize.join(', ')}`)
    assert.equal(authorize.includes('authorization_denied'), false)
    const basis = events.find(e => e.action === 'authorization_basis')
    assert.match(basis?.result ?? '', /^TEST MODE: operator self-attested/)
    assertStoppedBeforeAnyModel(events)
  })

  it('case 5: a corrupt store file refuses the launch and approves nothing', async () => {
    writeFileSync(storeFile, '{"version":1,"verified":{"acme.example":', 'utf8')

    const list = await tool('verify_domain_list').run(store, {})
    assert.equal(list.status, 400, 'the list tool reports the unreadable store as an error')
    assert.equal((list.body as { ok?: boolean }).ok, false)

    const { status, events } = await launchAndSettle('https://acme.example')
    assert.equal(status['status'], 'blocked')
    assert.notEqual(status['verified'], true)
    assert.match(String(status['blockedReason']), new RegExp(`^${REMEDIATION.replace(/[.]/g, '\\.')}`))
    const authorize = actions(events, 'authorize')
    assert.ok(authorize.includes('authorization_denied'), `authorize events: ${authorize.join(', ')}`)
    assert.equal(authorize.includes('authorization_basis'), false)
    assert.deepEqual(fetchCalls, [])
  })
})
