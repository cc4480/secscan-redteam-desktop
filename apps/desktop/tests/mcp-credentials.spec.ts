/** First-run MCP credentials: persistence, masking, and the environment the Host inherits. */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopNodeEnvironment } from '../src/node-environment.ts'
import {
  MCP_CREDENTIAL_FILENAME,
  MCP_ENVIRONMENT_NAMES,
  clearStoredMcpCredentials,
  isMcpEndpoint,
  isMcpTokenValue,
  loadStoredMcpCredentials,
  maskMcpCredential,
  mcpCredentialFile,
  mcpSetupRequired,
  normalizeMcpCredentialDraft,
  plainMcpSecretProtector,
  readStoredMcpCredentials,
  writeStoredMcpCredentials,
  type McpCredentialDraft,
  type McpEnvironmentName,
  type McpSecretProtector,
} from '../src/mcp-credentials.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const SECSCAN = 'ssk_desktop-test-token-0001'
const RUNNER = 'runner-desktop-test-token-0002'
const rotated = 'ssk_desktop-test-token-0002'

const roots: string[] = []
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mcp-credentials-'))
  roots.push(root)
  return { root, file: mcpCredentialFile(root) }
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A protector with a real round trip, so a cross-protector document can be exercised. */
const protectedSecrets: McpSecretProtector = {
  kind: 'safeStorage',
  protect: value => Buffer.from(value, 'utf8').toString('base64'),
  unprotect: value => Buffer.from(value, 'base64').toString('utf8'),
}

const draft = (values: Partial<McpCredentialDraft> = {}): McpCredentialDraft => ({
  secscan: null, runner: null, endpoint: null, ...values,
})

async function stored(environment: NodeJS.ProcessEnv, file: string, installed = new Set<McpEnvironmentName>()) {
  return loadStoredMcpCredentials(environment, file, plainMcpSecretProtector, installed)
}

describe('mcp credential document', () => {
  it('lands inside the installation profile under its own basename', () => {
    expect(mcpCredentialFile(join('C:', 'profile'))).toBe(join('C:', 'profile', MCP_CREDENTIAL_FILENAME))
  })

  it('stores, reads back, and merges one token at a time', async () => {
    const { root, file } = workspace()
    expect(await writeStoredMcpCredentials(file, plainMcpSecretProtector, draft({ secscan: SECSCAN, endpoint: 'http://127.0.0.1:8787/mcp' }))).toBe(true)
    expect(await readStoredMcpCredentials(file, plainMcpSecretProtector)).toEqual({
      values: { SECSCAN_MCP_TOKEN: SECSCAN, REDTEAM_MCP_URL: 'http://127.0.0.1:8787/mcp' },
      fingerprints: { SECSCAN_MCP_TOKEN: maskMcpCredential(SECSCAN) },
      exists: true,
      declined: false,
    })
    expect(await writeStoredMcpCredentials(file, plainMcpSecretProtector, draft({ runner: RUNNER }))).toBe(true)
    const merged = await readStoredMcpCredentials(file, plainMcpSecretProtector)
    expect(merged.values).toEqual({ SECSCAN_MCP_TOKEN: SECSCAN, REDTEAM_UI_TOKEN: RUNNER, REDTEAM_MCP_URL: 'http://127.0.0.1:8787/mcp' })
    // The document carries the mask next to the value, so an operator can audit which token is stored.
    const document = JSON.parse(readFileSync(file, 'utf8')) as { credentials: Record<string, { fingerprint: string }> }
    expect(document.credentials.SECSCAN_MCP_TOKEN!.fingerprint).toBe(maskMcpCredential(SECSCAN))
    expect(join(root, MCP_CREDENTIAL_FILENAME)).toBe(file)
  })

  it.runIf(process.platform !== 'win32')('creates the profile directory and document owner-only', async () => {
    const { root } = workspace()
    const directory = join(root, 'nested')
    const nested = mcpCredentialFile(directory)
    expect(await writeStoredMcpCredentials(nested, plainMcpSecretProtector, draft({ secscan: SECSCAN }))).toBe(true)
    expect(statSync(nested).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(nested)).mode & 0o077).toBe(0)
  })

  it('reports a missing, corrupt, or unfamiliar document without failing', async () => {
    const { file } = workspace()
    expect(await readStoredMcpCredentials(file, plainMcpSecretProtector)).toEqual({ values: {}, fingerprints: {}, exists: false, declined: false })
    writeFileSync(file, 'not json at all')
    expect(await readStoredMcpCredentials(file, plainMcpSecretProtector)).toMatchObject({ values: {}, exists: true, declined: false })
    writeFileSync(file, JSON.stringify({ version: 2, protection: 'plain', credentials: { SECSCAN_MCP_TOKEN: { value: SECSCAN } } }))
    expect(await readStoredMcpCredentials(file, plainMcpSecretProtector)).toMatchObject({ values: {}, exists: true })
  })

  it('keeps a value this host cannot open out of the environment and out of every log', async () => {
    const { root, file } = workspace()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await writeStoredMcpCredentials(file, protectedSecrets, draft({ secscan: SECSCAN }))).toBe(true)
    const environment: NodeJS.ProcessEnv = {}
    const installed = new Set<McpEnvironmentName>()
    const crosshost = await loadStoredMcpCredentials(environment, file, plainMcpSecretProtector, installed)
    expect(crosshost.values).toEqual({})
    expect(crosshost.exists).toBe(true)
    // The mask is metadata and survives; the ciphertext never becomes a bearer token.
    expect(crosshost.fingerprints.SECSCAN_MCP_TOKEN).toBe(maskMcpCredential(SECSCAN))
    expect(environment.SECSCAN_MCP_TOKEN).toBeUndefined()
    expect(mcpSetupRequired(environment, crosshost)).toBe(true)

    // A value whose protector refuses to open it - a locked keychain - is dropped the same way.
    const locked: McpSecretProtector = { kind: 'plain', protect: value => value, unprotect: () => { throw new Error('keychain is locked') } }
    const plainFile = mcpCredentialFile(join(root, 'plain'))
    await writeStoredMcpCredentials(plainFile, plainMcpSecretProtector, draft({ secscan: SECSCAN }))
    expect(await readStoredMcpCredentials(plainFile, locked)).toMatchObject({ values: {}, exists: true })
    // The name, never the value: this assertion is what keeps a token out of the diagnostics.
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).not.toContain(SECSCAN)
    expect(logged).toContain('SECSCAN_MCP_TOKEN')
  })

  it('reports an unwritable location instead of throwing', async () => {
    const { root } = workspace()
    const blocker = join(root, 'profile')
    writeFileSync(blocker, 'a file where the profile directory belongs')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await writeStoredMcpCredentials(mcpCredentialFile(blocker), plainMcpSecretProtector, draft({ secscan: SECSCAN }))).toBe(false)
    expect(warn.mock.calls.flat().join(' ')).not.toContain(SECSCAN)
  })

  it('removes the document for revocation', async () => {
    const { file } = workspace()
    await writeStoredMcpCredentials(file, plainMcpSecretProtector, draft({ secscan: SECSCAN }))
    expect(await clearStoredMcpCredentials(file)).toBe(true)
    expect(await readStoredMcpCredentials(file, plainMcpSecretProtector)).toMatchObject({ values: {}, exists: false })
    expect(await clearStoredMcpCredentials(file)).toBe(true)
  })
})

