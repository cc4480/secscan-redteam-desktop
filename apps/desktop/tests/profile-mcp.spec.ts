/** MCP resource ownership in the shipped Desktop composition. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { interpolate, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { composeEntries, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { createPluginProfile } from '../src/project-manager.ts'

function composeDesktopRows(): { rows: EntryOptions[]; warnings: string[] } {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-mcp-'))
  try {
    const profileDir = join(home, 'profiles', 'desktop')
    createPluginProfile(profileDir)
    const installAnchor = fileURLToPath(new URL('../../cli/package.json', import.meta.url))
    const profile = loadProfileDirectory('dsh desktop', profileDir, installAnchor)
    const warnings: string[] = []
    const rows = composeEntries([
      ...profile.layers.map(layer => layer.patches),
      profile.patches,
    ], message => warnings.push(message))
    return { rows, warnings }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

it('keeps one shared resource consumer beside the fork MCP clients', () => {
  const { rows, warnings } = composeDesktopRows()

  expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-resources')).toEqual([
    { id: 'mcp-resources', name: '@deepseek-ai/dsh-mcp-resources' },
  ])
  // This fork deliberately composes four MCP clients alongside that single
  // shared resource consumer: mcp-secscan (the SecScan scan service),
  // mcp-seclayer (the Seclayer scan service), mcp-redteam-runner (the
  // local engagement console), and mcp-alterego (the operator's PC
  // bridge). Upstream shipped none.
  expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-client').map(row => row.id)).toEqual([
    'mcp-secscan',
    'mcp-seclayer',
    'mcp-redteam-runner',
    'mcp-alterego',
  ])
  // The Seclayer row composes as the production row, not a stub: stdio
  // transport, the pinned server package, and the operator's key named —
  // never valued — in secretEnv.
  expect(rows.find(row => row.id === 'mcp-seclayer')?.config).toMatchObject({
    serverName: 'seclayer',
    transport: 'stdio',
    args: ['-y', '@seclayer/mcp@1.0.0'],
    secretEnv: ['SECLAYER_API_KEY'],
  })
  // The engagement engine is not optional in the shipped profile: a failed
  // initial connection must reject this row instead of silently leaving the
  // chat without redteam tools, and its reconnect budget must not give up.
  expect(rows.find(row => row.id === 'mcp-redteam-runner')?.config).toMatchObject({
    serverName: 'redteam',
    transport: 'streamable-http',
    failOnStartupError: true,
    reconnect: {
      enabled: true,
      maxAttempts: Number.MAX_SAFE_INTEGER,
    },
  })
  // AlterEgo is the deliberate opposite of the runner row: the bridge is a
  // peripheral on the operator's machine, so its absence must NOT fail
  // startup. failOnStartupError is pinned false here so the choice reads
  // as a decision, not an omission (see the row's comment in the bundle
  // patch).
  expect(rows.find(row => row.id === 'mcp-alterego')?.config).toMatchObject({
    serverName: 'alterego',
    transport: 'streamable-http',
    failOnStartupError: false,
    reconnect: {
      enabled: true,
      maxAttempts: Number.MAX_SAFE_INTEGER,
    },
  })
  expect(rows.find(row => row.id === 'webserver')).toMatchObject({ name: '@deepseek-ai/dsh-host-webserver' })
  expect(rows.find(row => row.id === 'webserver')?.disabled).not.toBe(true)
  expect(warnings).toEqual([])
})

describe('the composed AlterEgo row', () => {
  // The row resolves its endpoint and bearer header from the bridge
  // environment at composition time, mirroring the runner's own bridge
  // client (apps/redteam-runner/src/bridge/config.ts): PC_BRIDGE_URL is a
  // BASE url (bare origin gets /mcp appended, a pathed URL is used as
  // given, a malformed value falls back to the loopback default), and the
  // session token is read from the FILE named by PC_BRIDGE_TOKEN_FILE -
  // never from an env value.
  function withBridgeEnv<T>(vars: { url?: string; tokenFile?: string }, run: () => T): T {
    const savedUrl = process.env.PC_BRIDGE_URL
    const savedTokenFile = process.env.PC_BRIDGE_TOKEN_FILE
    try {
      if (vars.url === undefined) delete process.env.PC_BRIDGE_URL
      else process.env.PC_BRIDGE_URL = vars.url
      if (vars.tokenFile === undefined) delete process.env.PC_BRIDGE_TOKEN_FILE
      else process.env.PC_BRIDGE_TOKEN_FILE = vars.tokenFile
      return run()
    } finally {
      if (savedUrl === undefined) delete process.env.PC_BRIDGE_URL
      else process.env.PC_BRIDGE_URL = savedUrl
      if (savedTokenFile === undefined) delete process.env.PC_BRIDGE_TOKEN_FILE
      else process.env.PC_BRIDGE_TOKEN_FILE = savedTokenFile
    }
  }

  function alteregoConfig(vars: { url?: string; tokenFile?: string }): { url: string; headers: Record<string, string> } {
    return withBridgeEnv(vars, () => {
      const { rows, warnings } = composeDesktopRows()
      expect(warnings).toEqual([])
      const row = rows.find(entry => entry.id === 'mcp-alterego')
      if (!row) throw new Error('the composed desktop profile has no mcp-alterego row')
      // Composition keeps !!js values as inert markers; the Loader
      // evaluates them through its own interpolate when the row loads.
      // Run the composed config through that same function so the
      // assertions below pin the values the client will actually use.
      // The row's expressions consult only the process global, which the
      // Loader's evaluate scope provides unchanged.
      return interpolate({}, row.config) as { url: string; headers: Record<string, string> }
    })
  }

  it('defaults to the loopback endpoint with an unpaired header when nothing is configured', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-alterego-row-'))
    try {
      // The token file is pointed at an absent path so the assertion pins
      // the not-paired shape without ever touching a real token file.
      const config = alteregoConfig({ tokenFile: join(root, 'absent-token') })
      expect(config.url).toBe('http://127.0.0.1:8765/mcp')
      expect(config.headers.Authorization).toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('appends /mcp to a bare bridge origin and keeps a pathed URL as given', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-alterego-row-'))
    try {
      const absent = join(root, 'absent-token')
      expect(alteregoConfig({ url: 'http://bridge.example:9999', tokenFile: absent }).url)
        .toBe('http://bridge.example:9999/mcp')
      expect(alteregoConfig({ url: 'http://127.0.0.1:8765/', tokenFile: absent }).url)
        .toBe('http://127.0.0.1:8765/mcp')
      expect(alteregoConfig({ url: 'https://pc.secscan.info/custom', tokenFile: absent }).url)
        .toBe('https://pc.secscan.info/custom')
      // The runner client resolves a malformed base URL to the default
      // endpoint instead of throwing; the row mirrors that.
      expect(alteregoConfig({ url: 'not a url', tokenFile: absent }).url)
        .toBe('http://127.0.0.1:8765/mcp')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reads the bearer token from the named token file, trimmed', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-alterego-row-'))
    try {
      const tokenFile = join(root, 'token')
      writeFileSync(tokenFile, '  dummy-bridge-token-for-tests\n')
      const config = alteregoConfig({ tokenFile })
      expect(config.headers.Authorization).toBe('Bearer dummy-bridge-token-for-tests')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const seclayerFixturePath = fileURLToPath(new URL('./fixtures/seclayer-mcp-fixture.mjs', import.meta.url))

async function withSeclayerKey<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const saved = process.env.SECLAYER_API_KEY
  try {
    if (value === undefined) delete process.env.SECLAYER_API_KEY
    else process.env.SECLAYER_API_KEY = value
    return await run()
  } finally {
    if (saved === undefined) delete process.env.SECLAYER_API_KEY
    else process.env.SECLAYER_API_KEY = saved
  }
}

/**
 * Boot the composed mcp-seclayer row through the real Cordis Loader, with
 * the row's command redirected at the profile layer to the fixture server
 * (the row's own serverName, transport, and secretEnv carry over verbatim).
 * Only the module-resolution seam is stubbed; every plugin is the real one.
 */
