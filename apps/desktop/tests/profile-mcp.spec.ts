/** MCP resource ownership in the shipped Desktop composition. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { interpolate, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
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
  // This fork deliberately composes two MCP clients alongside that single
  // shared resource consumer: mcp-redteam-runner (the local engagement
  // console) and mcp-alterego (the operator's PC bridge) — the two
  // documented DE-MCP exceptions. Upstream shipped none.
  expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-client').map(row => row.id)).toEqual([
    'mcp-redteam-runner',
    'mcp-alterego',
  ])
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
