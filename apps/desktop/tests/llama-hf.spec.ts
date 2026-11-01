/**
 * Hugging Face client behaviour: repository listing, URL resolution and the resumable
 * downloader. Every case runs against a loopback `node:http` fixture, so no test reaches
 * the network; the fixture records what the client sent, which is how the Bearer header,
 * the Range request and the restart fallback are proven.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DownloadCancelledError,
  downloadFile,
  listRepoFiles,
  resolveFileUrl,
} from '../src/llama-hf.ts'
import type { ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HuggingFaceDownloadProgress } from '../src/llama-hf.ts'

/** A token value no failure message and no log line may ever carry. */
const TOKEN = 'hf_fixture_token_value'

/** Bytes the downloader copies in the round-trip cases. */
const PAYLOAD = Buffer.from('the whole gguf payload goes here', 'utf8')

/** One request the loopback fixture received. */
interface FixtureRequest {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
}

/** Reply for one captured request; the fixture owns the response object. */
type FixtureResponder = (request: FixtureRequest, response: ServerResponse) => void

/** One isolated HTTP origin standing in for the Hub. */
interface Fixture {
  readonly origin: string
  readonly requests: FixtureRequest[]
  close(): Promise<void>
}

const fixtures: Fixture[] = []
const roots: string[] = []

/**
 * Start a loopback server that records each request before the responder answers it.
 * @param responder - reply for one captured request.
 * @returns the origin, recorded requests and an idempotent close.
 */
async function startFixture(responder: FixtureResponder): Promise<Fixture> {
  const requests: FixtureRequest[] = []
  let closed = false
  const server = createServer((incoming, response) => {
    const request: FixtureRequest = {
      method: incoming.method ?? '',
      url: incoming.url ?? '',
      headers: incoming.headers,
    }
    requests.push(request)
    responder(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const { port } = server.address() as AddressInfo
  const fixture: Fixture = {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    async close() {
      if (closed) return
      closed = true
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    },
  }
  fixtures.push(fixture)
  return fixture
}

/** @returns a fresh temp directory that the suite removes afterwards. */
function tempDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llama-hf-'))
  roots.push(root)
  return root
}

/**
 * Route absolute Hub URLs to the loopback fixture while keeping the path and query.
 * @param fixture - loopback origin standing in for the Hub.
 * @returns a fetch-compatible transport that never resolves huggingface.co.
 */
function hubFetch(fixture: Fixture): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const source = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    const target = new URL(source)
    return fetch(`${fixture.origin}${target.pathname}${target.search}`, init)
  }
}

/**
 * @param promise - a call expected to fail.
 * @returns the Error it failed with, so its message can be asserted directly.
 */
async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error('the call was expected to fail')
}

/**
 * @param predicate - state the running download has to reach.
 * @param timeoutMs - deadline before the wait is declared failed.
 * @returns after the predicate first holds.
 */
async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('the fixture did not reach the expected state in time')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/**
 * Write one JSON reply.
 * @param response - fixture response.
 * @param status - HTTP status.
 * @param body - JSON body.
 */
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

/**
 * Write one octet-stream reply.
 * @param response - fixture response.
 * @param status - HTTP status.
 * @param headers - extra response headers, including the length and any content range.
 * @param body - bytes to send.
 */
