/**
 * Live feed route — the console-must-not-crash guard.
 *
 * The defect this pins shut: `push()` ran while `timer` was still in its temporal
 * dead zone (`const timer` was declared AFTER the first call). When the first
 * `res.write` returned false — a slow client, a full socket buffer, normal for a
 * findings-rich engagement — the early-exit path called `clearInterval(timer)` and
 * threw a ReferenceError out of the route. The console has no `uncaughtException`
 * handler, so the process exited.
 *
 * These tests drive the real handler with a fake response whose writes fail, then
 * disconnect the fake client so the handler's interval is cleared and the test
 * process is not held open.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleFeed } from '../src/ui/routes/feed.js'
import type { UiStore } from '../src/ui/store.js'

const ENGAGEMENT = 'eng-feed-test'

function fixture(state: Record<string, unknown>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'feed-route-'))
  const engDir = join(dir, ENGAGEMENT)
  mkdirSync(engDir, { recursive: true })
  writeFileSync(join(engDir, 'state.json'), JSON.stringify(state))
  writeFileSync(join(engDir, 'events.jsonl'), '')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

interface FakeResponse {
  res: never
  writes: string[]
}

/** A response whose `write` returns the given results in order (last one repeats). */
function response(returns: boolean[]): FakeResponse {
  const writes: string[] = []
  let index = 0
  const res = {
    writeHead: () => res,
    write: (chunk: string) => {
      writes.push(chunk)
      const result = returns[Math.min(index, returns.length - 1)] ?? true
      index++
      return result
    },
    end: () => undefined,
    on: () => res,
  }
  return { res: res as never, writes }
}

/** A request that records the close handler so the client can disconnect. */
function request(): { req: never; disconnect: () => void } {
  const handlers: Array<() => void> = []
  const req = {
    on: (event: string, cb: () => void) => {
      if (event === 'close') handlers.push(cb)
      return req
    },
  }
  return {
    req: req as never,
    disconnect: () => { for (const h of handlers) h() },
  }
}

function store(dir: string): UiStore {
  return { engagementsDir: dir } as unknown as UiStore
}

describe('feed route survives a client that will not take data', () => {
  it('does not throw when the first event write fails', () => {
    const { dir, cleanup } = fixture({ status: 'scanning', phase: 'recon' })
    const { req, disconnect } = request()
    try {
      // heartbeat ok, then the event write reports a full buffer.
      const { res, writes } = response([true, false])
      assert.doesNotThrow(() =>
        handleFeed(store(dir), req, res, ENGAGEMENT, new URLSearchParams()))
      assert.ok(writes.length > 0, 'nothing was written at all')
    } finally {
      disconnect()
      cleanup()
    }
  })

  it('does not throw when the heartbeat write itself fails', () => {
    const { dir, cleanup } = fixture({ status: 'scanning', phase: 'recon' })
    const { req, disconnect } = request()
    try {
      const { res } = response([false])
      assert.doesNotThrow(() =>
        handleFeed(store(dir), req, res, ENGAGEMENT, new URLSearchParams()))
    } finally {
      disconnect()
      cleanup()
    }
  })

  it('serves a terminal engagement without throwing', () => {
    const { dir, cleanup } = fixture({ status: 'complete', phase: 'done' })
    const { req, disconnect } = request()
    try {
      const { res, writes } = response([true])
      assert.doesNotThrow(() =>
        handleFeed(store(dir), req, res, ENGAGEMENT, new URLSearchParams()))
      assert.ok(writes.some((w) => w.includes('event: state')), 'the state frame never went out')
    } finally {
      disconnect()
      cleanup()
    }
  })
})
