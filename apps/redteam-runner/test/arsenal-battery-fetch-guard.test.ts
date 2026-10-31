/**
 * ARS-9 acceptance battery — §6.1.6 fetch-guard denial matrix (spec T4).
 *
 * Exercises the ONE public seam of src/arsenal/fetch-guard.ts exactly as
 * ARS-1's published contract pins it: fetchTextChecked(url, { resolve,
 * transport }) with injected resolver/transport — no live DNS, no live
 * fetch, anywhere. Denials are asserted on err.name (spec §6.2 names the
 * typed errors; the module exports exactly one function, so no error
 * classes are imported).
 *
 * SEAM SHAPE (adapted to ARS-4's landed interfaces, fetch-guard.ts:96-131):
 *   resolve:   (hostname) => Promise<string[]>
 *   transport: (req: { url, address, family, hostname, headers, signal })
 *              => Promise<{ status, contentType, location,
 *                           body: AsyncIterable<Uint8Array> }>
 * The case list and assertions are the receipt; only the stub plumbing in
 * this header block speaks the seam's shape.
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'

const PUBLIC_IP = '93.184.216.34'
const PUBLIC_IP_2 = '93.184.216.35'
const FOUR_MIB = 4 * 1024 * 1024

interface TransportRequest {
  url: string
  address: string
  family: 4 | 6
  hostname: string
  headers: Readonly<Record<string, string>>
  signal: AbortSignal
}
interface TransportReply {
  status: number
  contentType: string | null
  location: string | null
  bodyText: string
}
type ResolveFn = (host: string) => Promise<string[]>
type TransportFn = (req: TransportRequest) => Promise<{
  status: number
  contentType: string | null
  location: string | null
  body: AsyncIterable<Uint8Array>
}>
type FetchTextChecked = (
  url: string,
  opts: { resolve: ResolveFn; transport: TransportFn },
) => Promise<{ text: string; finalUrl: string; hops: number }>

let fetchTextChecked: FetchTextChecked | undefined
let landed = false

before(async () => {
  const spec: string = '../src/arsenal/fetch-guard.js'
  try {
    const mod = (await import(spec)) as { fetchTextChecked?: unknown }
    if (typeof mod.fetchTextChecked === 'function') {
      fetchTextChecked = mod.fetchTextChecked as FetchTextChecked
      landed = true
    }
  } catch {
    landed = false
  }
})

function guard(): FetchTextChecked {
  assert.ok(landed && fetchTextChecked, 'ARS-4 slice not landed: src/arsenal/fetch-guard.ts must export fetchTextChecked')
  return fetchTextChecked
}

async function* bodyStream(text: string): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder()
  const CHUNK = 1024 * 1024
  for (let i = 0; i < text.length; i += CHUNK) {
    yield enc.encode(text.slice(i, i + CHUNK))
  }
  if (text.length === 0) yield new Uint8Array(0)
}

function okReply(text: string): TransportReply {
  return { status: 200, contentType: 'text/plain', location: null, bodyText: text }
}

function redirectReply(location: string): TransportReply {
  return { status: 302, contentType: null, location, bodyText: '' }
}

/** Transport stub: records every request object, delegates the reply. */
function makeTransport(handler: (req: TransportRequest, callIndex: number) => TransportReply | Promise<TransportReply>) {
  const calls: TransportRequest[] = []
  const transport: TransportFn = async (req) => {
    calls.push(req)
    const reply = await handler(req, calls.length - 1)
    return {
      status: reply.status,
      contentType: reply.contentType,
      location: reply.location,
      body: bodyStream(reply.bodyText),
    }
  }
  return { transport, calls }
}

function resolverFromMap(map: Record<string, string[]>): { resolve: ResolveFn; hosts: string[] } {
  const hosts: string[] = []
  const resolve: ResolveFn = async (host: string) => {
    hosts.push(host)
    return map[host] ?? []
  }
  return { resolve, hosts }
}

async function expectDenied(promise: Promise<unknown>, label: string): Promise<Error> {
  try {
    await promise
  } catch (err) {
    assert.ok(err instanceof Error, `${label}: rejection must be an Error`)
    return err
  }
  assert.fail(`${label}: fetch must be denied, but it succeeded`)
}

