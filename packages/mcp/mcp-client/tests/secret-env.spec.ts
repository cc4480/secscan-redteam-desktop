/**
 * Behavior tests for the stdio `secretEnv` seam: name resolution, load-time
 * validation, and what a spawned child actually observes — GATE C in both
 * directions against a fixture server that reports its own environment:
 * a named, set secret reaches the child, and a set secret the config does
 * not name does not (the ambient scrub would be dead code otherwise).
 */

import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { apply, Config as ConfigSchema } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-client'
import { resolveSecretEnv } from '@deepseek-ai/dsh-mcp-client/src/transport.ts'

const envServerPath = fileURLToPath(new URL('./fixtures/env-report-server.ts', import.meta.url))
const packageDir = fileURLToPath(new URL('..', import.meta.url))

const NAME = 'SECLAYER_API_KEY'
const VALUE = 'dummy-seclayer-value-for-tests'

let savedValue: string | undefined

beforeEach(() => {
  savedValue = process.env[NAME]
})

afterEach(() => {
  if (savedValue === undefined) delete process.env.SECLAYER_API_KEY
  else process.env[NAME] = savedValue
})

describe('resolveSecretEnv', () => {
  it('returns the value of a set name', () => {
    process.env[NAME] = VALUE
    expect(resolveSecretEnv([NAME])).toEqual({ values: { [NAME]: VALUE }, missing: [] })
  })

  it('reports an unset name as missing and injects nothing for it', () => {
    delete process.env.SECLAYER_API_KEY
    expect(resolveSecretEnv([NAME])).toEqual({ values: {}, missing: [NAME] })
  })

  it('treats an empty-string value as missing, never as present-but-blank', () => {
    process.env[NAME] = ''
    expect(resolveSecretEnv([NAME])).toEqual({ values: {}, missing: [NAME] })
  })

  it('resolves a mixed list name by name', () => {
    process.env[NAME] = VALUE
    expect(resolveSecretEnv([NAME, 'SECLAYER_UNSET_PROBE'])).toEqual({
      values: { [NAME]: VALUE },
      missing: ['SECLAYER_UNSET_PROBE'],
    })
  })
})

describe('secretEnv config', () => {
  it('defaults to an empty list and preserves an explicit list through the schema', () => {
    const omitted = ConfigSchema({ transport: 'stdio', serverName: 'srv', command: 'echo' } as never)
    if (omitted.transport !== 'stdio') throw new Error('expected a stdio config')
    expect(omitted.secretEnv).toEqual([])
    const explicit = ConfigSchema({
      transport: 'stdio', serverName: 'srv', command: 'echo', secretEnv: [NAME],
    } as never)
    if (explicit.transport !== 'stdio') throw new Error('expected a stdio config')
    expect(explicit.secretEnv).toEqual([NAME])
  })

  it('serializes names only: the resolved config never contains the value', () => {
    process.env[NAME] = VALUE
    const resolved = ConfigSchema({
      transport: 'stdio', serverName: 'srv', command: 'echo', secretEnv: [NAME],
    } as never)
    const serialized = JSON.stringify(resolved)
    expect(serialized).toContain(NAME)
    expect(serialized).not.toContain(VALUE)
  })

  it('rejects an invalid env name at apply, naming the entry', async () => {
    const ctx = new Context()
    await expect(apply(ctx, {
      transport: 'stdio', serverName: 'srv', command: 'echo', args: [], env: {}, secretEnv: ['NOT-A-NAME'],
      cwd: '', toolCallTimeoutMs: 60_000, failOnStartupError: false,
    })).rejects.toThrow(/secretEnv entry "NOT-A-NAME"/)
  })

  it('rejects a duplicate env name at apply, naming the entry', async () => {
    const ctx = new Context()
    await expect(apply(ctx, {
      transport: 'stdio', serverName: 'srv', command: 'echo', args: [], env: {}, secretEnv: [NAME, NAME],
      cwd: '', toolCallTimeoutMs: 60_000, failOnStartupError: false,
    })).rejects.toThrow(/secretEnv entry "SECLAYER_API_KEY" is listed more than once/)
  })
})

let callSeq = 0

async function reportFromChild(partial: Partial<Config>, probe: string, warns?: string[]): Promise<string> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (warns) {
    ctx.logger.warn = ((message: unknown) => { warns.push(String(message)) }) as typeof ctx.logger.warn
  }
  const config: Config = {
    transport: 'stdio',
    command: process.execPath,
    args: [envServerPath],
    env: {},
    secretEnv: [],
    cwd: packageDir,
    toolCallTimeoutMs: 15_000,
    failOnStartupError: true,
    ...partial,
  }
  if (config.transport !== 'stdio') throw new Error('expected a stdio config')
  try {
    await apply(ctx, config)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId(`secret-env-${++callSeq}`),
      name: `mcp__${config.serverName}__report_env`,
      arguments: { name: probe },
    })
    expect(result.isError).toBe(false)
    const block = result.content[0]
    if (block?.type !== 'text') throw new Error(`expected a text content block, got ${JSON.stringify(block)}`)
    return block.text
  } finally {
    await ctx.fiber.dispose()
  }
}

describe('secretEnv delivery to a spawned child (GATE C)', () => {
  it('delivers a named, set secret to the child', async () => {
    process.env[NAME] = VALUE
    const text = await reportFromChild({ serverName: 'envnamed', secretEnv: [NAME] }, NAME)
    expect(text).toBe(`present:${VALUE}`)
  }, 30_000)

  it('does not deliver a set secret the config does not name (the scrub holds)', async () => {
    process.env[NAME] = VALUE
    const text = await reportFromChild({ serverName: 'envunnamed', secretEnv: [] }, NAME)
    expect(text).toBe('absent')
  }, 30_000)

  it('starts the child without a named-but-unset secret and warns once, naming it', async () => {
    delete process.env.SECLAYER_API_KEY
    const warns: string[] = []
    const text = await reportFromChild({ serverName: 'envunset', secretEnv: [NAME] }, NAME, warns)
    expect(text).toBe('absent')
    const secretWarns = warns.filter(w => w.includes('secretEnv'))
    expect(secretWarns).toHaveLength(1)
    expect(secretWarns[0]).toContain(NAME)
  }, 30_000)

  it('does not inject a named-but-empty secret as a present-but-blank value', async () => {
    process.env[NAME] = ''
    const text = await reportFromChild({ serverName: 'envempty', secretEnv: [NAME] }, NAME)
    expect(text).toBe('absent')
  }, 30_000)

  it('lets a named secret win over a same-named env literal', async () => {
    process.env[NAME] = VALUE
    const text = await reportFromChild(
      { serverName: 'envwins', secretEnv: [NAME], env: { [NAME]: 'from-config-env' } }, NAME)
    expect(text).toBe(`present:${VALUE}`)
  }, 30_000)
})
