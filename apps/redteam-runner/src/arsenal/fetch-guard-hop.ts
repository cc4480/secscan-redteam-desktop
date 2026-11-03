/**
 * One guarded hop — policy checks, DNS resolution, the pinned transport
 * call, and the bounded body read — extracted from `fetch-guard.ts` so the
 * parent module stays inside the runner's 300-line file budget. The hop
 * config/outcome types stay private to this module.
 */
import { parseIpAddress, stripBrackets, type CheckedAddress } from './fetch-guard-address.js'
import {
  DestinationDeniedError,
  FetchFailedError,
  type ArsenalResolveFn,
  type ArsenalTransportFn,
  type ArsenalTransportResponse,
} from './fetch-guard-types.js'
/** Descriptive UA — the runner's MCP client learned the normal-UA lesson (src/mcp.ts). */
const FETCH_USER_AGENT = 'secscan-redteam-runner/0.4.0'
const FETCH_ACCEPT = 'text/plain, text/markdown'

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

interface HopConfig {
  resolve: ArsenalResolveFn
  transport: ArsenalTransportFn
  timeoutMs: number
  maxBodyBytes: number
}

type HopOutcome =
  | { kind: 'final'; text: string }
  | { kind: 'redirect'; location: string }

export async function fetchOneHop(
  urlString: string,
  hop: number,
  cfg: HopConfig,
): Promise<HopOutcome> {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new DestinationDeniedError(urlString, 'invalid-url', hop)
  }
  if (url.protocol !== 'https:') {
    throw new DestinationDeniedError(urlString, 'scheme-not-https', hop, url.protocol)
  }
  if (url.username !== '' || url.password !== '') {
    throw new DestinationDeniedError(urlString, 'credentials-in-url', hop)
  }
  const hostname = stripBrackets(url.hostname)
  if (hostname === '') {
    throw new DestinationDeniedError(urlString, 'invalid-url', hop, 'empty host')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  try {
    // Resolution: a literal IP host IS its own resolution — no DNS involved.
    let addresses: string[]
    if (parseIpAddress(hostname) !== null) {
      addresses = [hostname]
    } else {
      try {
        addresses = await raceAbort(cfg.resolve(hostname), controller.signal, urlString, hop)
      } catch (error) {
        if (error instanceof FetchFailedError) throw error
        throw new FetchFailedError(urlString, 'dns-error', hop, undefined, error)
      }
    }
    if (addresses.length === 0) {
      throw new DestinationDeniedError(urlString, 'no-addresses', hop, hostname)
    }
    // Deny if ANY checked address is non-global; pin the first answer.
    let pinned: CheckedAddress | undefined
    for (const raw of addresses) {
      const checked = parseIpAddress(raw.trim())
      if (checked === null) {
        throw new DestinationDeniedError(urlString, 'unparseable-address', hop, raw)
      }
      if (checked.blocked !== null) {
        throw new DestinationDeniedError(
          urlString,
          'blocked-address',
          hop,
          `${raw} is ${checked.blocked}`,
        )
      }
      pinned ??= checked
    }
    // `pinned` is always set: addresses.length > 0 and the loop cannot
    // complete without assigning it (every iteration either throws or sets it).
    const target = pinned as CheckedAddress

    let response: ArsenalTransportResponse
    try {
      response = await raceAbort(
        cfg.transport({
          url: urlString,
          address: target.canonical,
          family: target.family,
          hostname,
          headers: {
            'user-agent': FETCH_USER_AGENT,
            accept: FETCH_ACCEPT,
          },
          signal: controller.signal,
        }),
        controller.signal,
        urlString,
        hop,
      )
    } catch (error) {
      if (error instanceof FetchFailedError) throw error
      if (controller.signal.aborted) {
        throw new FetchFailedError(urlString, 'timeout', hop, undefined, error)
      }
      throw new FetchFailedError(urlString, 'transport-error', hop, undefined, error)
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      if (response.location === null || response.location === '') {
        throw new FetchFailedError(
          urlString,
          'redirect-without-location',
          hop,
          response.status,
        )
      }
      let next: URL
      try {
        next = new URL(response.location, url)
      } catch {
        throw new DestinationDeniedError(
          urlString,
          'invalid-redirect',
          hop,
          response.location,
        )
      }
      return { kind: 'redirect', location: next.href }
    }
    if (response.status < 200 || response.status > 299) {
      throw new FetchFailedError(urlString, 'http-status', hop, response.status)
    }

    const contentType = (response.contentType ?? '').split(';')[0].trim().toLowerCase()
    if (!(contentType.startsWith('text/') || contentType === 'application/octet-stream')) {
      throw new DestinationDeniedError(
        urlString,
        'content-type-not-text',
        hop,
        contentType === '' ? '(missing)' : contentType,
      )
    }

    const chunks: Buffer[] = []
    let total = 0
    const iterator = response.body[Symbol.asyncIterator]()
    for (;;) {
      let step: IteratorResult<Uint8Array>
      try {
        step = await raceAbort(iterator.next(), controller.signal, urlString, hop)
      } catch (error) {
        if (error instanceof FetchFailedError) throw error
        throw new FetchFailedError(urlString, 'body-read-error', hop, undefined, error)
      }
      if (step.done) break
      total += step.value.byteLength
      if (total > cfg.maxBodyBytes) {
        controller.abort()
        throw new DestinationDeniedError(
          urlString,
          'body-too-large',
          hop,
          `exceeds ${cfg.maxBodyBytes} bytes`,
        )
      }
      chunks.push(Buffer.from(step.value))
    }
    return { kind: 'final', text: Buffer.concat(chunks).toString('utf8') }
  } finally {
    clearTimeout(timer)
  }
}

/** Reject `promise` with a timeout FetchFailedError as soon as `signal` aborts. */
async function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  url: string,
  hop: number,
): Promise<T> {
  if (signal.aborted) {
    throw new FetchFailedError(url, 'timeout', hop)
  }
  let onAbort: (() => void) | undefined
  const abortPromise = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new FetchFailedError(url, 'timeout', hop))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, abortPromise])
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}
