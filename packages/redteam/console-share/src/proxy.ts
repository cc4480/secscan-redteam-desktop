/**
 * The share proxy: one browser request to the console, streamed both ways.
 *
 * The browser addresses only the Host's same-origin share routes; this module
 * re-issues the request against the runner console's loopback base URL with
 * the console bearer attached here, inside the Host process. The token never
 * appears in a browser-visible URL, header, or response. Responses stream —
 * the engagement feed is a server-sent-events response that stays open for
 * the engagement's life, so nothing here may buffer a whole body.
 */
import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'

/** Where the console lives and how the proxy authenticates to it. */
export interface ConsoleTarget {
  /** Console base URL, normalized by {@link normalizeConsoleBaseUrl}. */
  readonly baseUrl: string
  /** Console startup token; the empty string sends no Authorization header. */
  readonly token: string
}

/**
 * Normalize an operator-supplied console address to the base URL the proxy
 * concatenates paths onto. Accepts the console's MCP URL (the form
 * `REDTEAM_MCP_URL` carries) or its bare base: a trailing `/mcp` segment and
 * any trailing slashes are stripped.
 * @param raw - the configured address.
 * @returns the base URL with no trailing slash and no `/mcp` suffix.
 */
export function normalizeConsoleBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  if (url.endsWith('/mcp')) url = url.slice(0, -'/mcp'.length).replace(/\/+$/, '')
  return url
}

/** Hop-by-hop and browser-credential headers the proxy never forwards. */
const REQUEST_DROP_HEADERS: ReadonlySet<string> = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
  // The console authenticates with the bearer attached here; the browser's
  // own Authorization (if any) and the harness login cookie stay behind.
  'authorization', 'cookie',
])

/** Hop-by-hop headers stripped from the console's response. */
const RESPONSE_DROP_HEADERS: ReadonlySet<string> = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
  // The body streams through `pipe`; the upstream length does not describe
  // the re-chunked downstream body.
  'content-length',
])

/**
 * JSON error response (no-store: console reachability is a live fact).
 * @param res - the browser response.
 * @param status - HTTP status code.
 * @param code - stable machine-readable failure code.
 * @param message - human-readable failure detail.
 */
export function sendShareJsonError(res: ServerResponse, status: number, code: string, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify({ code, message }))
}

/**
 * Forward one request to the console and stream its response back.
 * @param target - the console base URL and bearer.
 * @param req - the browser request (its body streams upstream).
 * @param res - the browser response (the console's response streams into it).
 * @param upstreamPath - the console path plus query string, e.g. `/api/engagements/<id>/events?after=3`.
 */
export function proxyToConsole(
  target: ConsoleTarget,
  req: IncomingMessage,
  res: ServerResponse,
  upstreamPath: string,
): void {
  const url = new URL(upstreamPath, `${target.baseUrl}/`)
  const headers: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || REQUEST_DROP_HEADERS.has(name.toLowerCase())) continue
    headers[name] = value
  }
  if (target.token !== '') headers['authorization'] = `Bearer ${target.token}`
  const issue = url.protocol === 'https:' ? httpsRequest : httpRequest
  const upstream = issue(url, { method: req.method ?? 'GET', headers }, (upstreamRes) => {
    const responseHeaders: OutgoingHttpHeaders = {}
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined || RESPONSE_DROP_HEADERS.has(name.toLowerCase())) continue
      responseHeaders[name] = value
    }
    res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders)
    upstreamRes.pipe(res)
    // A browser that goes away mid-feed ends the console read with it.
    res.on('close', () => { upstreamRes.destroy() })
  })
  upstream.on('error', (error) => {
    if (!res.headersSent && !res.writableEnded) {
      sendShareJsonError(res, 502, 'console-unavailable', `runner console unreachable: ${error.message}`)
    } else {
      res.destroy()
    }
  })
  // A browser that aborts its request ends the console request with it.
  req.on('aborted', () => { upstream.destroy() })
  req.pipe(upstream)
}
