/**
 * Fetch guard (spec §12 test point 4 / brief Step 4, T4) — the full denial
 * matrix. Resolver and transport are ALWAYS stubbed: these tests never touch
 * DNS or the network. Transports are scripted fixtures; resolvers are maps.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DestinationDeniedError,
  FetchFailedError,
  fetchTextChecked,
  type ArsenalResolveFn,
  type ArsenalTransportFn,
  type ArsenalTransportRequest,
  type ArsenalTransportResponse,
  type DenyReason,
} from '../src/arsenal/fetch-guard.js'

/* Fixture addresses (documentation/fixture data, never connected). */
const PUBLIC_A = '93.184.216.34'
const PUBLIC_B = '140.82.121.4'
const PUBLIC_V6 = '2606:4700:4700::1111'

function resolverOf(
  table: Record<string, string[]>,
  calls: string[] = [],
): ArsenalResolveFn {
  return async (hostname) => {
    calls.push(hostname)
    const answer = table[hostname]
    if (answer === undefined) throw new Error(`no fixture DNS for ${hostname}`)
    return answer
  }
}

async function* bodyOf(...chunks: string[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield Buffer.from(chunk, 'utf8')
}

function textResponse(
  text: string,
  contentType: string | null = 'text/plain; charset=utf-8',
): ArsenalTransportResponse {
  return { status: 200, contentType, location: null, body: bodyOf(text) }
}

function redirectResponse(location: string): ArsenalTransportResponse {
  return { status: 302, contentType: null, location, body: bodyOf() }
}

function transportOf(
  handler: (req: ArsenalTransportRequest, call: number) => ArsenalTransportResponse,
  seen: ArsenalTransportRequest[] = [],
): ArsenalTransportFn {
  return async (req) => {
    seen.push(req)
    return handler(req, seen.length)
  }
}

/** A transport that serves one canned response for every request. */
function staticTransport(response: ArsenalTransportResponse, seen: ArsenalTransportRequest[] = []) {
  return transportOf(() => response, seen)
}

async function expectDenied(
  promise: Promise<unknown>,
  reason: DenyReason,
): Promise<DestinationDeniedError> {
  try {
    await promise
  } catch (error) {
    assert.ok(
      error instanceof DestinationDeniedError,
      `expected DestinationDeniedError(${reason}), got ${String(error)}`,
    )
    assert.equal(error.reason, reason)
    return error
  }
  assert.fail(`expected DestinationDeniedError(${reason}), but the fetch succeeded`)
}

async function expectFailed(
  promise: Promise<unknown>,
  reason: string,
): Promise<FetchFailedError> {
  try {
    await promise
  } catch (error) {
    assert.ok(
      error instanceof FetchFailedError,
      `expected FetchFailedError(${reason}), got ${String(error)}`,
    )
    assert.equal(error.reason, reason)
    return error
  }
  assert.fail(`expected FetchFailedError(${reason}), but the fetch succeeded`)
}

const README_URL = 'https://collections.example/readme.md'

describe('allow path', () => {
  it('fetches a public https README: pinned address, Host preserved, only the two permitted headers', async () => {
    const seen: ArsenalTransportRequest[] = []
    const result = await fetchTextChecked(README_URL, {
      resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
      transport: staticTransport(textResponse('# Awesome\n'), seen),
    })
    assert.equal(result.text, '# Awesome\n')
    assert.equal(result.finalUrl, README_URL)
    assert.equal(result.hops, 0)
    assert.equal(seen.length, 1)
    const req = seen[0] as ArsenalTransportRequest
    assert.equal(req.address, PUBLIC_A)
    assert.equal(req.family, 4)
    assert.equal(req.hostname, 'collections.example')
    assert.deepEqual(Object.keys(req.headers).sort(), ['accept', 'user-agent'])
    assert.equal(req.headers['accept'], 'text/plain, text/markdown')
    assert.match(req.headers['user-agent'] as string, /secscan-redteam-runner/)
  })

  it('allows a public IPv6 answer and pins it as family 6', async () => {
    const seen: ArsenalTransportRequest[] = []
    await fetchTextChecked(README_URL, {
      resolve: resolverOf({ 'collections.example': [PUBLIC_V6] }),
      transport: staticTransport(textResponse('ok'), seen),
    })
    assert.equal((seen[0] as ArsenalTransportRequest).address, PUBLIC_V6)
    assert.equal((seen[0] as ArsenalTransportRequest).family, 6)
  })

  it('allows an IPv4-mapped IPv6 answer whose embedded address is public', async () => {
    const seen: ArsenalTransportRequest[] = []
    await fetchTextChecked(README_URL, {
      resolve: resolverOf({ 'collections.example': ['::ffff:5db8:d822'] }),
      transport: staticTransport(textResponse('ok'), seen),
    })
    assert.equal((seen[0] as ArsenalTransportRequest).family, 6)
  })

  it('allows 172.32.0.1 — just outside the 172.16.0.0/12 private range', async () => {
    await fetchTextChecked(README_URL, {
      resolve: resolverOf({ 'collections.example': ['172.32.0.1'] }),
      transport: staticTransport(textResponse('ok')),
    })
  })

  it('allows application/octet-stream (raw hosts) and text with parameters', async () => {
    await fetchTextChecked(README_URL, {
      resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
      transport: staticTransport(textResponse('raw', 'application/octet-stream')),
    })
    await fetchTextChecked(README_URL, {
      resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
      transport: staticTransport(textResponse('md', 'text/markdown; charset=utf-8')),
    })
  })

  it('follows a relative redirect and reports finalUrl + hops', async () => {
    const seen: ArsenalTransportRequest[] = []
    const transport = transportOf((_req, call) =>
      call === 1 ? redirectResponse('/moved.md') : textResponse('landed'), seen)
    const result = await fetchTextChecked(README_URL, {
      resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
      transport,
    })
    assert.equal(result.text, 'landed')
    assert.equal(result.finalUrl, 'https://collections.example/moved.md')
    assert.equal(result.hops, 1)
    assert.equal(seen.length, 2)
  })

  it('allows exactly 3 redirects', async () => {
    const transport = transportOf((_req, call) =>
      call <= 3 ? redirectResponse(`https://collections.example/hop-${call}`) : textResponse('end'))
    const result = await fetchTextChecked(README_URL, {
      resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
      transport,
    })
    assert.equal(result.text, 'end')
    assert.equal(result.hops, 3)
  })

  it('accepts a body of exactly the cap', async () => {
    const result = await fetchTextChecked(README_URL, {
      resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
      transport: staticTransport(textResponse('1234567890')),
      maxBodyBytes: 10,
    })
    assert.equal(result.text, '1234567890')
  })
})

describe('scheme + URL shape denials', () => {
  it('denies the http scheme', async () => {
    await expectDenied(
      fetchTextChecked('http://collections.example/readme.md', {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
        transport: staticTransport(textResponse('x')),
      }),
      'scheme-not-https',
    )
  })

  it('denies non-http(s) schemes: ftp, file, gopher, data', async () => {
    for (const url of [
      'ftp://collections.example/readme.md',
      'file:///etc/passwd',
      'gopher://collections.example/1',
      'data:text/plain,hello',
    ]) {
      await expectDenied(
        fetchTextChecked(url, {
          resolve: resolverOf({}),
          transport: staticTransport(textResponse('x')),
        }),
        'scheme-not-https',
      )
    }
  })

  it('denies a credentialed URL without ever resolving or connecting', async () => {
    const resolveCalls: string[] = []
    const seen: ArsenalTransportRequest[] = []
    await expectDenied(
      fetchTextChecked('https://user:secret@collections.example/readme.md', {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }, resolveCalls),
        transport: staticTransport(textResponse('x'), seen),
      }),
      'credentials-in-url',
    )
    assert.equal(resolveCalls.length, 0)
    assert.equal(seen.length, 0)
  })

  it('denies an unparseable URL', async () => {
    await expectDenied(
      fetchTextChecked('not a url', {
        resolve: resolverOf({}),
        transport: staticTransport(textResponse('x')),
      }),
      'invalid-url',
    )
  })
})

