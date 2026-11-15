/**
 * Loopback out-of-band collaborator.
 *
 * The Seclayer blind classes (SSRF, blind XXE, blind RCE) can only be proven by a
 * callback the target makes to an address the engagement controls. The vendored
 * `#seclayer/server/oob` module defines that contract but ships only a client for a
 * HOSTED collaborator, so a standalone app has nothing to point a payload at and the
 * honest verdict for those classes is "not run".
 *
 * This module supplies the missing half: an HTTP listener bound to the loopback
 * interface, which is the one address this app can offer without a hosting
 * dependency. It implements the same `OobCollaborator` contract the probes already
 * accept, so wiring it in changes no probe code.
 *
 * What it can and cannot prove: a target that runs on THIS machine (the canonical
 * local-assessment engagement) can reach it, so a callback is genuine proof of a
 * blind class. A target elsewhere cannot reach this machine's loopback, so no
 * callback arrives — and no callback is not evidence of safety. A scan of a remote
 * target that finds nothing here must still report the class as not-run.
 *
 * Tokens are 24 random bytes: unguessable, so an unrelated scanner cannot forge a
 * callback by guessing a URL, and a token that was never issued is refused.
 */

import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { OobCollaborator, OobProbe } from '#seclayer/server/oob.js'
import type { OobEvent } from '#seclayer/src/types.js'

/** Path prefix the collaborator serves callbacks on. */
const CALLBACK_PREFIX = '/oob/'

/** Interval between store reads while a poll waits for a callback. */
const DEFAULT_POLL_INTERVAL_MS = 400

/** Options for {@link createLoopbackOob}. */
export interface LoopbackOobOptions {
  /** Bind address. Only loopback is accepted — see {@link assertLoopback}. */
  host?: string
  /** Interval between arrival checks while polling. */
  pollIntervalMs?: number
}

/** A loopback collaborator, plus the teardown the hosted client does not need. */
export interface LoopbackOob extends OobCollaborator {
  /** Stop the listener and release its port. Idempotent. */
  close(): Promise<void>
}

/**
 * Refuse a non-loopback bind address.
 *
 * Binding a collaborator to a routable interface would expose an unauthenticated
 * callback sink to whatever network the machine is on, which is not something an
 * engagement authorises implicitly.
 * @param host - the requested bind address.
 * @returns the host when it is loopback.
 * @throws Error when the host is not a loopback address.
 */
function assertLoopback(host: string): string {
  if (host === '127.0.0.1' || host === '::1' || host === 'localhost') return host
  throw new Error(`oob-listener: refusing to bind ${host} — the collaborator is loopback-only`)
}

/**
 * Extract the probe token from a callback request path.
 * @param path - the request path, e.g. `/oob/<token>`.
 * @returns the token, or undefined when the path is not a callback URL.
 */
function tokenFromPath(path: string): string | undefined {
  if (!path.startsWith(CALLBACK_PREFIX)) return undefined
  const token = path.slice(CALLBACK_PREFIX.length).split(/[?#]/)[0] ?? ''
  return token === '' ? undefined : token
}

/**
 * Whether a target hostname names THIS machine.
 *
 * Deliberately stricter than the runner's `isPrivateOrLoopbackHost`: a collaborator
 * bound to 127.0.0.1 is reachable only from the machine running this app, so a LAN
 * target at 192.168.x.x is as unreachable as an internet target. Offering the
 * collaborator to either would make the blind-class probe wait its full poll budget
 * for a callback that can never come.
 * @param hostname - the target hostname or bracketed IPv6 literal.
 * @returns true when the address is loopback, i.e. the target is this machine.
 */
export function isLoopbackTarget(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  // 127.0.0.0/8 is loopback in its entirety, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

/**
 * Run a scan step with a collaborator attached exactly when one can work.
 *
 * A blind class (SSRF, blind XXE) is proven only by a callback the target makes to
 * an address this app controls. The collaborator this app can offer without a
 * hosting dependency is a loopback listener, which only a target on THIS machine
 * can reach. So a local target gets one, and a remote target gets none: the blind
 * probe no-ops, and the class is reported not-run rather than clean.
 *
 * The listener is always closed, including when the step throws, so a scan cannot
 * leak a bound port.
 * @param targetUrl - the URL under test; its hostname decides whether a collaborator is offered.
 * @param run - the scan step; receives the collaborator, or undefined when none applies.
 * @returns whatever `run` returns.
 */
export async function withLoopbackOob<T>(
  targetUrl: string,
  run: (oob: OobCollaborator | undefined) => Promise<T>,
): Promise<T> {
  const hostname = new URL(targetUrl).hostname
  if (!isLoopbackTarget(hostname)) return run(undefined)
  const oob = await createLoopbackOob()
  try {
    return await run(oob)
  } finally {
    await oob.close()
  }
}

/**
 * Start a loopback out-of-band collaborator.
 *
 * The listener is unref'd so an idle collaborator never keeps the process alive on
 * its own; callers that need it running hold a scan open, which they already do.
 * @param options - bind address and poll interval; loopback and 400ms by default.
 * @returns the collaborator, listening and ready to issue probes.
 */
export async function createLoopbackOob(options: LoopbackOobOptions = {}): Promise<LoopbackOob> {
  const host = assertLoopback(options.host ?? '127.0.0.1')
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  /** Issued tokens → the callbacks received for them. */
  const received = new Map<string, OobEvent[]>()
  let closed = false

  const server = http.createServer((request, response) => {
    const token = tokenFromPath(request.url ?? '')
    const events = token === undefined ? undefined : received.get(token)
    if (token === undefined || events === undefined) {
      // An unissued token and a wrong path look the same from outside: nothing
      // confirms which URLs are live.
      response.writeHead(404).end()
      return
    }
    const userAgent = request.headers['user-agent']
    events.push({
      id: crypto.randomBytes(8).toString('hex'),
      token,
      method: request.method ?? 'GET',
      sourceIp: request.socket.remoteAddress ?? '',
      path: request.url ?? '',
      ...typeof userAgent === 'string' && userAgent !== '' ? { userAgent } : {},
      receivedAt: new Date().toISOString(),
    })
    // The payload that reached us only needs to know the callback landed.
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.unref()

  const { port } = server.address() as AddressInfo
  const baseUrl = `http://${host === '::1' ? '[::1]' : host}:${port}`

  return {
    baseUrl,
    async issue(): Promise<OobProbe> {
      const token = crypto.randomBytes(24).toString('hex')
      // Register before returning: a target that fires immediately must find a
      // live token, or a genuine callback would be answered 404 and lost.
      received.set(token, [])
      return { token, url: `${baseUrl}${CALLBACK_PREFIX}${token}` }
    },
    async poll(token: string, timeoutMs: number): Promise<OobEvent | null> {
      const deadline = Date.now() + Math.max(0, timeoutMs)
      const first = received.get(token)?.[0]
      if (first !== undefined) return first
      // A token this collaborator never issued can never produce a callback, so
      // there is nothing to wait for.
      if (!received.has(token)) return null
      while (Date.now() < deadline && !closed) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
        const event = received.get(token)?.[0]
        if (event !== undefined) return event
      }
      return null
    },
    async close(): Promise<void> {
      if (closed) return
      closed = true
      // An HTTP client may hold an idle keep-alive connection, and close() waits
      // for every connection to end. Dropping them first makes teardown prompt
      // instead of waiting on a caller that will never reuse the socket.
      await new Promise<void>(resolve => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
  }
}
