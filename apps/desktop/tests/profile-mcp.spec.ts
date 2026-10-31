/** MCP resource ownership in the shipped Desktop composition. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
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
  // This fork deliberately composes three MCP clients alongside that single
  // shared resource consumer: mcp-secscan (the SecScan scan service),
  // mcp-seclayer (the Seclayer scan service), and mcp-redteam-runner (the
  // local engagement console). Upstream shipped none.
  expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-client').map(row => row.id)).toEqual([
    'mcp-secscan',
    'mcp-seclayer',
    'mcp-redteam-runner',
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
  expect(rows.find(row => row.id === 'webserver')).toMatchObject({ name: '@deepseek-ai/dsh-host-webserver' })
  expect(rows.find(row => row.id === 'webserver')?.disabled).not.toBe(true)
  expect(warnings).toEqual([])
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