describe('address-range denials (deny if ANY resolved address is non-global)', () => {
  const blocked: Array<[string, string]> = [
    ['127.0.0.1', 'loopback'],
    ['127.63.0.9', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.5', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'link-local'],
    ['169.254.0.1', 'link-local'],
    ['0.0.0.0', 'unspecified'],
    ['0.7.7.7', 'unspecified'],
    ['100.64.1.1', 'shared address space'],
    ['192.0.2.4', 'documentation'],
    ['198.18.0.23', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.9', 'reserved'],
    ['255.255.255.255', 'reserved'],
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['fd00::1', 'private'],
    ['fcab:1234::5', 'private'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:0a00:0001', 'private'],
    ['64:ff9b::a9fe:a9fe', 'link-local'],
  ]
  for (const [address, category] of blocked) {
    it(`denies a resolution to ${address} (${category})`, async () => {
      const seen: ArsenalTransportRequest[] = []
      const error = await expectDenied(
        fetchTextChecked(README_URL, {
          resolve: resolverOf({ 'collections.example': [address] }),
          transport: staticTransport(textResponse('x'), seen),
        }),
        'blocked-address',
      )
      assert.match(error.detail ?? '', new RegExp(category.replace(/[()]/g, '.')))
      assert.equal(seen.length, 0, 'transport must never be called for a denied address')
    })
  }

  it('denies when a public answer is mixed with a private one (ANY rule)', async () => {
    const seen: ArsenalTransportRequest[] = []
    await expectDenied(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A, '10.0.0.8'] }),
        transport: staticTransport(textResponse('x'), seen),
      }),
      'blocked-address',
    )
    assert.equal(seen.length, 0)
  })

  it('denies an unparseable resolver answer (fail closed)', async () => {
    await expectDenied(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': ['not-an-ip'] }),
        transport: staticTransport(textResponse('x')),
      }),
      'unparseable-address',
    )
  })

  it('denies an empty resolution', async () => {
    await expectDenied(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [] }),
        transport: staticTransport(textResponse('x')),
      }),
      'no-addresses',
    )
  })

  it('denies a literal loopback host without consulting DNS', async () => {
    const resolveCalls: string[] = []
    await expectDenied(
      fetchTextChecked('https://127.0.0.1/readme.md', {
        resolve: resolverOf({}, resolveCalls),
        transport: staticTransport(textResponse('x')),
      }),
      'blocked-address',
    )
    assert.equal(resolveCalls.length, 0)
  })

  it('denies a literal IPv6 loopback host', async () => {
    await expectDenied(
      fetchTextChecked('https://[::1]/readme.md', {
        resolve: resolverOf({}),
        transport: staticTransport(textResponse('x')),
      }),
      'blocked-address',
    )
  })

  it('denies a literal 0.0.0.0 host', async () => {
    await expectDenied(
      fetchTextChecked('https://0.0.0.0/readme.md', {
        resolve: resolverOf({}),
        transport: staticTransport(textResponse('x')),
      }),
      'blocked-address',
    )
  })

  it('fetches a literal public IP host by pinning the literal itself', async () => {
    const seen: ArsenalTransportRequest[] = []
    const result = await fetchTextChecked(`https://${PUBLIC_B}/readme.md`, {
      resolve: resolverOf({}),
      transport: staticTransport(textResponse('by-ip'), seen),
    })
    assert.equal(result.text, 'by-ip')
    assert.equal((seen[0] as ArsenalTransportRequest).address, PUBLIC_B)
  })
})