describe('§6.1.6 fetch-guard denial matrix (spec T4)', () => {
  it('denies the http: scheme before any connection', async () => {
    const { resolve } = resolverFromMap({ 'example.test': [PUBLIC_IP] })
    const { transport, calls } = makeTransport(() => okReply('never'))
    const err = await expectDenied(guard()('http://example.test/readme.md', { resolve, transport }), 'http scheme')
    assert.equal(err.name, 'DestinationDeniedError')
    assert.equal(calls.length, 0, 'transport must never be called for a denied scheme')
  })

  it('denies a credentialed URL', async () => {
    const { resolve } = resolverFromMap({ 'example.test': [PUBLIC_IP] })
    const { transport, calls } = makeTransport(() => okReply('never'))
    const err = await expectDenied(
      guard()('https://user:secret@example.test/readme.md', { resolve, transport }),
      'credentialed URL',
    )
    assert.equal(err.name, 'DestinationDeniedError')
    assert.equal(calls.length, 0)
  })

  for (const [label, ip] of [
    ['loopback 127.0.0.1', '127.0.0.1'],
    ['private 10.x', '10.1.2.3'],
    ['cloud metadata 169.254.169.254', '169.254.169.254'],
  ] as Array<[string, string]>) {
    it(`denies a host resolving to ${label}`, async () => {
      const { resolve } = resolverFromMap({ 'example.test': [ip] })
      const { transport, calls } = makeTransport(() => okReply('never'))
      const err = await expectDenied(guard()('https://example.test/readme.md', { resolve, transport }), label)
      assert.equal(err.name, 'DestinationDeniedError')
      assert.equal(calls.length, 0, 'transport must never connect to a denied address')
    })
  }

  it('denies when ANY resolved address is in a blocked range', async () => {
    const { resolve } = resolverFromMap({ 'example.test': [PUBLIC_IP, '192.168.1.10'] })
    const { transport, calls } = makeTransport(() => okReply('never'))
    const err = await expectDenied(guard()('https://example.test/readme.md', { resolve, transport }), 'mixed answers')
    assert.equal(err.name, 'DestinationDeniedError')
    assert.equal(calls.length, 0)
  })

  it('denies a redirect whose second hop lands on a private address', async () => {
    const { resolve } = resolverFromMap({
      'a.example.test': [PUBLIC_IP],
      'b.example.test': [PUBLIC_IP_2],
      'c.example.test': ['10.0.0.5'],
    })
    const { transport, calls } = makeTransport((req) => {
      if (req.url.includes('a.example.test')) return redirectReply('https://b.example.test/mid')
      if (req.url.includes('b.example.test')) return redirectReply('https://c.example.test/final')
      return okReply('must never be fetched')
    })
    const err = await expectDenied(guard()('https://a.example.test/start', { resolve, transport }), 'redirect to private')
    assert.equal(err.name, 'DestinationDeniedError')
    assert.equal(calls.length, 2, 'the private third hop must be denied before connecting')
    assert.ok(
      calls.every(c => !c.url.includes('c.example.test')),
      'the denied destination must never reach the transport',
    )
  })

  it('denies the fourth redirect (max 3 hops)', async () => {
    const map: Record<string, string[]> = {}
    for (let n = 0; n <= 5; n++) map[`r${n}.example.test`] = [PUBLIC_IP]
    const { resolve } = resolverFromMap(map)
    const { transport } = makeTransport((req) => {
      const m = /r(\d)\.example\.test/.exec(req.url)
      const n = m ? Number(m[1]) : 0
      return redirectReply(`https://r${n + 1}.example.test/next`)
    })
    const err = await expectDenied(guard()('https://r0.example.test/start', { resolve, transport }), '4th redirect')
    assert.ok(
      err.name === 'DestinationDeniedError' || err.name === 'FetchFailedError',
      `4th redirect must fail with a typed guard error, got ${err.name}`,
    )
  })

  it('denies an oversize body (> 4 MiB)', async () => {
    const { resolve } = resolverFromMap({ 'example.test': [PUBLIC_IP] })
    const big = 'x'.repeat(FOUR_MIB + 1)
    const { transport } = makeTransport(() => ({ ...okReply(''), bodyText: big }))
    const err = await expectDenied(guard()('https://example.test/huge.md', { resolve, transport }), 'oversize body')
    assert.ok(
      err.name === 'DestinationDeniedError' || err.name === 'FetchFailedError',
      `oversize body must fail with a typed guard error, got ${err.name}`,
    )
  })

  it('pins the connection to the checked address (resolver rebinding is defeated)', async () => {
    let resolveCalls = 0
    const resolve: ResolveFn = async () => {
      resolveCalls += 1
      return resolveCalls === 1 ? [PUBLIC_IP] : ['127.0.0.1']
    }
    const { transport, calls } = makeTransport((req) => {
      if (req.address === '127.0.0.1') throw new Error('transport connected to the rebound address')
      return okReply('# Pinned README')
    })
    const result = await guard()('https://example.test/readme.md', { resolve, transport })
    assert.ok(result.text.includes('Pinned README'), 'the fetch must succeed via the first, checked address')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.address, PUBLIC_IP, 'the transport must be pinned to the checked address')
    assert.equal(calls[0]?.hostname, 'example.test', 'the original hostname must ride along for Host/SNI')
  })

  it('allows a public https README (stubbed resolver + transport)', async () => {
    const { resolve } = resolverFromMap({ 'example.test': [PUBLIC_IP] })
    const { transport, calls } = makeTransport(() => okReply('# Fixture README\n'))
    const result = await guard()('https://example.test/readme.md', { resolve, transport })
    assert.ok(result.text.includes('Fixture README'))
    assert.equal(result.hops, 0)
    assert.equal(result.finalUrl, 'https://example.test/readme.md')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.address, PUBLIC_IP)
  })
})
