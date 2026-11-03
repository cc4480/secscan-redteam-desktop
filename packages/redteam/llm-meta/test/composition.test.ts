/**
 * REAL-composition test (packages/AGENTS.md): the unit suites prove what
 * the adapter registers and returns, but not that the plugin composes.
 * This suite boots a test-only cordis.yml through the real Cordis Loader
 * with the real `LlmRuntime` and this plugin — resolved by name through
 * Node module resolution, exactly as the desktop bundle's row resolves
 * them — and asserts the model-visible output: the Host model catalog
 * built by `buildModelCatalog` (the `session/modelCatalog` RPC's own
 * builder) carries the Meta group with the four Meta models, with no
 * credential seated anywhere. A second suite proves the registration
 * disposes with the plugin fiber and that dispatch through the runtime,
 * with a fake credentials service seating a fake key and a mocked
 * endpoint, streams and reports usage.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialKey, CredentialRecord, CredentialRecordEntry, CredentialRecordInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { buildModelCatalog } from '@deepseek-ai/dsh-api-session-controller'
import * as llmMeta from '../src/index.js'
import { META_MODELS } from '../src/index.js'

/** Fake key the fixture credentials service seats; never a real credential. */
const FAKE_KEY = 'fake-meta-key-for-tests'

/** Fake credentials service: resolves every reference to the fake key. */
class FakeCredentials extends CredentialProvider {
  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(String(ref) === 'MODEL_API_KEY' ? { value: FAKE_KEY, source: 'fake' } : undefined)
  }

  override describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.reject(new Error('describe is not exercised by this suite'))
  }

  override set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.reject(new Error('set is not exercised by this suite'))
  }

  override unset(_ref: CredentialRef): Promise<void> {
    return Promise.reject(new Error('unset is not exercised by this suite'))
  }

  override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: false })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  override modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return Promise.reject(new Error('modifyRecord is not exercised by this suite'))
  }

  override deleteRecord(_key: CredentialKey): Promise<void> {
    return Promise.resolve()
  }
}

describe('llm-meta real Loader composition', () => {
  it('seats the Meta group in the Host model catalog with no key seated', async () => {
    const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
    const root = await mkdtemp(join(packageRoot, '.composition-'))
    const context = new Context()
    try {
      const configPath = join(root, 'cordis.yml')
      await writeFile(configPath, [
        "- name: '@deepseek-ai/dsh-llm'",
        "- name: '@secscan/redteam-llm-meta'",
        '',
      ].join('\n'))

      context.baseUrl = pathToFileURL(root).href + '/'
      await context.plugin(Loader)
      context.loader.builtins.include = Include
      await context.loader.create({
        name: 'cordis:include',
        config: { path: pathToFileURL(configPath).href },
      })
      await context.loader.await()

      assert.ok(context.llm.listProviders().map(provider => provider.id).includes('meta'))
      const catalog = await buildModelCatalog(context, { provider: 'meta', model: 'muse-spark-1.3' })
      const metaGroup = catalog.groups.find(group => group.id === 'meta')
      assert.ok(metaGroup !== undefined, `Meta group missing from: ${catalog.groups.map(group => group.id).join(', ')}`)
      assert.equal(metaGroup.name, 'Meta')
      assert.deepEqual(metaGroup.models.map(model => model.id), META_MODELS.map(model => model.id))
      assert.deepEqual(catalog.default, { provider: 'meta', model: 'muse-spark-1.3' })
      assert.ok(catalog.routableProviders.includes('meta'))
    } finally {
      await context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('llm-meta plugin lifecycle and dispatch', () => {
  it('registers on apply, disposes with the fiber, and streams through the runtime with a seated fake key', async () => {
    const context = new Context()
    const realFetch = globalThis.fetch
    const requests: { url: string; init: RequestInit }[] = []
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} })
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    try {
      await context.plugin(LlmRuntime)
      await context.plugin(FakeCredentials)
      const fiber = await context.plugin(llmMeta, {})
      assert.ok(context.llm.listProviders().map(provider => provider.id).includes('meta'))
      const models = await context.llm.listModels('meta')
      assert.deepEqual(models.map(model => model.id), META_MODELS.map(model => model.id))

      const chunks: StreamChunk[] = []
      for await (const chunk of context.llm.stream({
        provider: 'meta',
        model: 'muse-spark-1.3',
        messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Say hello.' }] })],
      })) chunks.push(chunk)

      assert.equal(requests.length, 1)
      assert.equal(requests[0]?.url, 'https://api.meta.ai/v1/chat/completions')
      const headers = requests[0]?.init.headers as Record<string, string>
      assert.equal(headers['authorization'], `Bearer ${FAKE_KEY}`)
      const text = chunks
        .filter((chunk): chunk is Extract<StreamChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
        .map(chunk => chunk.text)
        .join('')
      assert.equal(text, 'Hello')
      const usage = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage')
      assert.ok(usage !== undefined)
      assert.deepEqual(usage.usage, { inputTokens: 5, outputTokens: 2, totalTokens: 7 })

      await fiber.dispose()
      assert.ok(!context.llm.listProviders().map(provider => provider.id).includes('meta'))
    } finally {
      globalThis.fetch = realFetch
      await context.fiber.dispose()
    }
  })
})