function octets(response: ServerResponse, status: number, headers: Record<string, string>, body: Buffer): void {
  response.writeHead(status, { 'content-type': 'application/octet-stream', ...headers })
  response.end(body)
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('listRepoFiles', () => {
  it('lists every sibling, marks gguf files and sorts by the tree sizes', async () => {
    const fixture = await startFixture((request, response) => {
      if (request.url === '/api/models/acme/model') {
        json(response, 200, {
          siblings: [
            { rfilename: 'model-b.Q8_0.gguf' },
            { rfilename: 'README.md' },
            { rfilename: 'model-a.GGUF' },
          ],
        })
        return
      }
      if (request.url === '/api/models/acme/model/tree/main') {
        json(response, 200, [
          { type: 'file', path: 'model-b.Q8_0.gguf', size: 300 },
          { type: 'file', path: 'README.md', size: 50 },
          { type: 'file', path: 'model-a.GGUF', size: 100 },
        ])
        return
      }
      json(response, 404, { error: 'unexpected fixture path' })
    })

    const files = await listRepoFiles({ repo: 'acme/model', fetch: hubFetch(fixture) })

    expect(files).toEqual([
      { file: 'README.md', sizeBytes: 50, isGguf: false },
      { file: 'model-a.GGUF', sizeBytes: 100, isGguf: true },
      { file: 'model-b.Q8_0.gguf', sizeBytes: 300, isGguf: true },
    ])
    expect(fixture.requests.map(request => request.url)).toEqual([
      '/api/models/acme/model',
      '/api/models/acme/model/tree/main',
    ])
  })

  it('uses sibling sizes without reading the tree endpoint', async () => {
    const fixture = await startFixture((request, response) => {
      if (request.url === '/api/models/acme/model') {
        json(response, 200, {
          siblings: [
            { rfilename: 'model-b.gguf', size: 20 },
            { rfilename: 'model-a.gguf', size: 10 },
          ],
        })
        return
      }
      json(response, 500, { error: 'the tree must not be read' })
    })

    const files = await listRepoFiles({ repo: 'acme/model', fetch: hubFetch(fixture) })

    expect(files).toEqual([
      { file: 'model-a.gguf', sizeBytes: 10, isGguf: true },
      { file: 'model-b.gguf', sizeBytes: 20, isGguf: true },
    ])
    expect(fixture.requests).toHaveLength(1)
  })

  it('keeps the listing when the tree endpoint fails', async () => {
    const fixture = await startFixture((request, response) => {
      if (request.url === '/api/models/acme/model') {
        json(response, 200, { siblings: [{ rfilename: 'model-b.gguf' }, { rfilename: 'model-a.gguf' }] })
        return
      }
      json(response, 500, { error: 'the tree is unavailable' })
    })

    const files = await listRepoFiles({ repo: 'acme/model', fetch: hubFetch(fixture) })

    expect(files).toEqual([
      { file: 'model-a.gguf', isGguf: true },
      { file: 'model-b.gguf', isGguf: true },
    ])
  })

  it('flags a vision projector sibling instead of marking it a model file', async () => {
    const fixture = await startFixture((request, response) => {
      if (request.url === '/api/models/acme/model') {
        json(response, 200, {
          siblings: [
            { rfilename: 'mmproj-acme-f16.gguf', size: 40 },
            { rfilename: 'model-a.Q4_K_M.gguf', size: 100 },
          ],
        })
        return
      }
      json(response, 404, { error: 'unexpected fixture path' })
    })

    const files = await listRepoFiles({ repo: 'acme/model', fetch: hubFetch(fixture) })

    expect(files).toEqual([
      { file: 'mmproj-acme-f16.gguf', sizeBytes: 40, isGguf: false, isProjector: true },
      { file: 'model-a.Q4_K_M.gguf', sizeBytes: 100, isGguf: true },
    ])
  })

  it('rejects malformed repository identifiers before requesting anything', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response('{}', { status: 200 })
    }

    for (const repo of ['acme', 'acme/model/extra', '/acme/model', 'acme/model?x=1', '../model', 'Acme Model']) {
      const error = await failure(listRepoFiles({ repo, fetch: fetchImpl }))
      expect(error.message).toContain('owner/name')
    }
    expect(calls).toBe(0)
  })

  it('reports a missing repository', async () => {
    const fixture = await startFixture((_request, response) => {
      json(response, 404, { error: 'Repository not found' })
    })

    const error = await failure(listRepoFiles({ repo: 'acme/missing', token: TOKEN, fetch: hubFetch(fixture) }))

    expect(error.message).toContain('repo not found')
    expect(error.message).not.toContain(TOKEN)
  })

  it('names HF_TOKEN on a refused listing without echoing the token', async () => {
    const fixture = await startFixture((_request, response) => {
      json(response, 401, { error: 'Unauthorized' })
    })

    const error = await failure(listRepoFiles({ repo: 'acme/gated', token: TOKEN, fetch: hubFetch(fixture) }))

    expect(error.message).toContain('HF_TOKEN')
    expect(error.message).not.toContain(TOKEN)
  })

  it('sends the token as a Bearer header on the repository endpoint', async () => {
    const fixture = await startFixture((_request, response) => {
      json(response, 200, { siblings: [{ rfilename: 'model.gguf', size: 10 }] })
    })

    await listRepoFiles({ repo: 'acme/model', token: TOKEN, fetch: hubFetch(fixture) })

    expect(fixture.requests[0]?.method).toBe('GET')
    expect(fixture.requests[0]?.url).toBe('/api/models/acme/model')
    expect(fixture.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`)
  })
})

describe('resolveFileUrl', () => {
  it('builds the resolve URL with encoded path segments', () => {
    expect(resolveFileUrl({ repo: 'acme/model', file: 'sub dir/model name +1.gguf' }))
      .toBe('https://huggingface.co/acme/model/resolve/main/sub%20dir/model%20name%20%2B1.gguf')
  })

  it('rejects a malformed repo and a file outside the repository', () => {
    expect(() => resolveFileUrl({ repo: 'acme', file: 'model.gguf' })).toThrow('owner/name')
    expect(() => resolveFileUrl({ repo: 'acme/model', file: '../model.gguf' })).toThrow('inside the repository')
    expect(() => resolveFileUrl({ repo: 'acme/model', file: '/model.gguf' })).toThrow('inside the repository')
    expect(() => resolveFileUrl({ repo: 'acme/model', file: '' })).toThrow('inside the repository')
  })
})

describe('downloadFile', () => {
  it('streams a complete file into the destination and reports progress', async () => {
    const fixture = await startFixture((_request, response) => {
      octets(response, 200, { 'content-length': String(PAYLOAD.byteLength) }, PAYLOAD)
    })
    const destination = join(tempDirectory(), 'model.gguf')
    const progress: HuggingFaceDownloadProgress[] = []

    const result = await downloadFile({
      url: `${fixture.origin}/acme/model/resolve/main/model.gguf`,
      destination,
      onProgress: (value) => { progress.push(value) },
    })

    expect(result).toEqual({ sizeBytes: PAYLOAD.byteLength })
    expect(readFileSync(destination).equals(PAYLOAD)).toBe(true)
    expect(existsSync(`${destination}.part`)).toBe(false)
    expect(fixture.requests[0]?.headers.range).toBeUndefined()
    expect(progress[0]).toEqual({ receivedBytes: 0, totalBytes: PAYLOAD.byteLength })
    expect(progress.at(-1)).toEqual({ receivedBytes: PAYLOAD.byteLength, totalBytes: PAYLOAD.byteLength })
  })

  it('resumes a retained part file with a Range request and a 206 reply', async () => {
    const split = 8
    const ranges: (string | string[] | undefined)[] = []
    const fixture = await startFixture((request, response) => {
      ranges.push(request.headers.range)
      octets(response, 206, {
        'content-length': String(PAYLOAD.byteLength - split),
        'content-range': `bytes ${String(split)}-${String(PAYLOAD.byteLength - 1)}/${String(PAYLOAD.byteLength)}`,
      }, PAYLOAD.subarray(split))
    })
    const destination = join(tempDirectory(), 'model.gguf')
    writeFileSync(`${destination}.part`, PAYLOAD.subarray(0, split))

    const result = await downloadFile({ url: `${fixture.origin}/model.gguf`, destination })

    expect(result.sizeBytes).toBe(PAYLOAD.byteLength)
    expect(readFileSync(destination).equals(PAYLOAD)).toBe(true)
    expect(existsSync(`${destination}.part`)).toBe(false)
    expect(ranges).toEqual([`bytes=${String(split)}-`])
  })

  it('restarts from zero when the server answers 200 instead of 206', async () => {
    const ranges: (string | string[] | undefined)[] = []
    const fixture = await startFixture((request, response) => {
      ranges.push(request.headers.range)
      octets(response, 200, { 'content-length': String(PAYLOAD.byteLength) }, PAYLOAD)
    })
    const destination = join(tempDirectory(), 'model.gguf')
    writeFileSync(`${destination}.part`, Buffer.from('stale-bytes', 'utf8'))

    const result = await downloadFile({ url: `${fixture.origin}/model.gguf`, destination })

    expect(result.sizeBytes).toBe(PAYLOAD.byteLength)
    expect(readFileSync(destination).equals(PAYLOAD)).toBe(true)
    expect(existsSync(`${destination}.part`)).toBe(false)
    expect(ranges).toEqual(['bytes=11-'])
  })

  it('keeps the part file when the caller aborts', async () => {
    const fixture = await startFixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '1000' })
      response.write(Buffer.alloc(16, 0x61))
    })
    const destination = join(tempDirectory(), 'model.gguf')
    const partPath = `${destination}.part`
    const controller = new AbortController()
    const settled = downloadFile({
      url: `${fixture.origin}/model.gguf`,
      destination,
      signal: controller.signal,
    }).catch((error: unknown) => error)

    await waitUntil(() => existsSync(partPath) && statSync(partPath).size > 0)
    controller.abort()
    const error = await settled

    expect(error).toBeInstanceOf(DownloadCancelledError)
    expect(existsSync(partPath)).toBe(true)
    expect(statSync(partPath).size).toBeGreaterThan(0)
    expect(existsSync(destination)).toBe(false)
  })

  it('fails and removes the part file when the received size does not match', async () => {
    const fixture = await startFixture((_request, response) => {
      octets(response, 206, { 'content-length': '5', 'content-range': 'bytes 0-4/10' }, Buffer.from('short', 'utf8'))
    })
    const destination = join(tempDirectory(), 'model.gguf')

    const error = await failure(downloadFile({ url: `${fixture.origin}/model.gguf`, destination }))

    expect(error.message).toContain('incomplete')
    expect(error.message).toContain('expected 10 bytes')
    expect(existsSync(`${destination}.part`)).toBe(false)
    expect(existsSync(destination)).toBe(false)
  })

  it('sends the token only as a Bearer header and never in a failure', async () => {
    const fixture = await startFixture((_request, response) => {
      json(response, 401, { error: 'Unauthorized' })
    })
    const destination = join(tempDirectory(), 'model.gguf')

    const error = await failure(downloadFile({
      url: `${fixture.origin}/model.gguf`,
      destination,
      token: TOKEN,
    }))

    expect(fixture.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(error.message).toContain('HF_TOKEN')
    expect(error.message).not.toContain(TOKEN)
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.part`)).toBe(false)
  })

  it('reports a missing file without echoing the URL query string', async () => {
    const fixture = await startFixture((_request, response) => {
      json(response, 404, { error: 'Entry not found' })
    })
    const destination = join(tempDirectory(), 'model.gguf')

    const error = await failure(downloadFile({
      url: `${fixture.origin}/model.gguf?token=query-secret`,
      destination,
    }))

    expect(error.message).toContain('file not found')
    expect(error.message).not.toContain('query-secret')
    expect(existsSync(`${destination}.part`)).toBe(false)
  })
})