describe('redirect policy', () => {
  it('denies when redirect hop 2 lands on a private address', async () => {
    const transport = transportOf((_req, call) =>
      call === 1
        ? redirectResponse('https://metadata.example/latest.md')
        : textResponse('never'))
    const error = await expectDenied(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({
          'collections.example': [PUBLIC_A],
          'metadata.example': ['169.254.169.254'],
        }),
        transport,
      }),
      'blocked-address',
    )
    assert.equal(error.hop, 1)
  })

  it('denies a redirect that downgrades to http', async () => {
    const transport = transportOf(() => redirectResponse('http://collections.example/moved.md'))
    const error = await expectDenied(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
        transport,
      }),
      'scheme-not-https',
    )
    assert.equal(error.hop, 1)
  })

  it('denies the 4th redirect', async () => {
    const seen: ArsenalTransportRequest[] = []
    const transport = transportOf(
      (_req, call) => redirectResponse(`https://collections.example/hop-${call}`),
      seen,
    )
    await expectDenied(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
        transport,
      }),
      'too-many-redirects',
    )
    assert.equal(seen.length, 4, 'initial request + 3 followed redirects, then refusal')
  })
})

describe('anti-rebinding: the checked address is the connected address', () => {
  it("pins the resolver's FIRST answer; the resolver is consulted exactly once per hop", async () => {
    const answers = [[PUBLIC_A], ['127.0.0.1']]
    let calls = 0
    const seen: ArsenalTransportRequest[] = []
    const resolve: ArsenalResolveFn = async () => answers[calls++] as string[]
    const result = await fetchTextChecked(README_URL, {
      resolve,
      transport: staticTransport(textResponse('pinned'), seen),
    })
    assert.equal(result.text, 'pinned')
    assert.equal(calls, 1, 'no second resolution exists for a rebinding window')
    assert.equal((seen[0] as ArsenalTransportRequest).address, PUBLIC_A)
  })

  it('re-validates on the redirect hop: a rebound second answer is denied there', async () => {
    const answers = [[PUBLIC_A], ['127.0.0.1']]
    let calls = 0
    const resolve: ArsenalResolveFn = async () => answers[calls++] as string[]
    const transport = transportOf((_req, call) =>
      call === 1 ? redirectResponse('/next.md') : textResponse('never'))
    const error = await expectDenied(
      fetchTextChecked(README_URL, { resolve, transport }),
      'blocked-address',
    )
    assert.equal(error.hop, 1)
    assert.equal(calls, 2)
  })
})

