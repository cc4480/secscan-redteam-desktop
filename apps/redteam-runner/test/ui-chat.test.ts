/**
 * POST /api/chat route — the operator chat's direct completion path.
 * Full-stack against a stub OpenAI-compatible server standing in for the
 * desktop's llama-server: the local pick dispatches through the real
 * router to the published endpoint, with no credential; a stopped or
 * mismatched local state is refused with 409 before any dispatch.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { handleChat } from '../src/ui/routes/chat.js'

const MODEL_ID = 'acme--qwen-fixture--qwen3-6-35b-a3b-fixture'
const MODEL_FILE = 'Qwen3.6-35B-A3B-Fixture.gguf'

interface Captured {
  status: number
  body: string
}

function fakeRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: '' }
  const res = {
    writeHead(status: number) {
      captured.status = status
      return res
    },
    end(chunk?: string) {
      captured.body = chunk ?? ''
      return res
    },
  }
  return { res: res as unknown as ServerResponse, captured }
}

interface StubCall {
  body: Record<string, unknown>
  authorization: string | undefined
}

describe('POST /api/chat', () => {
  let server: Server
  let baseUrl: string
  let modelsDir: string
  const chatCalls: StubCall[] = []
  const savedBaseUrl = process.env['REDTEAM_LOCAL_BASE_URL']

  function writeState(state: Record<string, unknown>): void {
    writeFileSync(join(modelsDir, 'server-state.json'), JSON.stringify(state))
  }

  function runningState(): Record<string, unknown> {
    return { version: 1, status: 'running', baseUrl, modelId: MODEL_ID, updatedAt: Date.now() }
  }

  before(async () => {
    server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ID }] }))
        return
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        let raw = ''
        req.on('data', (c: Buffer) => { raw += c.toString('utf8') })
        req.on('end', () => {
          chatCalls.push({
            body: JSON.parse(raw) as Record<string, unknown>,
            authorization: req.headers['authorization'],
          })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{ message: { content: 'answer from the local stub' } }],
            usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
          }))
        })
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address !== null && typeof address === 'object')
    baseUrl = `http://127.0.0.1:${address.port}/v1`

    modelsDir = mkdtempSync(join(tmpdir(), 'ui-chat-local-'))
    const modelPath = join(modelsDir, 'model.gguf')
    writeFileSync(modelPath, 'GGUF fixture bytes')
    writeFileSync(join(modelsDir, 'registry.json'), JSON.stringify({
      version: 1,
      models: [{
        id: MODEL_ID,
        repo: 'acme/Qwen-Fixture-GGUF',
        file: MODEL_FILE,
        path: modelPath,
        sizeBytes: 18,
        downloadedAt: 1,
      }],
    }))
    writeFileSync(join(modelsDir, 'settings.json'), JSON.stringify({
      activeModelId: MODEL_ID,
      contextLength: 32768,
      threads: 4,
      startOnLaunch: false,
    }))
    writeState(runningState())
  })

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (savedBaseUrl === undefined) delete process.env['REDTEAM_LOCAL_BASE_URL']
    else process.env['REDTEAM_LOCAL_BASE_URL'] = savedBaseUrl
  })

  const env = (): NodeJS.ProcessEnv => ({ DSH_LOCAL_MODELS_DIR: modelsDir })
  const ask = { provider: 'local', model: MODEL_ID, messages: [{ role: 'user', content: 'hello local' }] }

  it('routes a local pick to the serving endpoint, with no credential', async () => {
    const { res, captured } = fakeRes()
    await handleChat(res, ask, { env: env() })
    assert.equal(captured.status, 200)
    const data = JSON.parse(captured.body) as { text: string; provider: string; model: string }
    assert.equal(data.text, 'answer from the local stub')
    assert.equal(data.provider, 'local')
    assert.equal(data.model, MODEL_ID)
    assert.equal(chatCalls.length, 1)
    assert.equal(chatCalls[0]!.body['model'], MODEL_ID)
    assert.equal(chatCalls[0]!.authorization, undefined)
  })

  it('refuses with 409 when the local server is stopped — and never dispatches', async () => {
    writeState({ version: 1, status: 'stopped', updatedAt: Date.now() })
    try {
      const { res, captured } = fakeRes()
      await handleChat(res, ask, { env: env() })
      assert.equal(captured.status, 409)
      assert.match((JSON.parse(captured.body) as { error: string }).error, /not available/)
      assert.equal(chatCalls.length, 1, 'no further completion reached the endpoint')
    } finally {
      writeState(runningState())
    }
  })

  it('refuses with 409 when the pick names a model the server does not serve', async () => {
    const { res, captured } = fakeRes()
    await handleChat(res, { ...ask, model: 'someone-elses-model' }, { env: env() })
    assert.equal(captured.status, 409)
    assert.match((JSON.parse(captured.body) as { error: string }).error, /not the requested/)
    assert.equal(chatCalls.length, 1)
  })

  it('rejects a malformed body with 400', async () => {
    const { res, captured } = fakeRes()
    await handleChat(res, { provider: 'local', model: MODEL_ID, messages: [] }, { env: env() })
    assert.equal(captured.status, 400)
  })
})