describe('first-run environment', () => {
  it('carries a stored token into exactly the child environment the Host is spawned with', async () => {
    const { file } = workspace()
    const environment: NodeJS.ProcessEnv = {}
    await writeStoredMcpCredentials(file, plainMcpSecretProtector, draft({ secscan: SECSCAN, runner: RUNNER }))
    await stored(environment, file)
    expect(environment.SECSCAN_MCP_TOKEN).toBe(SECSCAN)
    expect(environment.REDTEAM_UI_TOKEN).toBe(RUNNER)
    // DesktopHostProcess.start builds its spawn environment through this function.
    const child = desktopNodeEnvironment('electron', undefined, environment)
    expect(child.SECSCAN_MCP_TOKEN).toBe(SECSCAN)
    expect(child.REDTEAM_UI_TOKEN).toBe(RUNNER)
    expect(child.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('reads the same names the bundled red-team patch composes from', () => {
    const patch = readFileSync(join(repository, 'packages', 'redteam', 'desktop-bundle', 'cordis.patch.yml'), 'utf8')
    // The patch's `!!js` scalars are evaluated against the Host process environment at composition
    // time, so the names this module persists and the names the rows read have to be the same ones.
    for (const name of MCP_ENVIRONMENT_NAMES) expect(patch).toContain(`process.env.${name}`)
  })

  it('leaves an inherited environment alone and still loads the missing names', async () => {
    const { file } = workspace()
    await writeStoredMcpCredentials(file, plainMcpSecretProtector, draft({ secscan: SECSCAN, runner: RUNNER }))
    const environment: NodeJS.ProcessEnv = { SECSCAN_MCP_TOKEN: 'from-the-launch-environment' }
    const installed = new Set<McpEnvironmentName>()
    await stored(environment, file, installed)
    expect(environment.SECSCAN_MCP_TOKEN).toBe('from-the-launch-environment')
    expect(environment.REDTEAM_UI_TOKEN).toBe(RUNNER)
    expect([...installed]).toEqual(['REDTEAM_UI_TOKEN'])
    expect(mcpSetupRequired(environment, await readStoredMcpCredentials(file, plainMcpSecretProtector))).toBe(false)
  })

  it('replaces a stored token on rotation and revokes it without touching an inherited one', async () => {
    const { file } = workspace()
    const environment: NodeJS.ProcessEnv = {}
    const installed = new Set<McpEnvironmentName>()
    await writeStoredMcpCredentials(file, plainMcpSecretProtector, draft({ secscan: SECSCAN, runner: RUNNER }))
    await stored(environment, file, installed)
    await writeStoredMcpCredentials(file, plainMcpSecretProtector, draft({ secscan: rotated }))
    await stored(environment, file, installed)
    expect(environment.SECSCAN_MCP_TOKEN).toBe(rotated)
    expect(environment.REDTEAM_UI_TOKEN).toBe(RUNNER)
    expect(installed.has('SECSCAN_MCP_TOKEN')).toBe(true)

    await clearStoredMcpCredentials(file)
    await stored(environment, file, installed)
    expect(environment.SECSCAN_MCP_TOKEN).toBeUndefined()
    expect(installed.size).toBe(0)

    const inherited: NodeJS.ProcessEnv = { REDTEAM_UI_TOKEN: 'from-the-launch-environment' }
    await stored(inherited, file)
    expect(inherited.REDTEAM_UI_TOKEN).toBe('from-the-launch-environment')
  })

  it('asks for setup only while no token is available and the step was not declined', async () => {
    const { file } = workspace()
    const fresh = await readStoredMcpCredentials(file, plainMcpSecretProtector)
    expect(mcpSetupRequired({}, fresh)).toBe(true)
    expect(mcpSetupRequired({ SECSCAN_MCP_TOKEN: SECSCAN }, fresh)).toBe(false)
    expect(mcpSetupRequired({ REDTEAM_UI_TOKEN: RUNNER }, fresh)).toBe(false)

    await writeStoredMcpCredentials(file, plainMcpSecretProtector, draft({ secscan: SECSCAN }))
    const configured = await readStoredMcpCredentials(file, plainMcpSecretProtector)
    expect(mcpSetupRequired({}, configured)).toBe(false)

    // Declining records the decision, keeps what was already stored, and does not ask again.
    expect(await writeStoredMcpCredentials(file, plainMcpSecretProtector, draft(), true)).toBe(true)
    const declined = await readStoredMcpCredentials(file, plainMcpSecretProtector)
    expect(declined).toMatchObject({ declined: true, values: { SECSCAN_MCP_TOKEN: SECSCAN } })
    expect(mcpSetupRequired({}, declined)).toBe(false)

    // Storing a token after a decline clears it: the step is answered, not merely dismissed.
    await writeStoredMcpCredentials(file, plainMcpSecretProtector, draft({ runner: RUNNER }))
    expect(await readStoredMcpCredentials(file, plainMcpSecretProtector)).toMatchObject({ declined: false })

    // A document that yields nothing usable asks again rather than staying silently absent.
    const other = workspace()
    await writeStoredMcpCredentials(other.file, plainMcpSecretProtector, draft({ endpoint: 'https://console.example.test/mcp' }))
    const endpointOnly = await readStoredMcpCredentials(other.file, plainMcpSecretProtector)
    expect(endpointOnly.values).toEqual({ REDTEAM_MCP_URL: 'https://console.example.test/mcp' })
    expect(mcpSetupRequired({}, endpointOnly)).toBe(true)
  })
})

describe('setup form values', () => {
  it('accepts a real token and rejects the ways one arrives wrong', () => {
    expect(isMcpTokenValue(`  ${SECSCAN}  `)).toBe(true)
    expect(isMcpTokenValue(RUNNER)).toBe(true)
    for (const value of ['', 'short', 'has space', '密钥-token-value', 'SECSCAN_MCP_TOKEN=ssk_value', '"ssk_quoted-value"', '\'ssk_quoted-value\'', '`ssk_quoted-value`']) {
      expect(isMcpTokenValue(value), value).toBe(false)
    }
  })

  it('allows plain HTTP only for a loopback console', () => {
    expect(isMcpEndpoint('http://127.0.0.1:8787/mcp')).toBe(true)
    expect(isMcpEndpoint('http://localhost:8787/mcp')).toBe(true)
    expect(isMcpEndpoint('https://console.example.test/mcp')).toBe(true)
    for (const value of ['', 'not a url', 'http://console.example.test/mcp', 'http://10.0.0.5:8787/mcp', 'https://user:secret@console.example.test/mcp', 'file:///mcp']) {
      expect(isMcpEndpoint(value), value).toBe(false)
    }
  })

  it('normalizes a draft without inventing values', () => {
    expect(normalizeMcpCredentialDraft({ secscan: ` ${SECSCAN} `, runner: '', endpoint: '' })).toEqual({ secscan: SECSCAN, runner: null, endpoint: null })
    expect(normalizeMcpCredentialDraft({ secscan: '', runner: RUNNER, endpoint: 'https://console.example.test/mcp' }))
      .toEqual({ secscan: null, runner: RUNNER, endpoint: 'https://console.example.test/mcp' })
    expect(normalizeMcpCredentialDraft({ secscan: 'SECSCAN_MCP_TOKEN=ssk_value', runner: '', endpoint: '' })).toBeUndefined()
    expect(normalizeMcpCredentialDraft({ secscan: '', runner: '', endpoint: 'http://evil.example.test/mcp' })).toBeUndefined()
  })

  it('masks a token down to a fingerprint an operator can recognize', () => {
    expect(maskMcpCredential(SECSCAN)).toBe('ssk_…0001')
    expect(maskMcpCredential(SECSCAN)).not.toContain('desktop-test')
    expect(maskMcpCredential('short')).toBe('••••')
    expect(maskMcpCredential(SECSCAN).length).toBeLessThan(SECSCAN.length)
  })
})
