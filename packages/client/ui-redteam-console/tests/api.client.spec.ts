// @vitest-environment jsdom
/**
 * The console API client against a stubbed fetch and EventSource: the
 * share-route URLs, the Tier-2 production flag the escalate body must
 * carry, failure mapping (a dead console is a typed result, never a
 * throw), and the feed's frame handling (malformed frames dropped, done
 * and error delivered, close final).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createConsoleApi } from '../src/client/api.ts'
import type { FeedHandlers } from '../src/client/api.ts'
import { LIST_RESPONSE, MODELS_RESPONSE } from './fixtures.client.ts'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  closed = false
  private readonly listeners = new Map<string, ((event: { data: string }) => void)[]>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(name: string, fn: (event: { data: string }) => void): void {
    const list = this.listeners.get(name) ?? []
    list.push(fn)
    this.listeners.set(name, list)
  }
  /** Fire a named message event as the server would. */
  emit(name: string, data: string): void {
    for (const fn of this.listeners.get(name) ?? []) fn({ data })
  }
  close(): void { this.closed = true }
}

let fetchMock: Mock<typeof fetch>

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('createConsoleApi', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads the engagement list from the share route and maps the body through', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, LIST_RESPONSE))
    const api = createConsoleApi()
    const result = await api.listEngagements(new AbortController().signal)
    expect(fetchMock.mock.calls[0]![0]).toBe('redteam-console/api/console/engagements')
    expect(result).toEqual({ ok: true, value: LIST_RESPONSE })
  })

  it('maps a dead console\'s 502 to the typed failure, never a throw', async () => {
    fetchMock.mockResolvedValue(jsonResponse(502, { error: 'console-unavailable', message: 'console is not reachable' }))
    const api = createConsoleApi()
    await expect(api.models(new AbortController().signal)).resolves.toEqual({
      ok: false,
      message: 'console is not reachable',
    })
  })

  it('maps a network rejection to the same failure code', async () => {
    fetchMock.mockRejectedValue(new Error('socket closed'))
    const api = createConsoleApi()
    await expect(api.listEngagements(new AbortController().signal)).resolves.toEqual({
      ok: false,
      message: 'socket closed',
    })
  })

  it('posts the abort with its reason to the share route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, id: 'eng-1', via: 'abort.json' }))
    const api = createConsoleApi()
    await api.abort('eng-1', 'stop now', new AbortController().signal)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('redteam-console/api/engagements/eng-1/abort')
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'stop now' })
  })

  it('carries confirmTier2Production exactly when Tier 2 is chosen', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))
    const api = createConsoleApi()
    const signal = new AbortController().signal
    await api.escalate('eng-1', { tier: '2', operator: 'carlos', reason: 'go' }, signal)
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      tier: '2', operator: 'carlos', reason: 'go', confirmTier2Production: true,
    })
    await api.escalate('eng-1', { tier: '1', operator: 'carlos', reason: '' }, signal)
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
      tier: '1', operator: 'carlos', reason: '', confirmTier2Production: false,
    })
  })

  it('reads models from the share route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, MODELS_RESPONSE))
    const api = createConsoleApi()
    await expect(api.models(new AbortController().signal)).resolves.toEqual({ ok: true, value: MODELS_RESPONSE })
    expect(fetchMock.mock.calls[0]![0]).toBe('redteam-console/api/models')
  })

  it('addresses the record routes and the reverify/job flow', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))
    const api = createConsoleApi()
    const signal = new AbortController().signal
    await api.findings('eng-9', signal)
    await api.proof('eng-9', 'F-1', signal)
    await api.coverage('eng-9', signal)
    await api.compliance('eng-9', signal)
    await api.job('job-7', signal)
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'redteam-console/api/engagements/eng-9/findings',
      'redteam-console/api/engagements/eng-9/proof/F-1',
      'redteam-console/api/engagements/eng-9/coverage',
      'redteam-console/api/engagements/eng-9/compliance',
      'redteam-console/api/jobs/job-7',
    ])
    await api.reverify({ id: 'eng-9', finding: 'F-1' })
    const planCall = fetchMock.mock.calls.at(-1)!
    expect(planCall[0]).toBe('redteam-console/api/reverify')
    expect(JSON.parse(String(planCall[1]?.body))).toEqual({ id: 'eng-9', finding: 'F-1' })
    await api.reverify({ id: 'eng-9', finding: 'F-1', execute: true, scope: ['fixture.invalid'] })
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body))).toEqual({
      id: 'eng-9', finding: 'F-1', execute: true, scope: ['fixture.invalid'],
    })
  })

  it('opens the feed on the proxied events route and routes its frames', () => {
    const api = createConsoleApi()
    const handlers: FeedHandlers = {
      onEvent: vi.fn(), onState: vi.fn(), onDone: vi.fn(), onError: vi.fn(),
    }
    const connection = api.openFeed('eng-9', 41, handlers)
    const source = FakeEventSource.instances[0]!
    expect(source.url).toBe('redteam-console/api/engagements/eng-9/events?after=41')
    source.emit('event', JSON.stringify({ seq: 42, action: 'http_probe' }))
    expect(handlers.onEvent).toHaveBeenCalledWith({ seq: 42, action: 'http_probe' })
    source.emit('event', 'not json')
    expect(handlers.onEvent).toHaveBeenCalledTimes(1)
    source.emit('state', JSON.stringify({ status: 'running', phase: 'exploit', eventCount: 9 }))
    expect(handlers.onState).toHaveBeenCalledWith({ status: 'running', phase: 'exploit', eventCount: 9 })
    source.emit('done', JSON.stringify({ status: 'complete' }))
    expect(handlers.onDone).toHaveBeenCalledWith('complete')
    source.onerror?.()
    expect(handlers.onError).toHaveBeenCalledTimes(1)
    connection.close()
    expect(source.closed).toBe(true)
    source.onerror?.()
    expect(handlers.onError).toHaveBeenCalledTimes(1)
  })
})