describe('response bounds', () => {
  it('denies an oversize body (streamed past the cap)', async () => {
    const big: ArsenalTransportResponse = {
      status: 200,
      contentType: 'text/plain',
      location: null,
      body: bodyOf('12345678', '90abcdef', 'more'),
    }
    await expectDenied(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
        transport: staticTransport(big),
        maxBodyBytes: 10,
      }),
      'body-too-large',
    )
  })

  it('denies a non-text content type', async () => {
    await expectDenied(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
        transport: staticTransport(textResponse('{}', 'application/json')),
      }),
      'content-type-not-text',
    )
  })

  it('denies a missing content type (fail closed)', async () => {
    await expectDenied(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
        transport: staticTransport(textResponse('x', null)),
      }),
      'content-type-not-text',
    )
  })
})

describe('parser-level bypass attempts', () => {
  it('denies a decimal-integer loopback host (WHATWG-canonicalized to 127.0.0.1)', async () => {
    const resolveCalls: string[] = []
    await expectDenied(
      fetchTextChecked('https://2130706433/readme.md', {
        resolve: resolverOf({}, resolveCalls),
        transport: staticTransport(textResponse('x')),
      }),
      'blocked-address',
    )
    assert.equal(resolveCalls.length, 0)
  })

  it('denies an octal-form loopback host (0177.0.0.1 → 127.0.0.1)', async () => {
    const resolveCalls: string[] = []
    await expectDenied(
      fetchTextChecked('https://0177.0.0.1/readme.md', {
        resolve: resolverOf({}, resolveCalls),
        transport: staticTransport(textResponse('x')),
      }),
      'blocked-address',
    )
    assert.equal(resolveCalls.length, 0)
  })

  it('denies a userinfo-confusion URL (real host hidden after @)', async () => {
    await expectDenied(
      fetchTextChecked('https://collections.example@127.0.0.1/readme.md', {
        resolve: resolverOf({}),
        transport: staticTransport(textResponse('x')),
      }),
      'credentials-in-url',
    )
  })

  it('denies a protocol-relative redirect onto the metadata address', async () => {
    const transport = transportOf(() => redirectResponse('//169.254.169.254/latest/meta-data'))
    const error = await expectDenied(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
        transport,
      }),
      'blocked-address',
    )
    assert.equal(error.hop, 1)
  })
})

describe('operational failures are FetchFailedError, not denials', () => {
  it('maps a DNS failure to dns-error', async () => {
    const error = await expectFailed(
      fetchTextChecked(README_URL, {
        resolve: async () => {
          throw new Error('ENOTFOUND')
        },
        transport: staticTransport(textResponse('x')),
      }),
      'dns-error',
    )
    assert.equal(error.hop, 0)
  })

  it('maps a non-success status to http-status with the status attached', async () => {
    const error = await expectFailed(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
        transport: staticTransport({
          status: 500,
          contentType: 'text/plain',
          location: null,
          body: bodyOf('boom'),
        }),
      }),
      'http-status',
    )
    assert.equal(error.status, 500)
  })

  it('maps a redirect without a Location header to redirect-without-location', async () => {
    await expectFailed(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
        transport: staticTransport({
          status: 301,
          contentType: null,
          location: null,
          body: bodyOf(),
        }),
      }),
      'redirect-without-location',
    )
  })

  it('maps a transport that never answers to timeout', async () => {
    const error = await expectFailed(
      fetchTextChecked(README_URL, {
        resolve: resolverOf({ 'collections.example': [PUBLIC_A] }),
        transport: async () => new Promise<ArsenalTransportResponse>(() => {}),
        timeoutMs: 25,
      }),
      'timeout',
    )
    assert.equal(error.reason, 'timeout')
  })
})
