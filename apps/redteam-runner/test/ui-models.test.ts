/**
 * /api/models route — the chat view's engine banner data.
 * Proves the seat policy the banner renders: with REDTEAM_LLM_PROVIDER=meta
 * every role seats on Meta Muse Spark and the meta provider reports itself.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerResponse } from 'node:http'
import { handleModels } from '../src/ui/routes/models.js'

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

describe('GET /api/models', () => {
  it('reports the meta seats when REDTEAM_LLM_PROVIDER=meta', () => {
    const prevProvider = process.env.REDTEAM_LLM_PROVIDER
    const prevKey = process.env.MODEL_API_KEY
    process.env.REDTEAM_LLM_PROVIDER = 'meta'
    process.env.MODEL_API_KEY = 'test-key-not-real'
    try {
      const { res, captured } = fakeRes()
      handleModels(res)
      assert.equal(captured.status, 200)
      const data = JSON.parse(captured.body) as {
        activeProvider: string
        providers: Array<{ id: string; configured: boolean }>
        seats: Array<{ role: string; provider: string; model: string }>
      }
      assert.equal(data.activeProvider, 'meta')
      const meta = data.providers.find(p => p.id === 'meta')
      assert.ok(meta, 'meta provider is registered')
      assert.equal(meta.configured, true)
      assert.equal(data.seats.length, 5)
      assert.ok(
        data.seats.some(s => s.role === 'architect'),
        'the architect seat is reported',
      )
      for (const seat of data.seats) {
        assert.equal(seat.provider, 'meta')
        assert.equal(seat.model, 'muse-spark-1.3')
      }
    } finally {
      if (prevProvider === undefined) delete process.env.REDTEAM_LLM_PROVIDER
      else process.env.REDTEAM_LLM_PROVIDER = prevProvider
      if (prevKey === undefined) delete process.env.MODEL_API_KEY
      else process.env.MODEL_API_KEY = prevKey
    }
  })
})