async function bootSeclayerRow(): Promise<{ context: Context; root: string }> {
  const { rows } = composeDesktopRows()
  const row = rows.find(entry => entry.id === 'mcp-seclayer')
  if (!row) throw new Error('the composed desktop profile has no mcp-seclayer row')
  const config = row.config as { serverName: string; transport: string; secretEnv: string[] }
  const root = mkdtempSync(join(tmpdir(), 'dsh-seclayer-loader-'))
  const configPath = join(root, 'cordis.yml')
  writeFileSync(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    `    serverName: ${config.serverName}`,
    `    transport: ${config.transport}`,
    `    command: ${process.execPath}`,
    `    args: ['${seclayerFixturePath}']`,
    `    secretEnv: [${config.secretEnv.map(name => `'${name}'`).join(', ')}]`,
    '',
  ].join('\n'))

  const context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-mcp-client', mcpClient],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return { context, root }
}

describe('the composed Seclayer row through the Loader', () => {
  it('registers the three Seclayer tools when a key is seated', async () => {
    await withSeclayerKey('dummy-seclayer-key-for-tests', async () => {
      const { context, root } = await bootSeclayerRow()
      try {
        expect(context.tools.get('mcp__seclayer__seclayer_scan')).toBeDefined()
        expect(context.tools.get('mcp__seclayer__seclayer_list_scans')).toBeDefined()
        expect(context.tools.get('mcp__seclayer__seclayer_get_report')).toBeDefined()
      } finally {
        await context.fiber.dispose()
        rmSync(root, { recursive: true, force: true })
      }
    })
  }, 30_000)

  it('starts the harness with no Seclayer tools when no key is seated', async () => {
    await withSeclayerKey(undefined, async () => {
      const { context, root } = await bootSeclayerRow()
      try {
        const names = context.tools.schemas().map(schema => schema.name)
        expect(names.filter(name => name.startsWith('mcp__seclayer__'))).toEqual([])
      } finally {
        await context.fiber.dispose()
        rmSync(root, { recursive: true, force: true })
      }
    })
  }, 30_000)
})
