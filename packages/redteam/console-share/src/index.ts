/**
 * Host half of the console merge: one prefix route on the composition's
 * `webServer` carrying the RedTeam runner console's surface into the chat
 * client on the Host's own origin.
 *
 * Why this exists: the console (port 8787) is the engagement cockpit's data
 * source — the A4 console views, the live event feed, scope tallies, Foundry
 * state — and it is token-gated on loopback. The browser holds neither its
 * endpoint nor its token, and must not: the desktop supervisor installs both
 * into this Host process's environment at launch (`REDTEAM_MCP_URL`,
 * `REDTEAM_UI_TOKEN`), and the desktop bundle's patch row hands them to this
 * plugin as configuration. The browser calls only the same-origin share
 * routes registered here; the bearer is attached inside this process by the
 * proxy and never appears in a browser-visible URL, header, or response.
 *
 * Security has one home, here. Every request first asks the composition's
 * `connection` service for a rejection (`requestRejection`): its Host/Origin
 * fence defeats DNS rebinding and cross-site calls, and its browser
 * authentication gates every caller before any console data is reachable.
 * On top of the fence: the proxy forwards only `/api/` paths, and the
 * Arsenal bridge forwards only its three read-only tool names.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { callArsenalTool, isArsenalToolName } from './arsenal.ts'
import { normalizeConsoleBaseUrl, proxyToConsole, sendShareJsonError, type ConsoleTarget } from './proxy.ts'
import {
  CONSOLE_SHARE_ARSENAL_PATH, CONSOLE_SHARE_PREFIX_PATH, type ConsoleShareArsenalPayload,
} from './shared.ts'

export type * from './shared.ts'
export { normalizeConsoleBaseUrl } from './proxy.ts'

/** Cordis function-plugin name. */
export const name = 'redteam-console-share'
/** The route carrier and the trust fence guarding every route. */
export const inject = ['webServer', 'connection']

/** Console-share host configuration. */
export interface Config {
  /**
   * The runner console's address: its base URL or its MCP URL
   * (`REDTEAM_MCP_URL`'s form, ending in `/mcp`); the `/mcp` suffix is
   * stripped at load. Defaults to the bundled console's loopback base.
   */
  readonly baseUrl: string
  /**
   * The console's startup token (`REDTEAM_UI_TOKEN`'s value), attached as
   * the bearer on every forwarded call. The empty string forwards without
   * one — the console then refuses, which the browser sees as the console's
   * own 401 rather than data.
   */
  readonly token: string
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().default('http://127.0.0.1:8787/mcp'),
  token: z.string().default(''),
})

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface ConsoleShareConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** The composition's connection service (typed locally: its package is browser-side). */
function connectionOf(ctx: Context): ConsoleShareConnection {
  return Reflect.get(ctx, 'connection') as ConsoleShareConnection
}

/** Arsenal bridge request bodies are small tool calls; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024

/** JSON response (no-store: console data is live engagement state). */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** Collect a bounded request body as UTF-8 text; null past the ceiling (stream drained). */
async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  // http server streams without setEncoding always yield Buffer chunks.
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      // Drain the remainder so the refusal is a readable response, not a socket cut.
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** Validate one Arsenal bridge body at the wire: a JSON object naming an allowlisted tool. */
function parseArsenalBody(text: string): ConsoleShareArsenalPayload | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // Swallows the parse error: a non-JSON body is exactly the null case.
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const { tool, arguments: args } = body as { tool?: unknown; arguments?: unknown }
  if (typeof tool !== 'string' || !isArsenalToolName(tool)) return null
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) return null
  return { tool, ...(args === undefined ? {} : { arguments: args as Record<string, unknown> }) }
}

/**
 * Register the share prefix route behind the connection trust fence.
 * @param ctx - host context carrying the webServer and connection services.
 * @param config - the console address and token, resolved by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  const target: ConsoleTarget = {
    baseUrl: normalizeConsoleBaseUrl(config.baseUrl),
    token: config.token,
  }
  /** Answer an untrusted/unauthenticated request; true when it was rejected. */
  const rejected = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = connectionOf(ctx).requestRejection(req)
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: CONSOLE_SHARE_PREFIX_PATH,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      // Node always sets url on server requests; String keeps that fact local.
      const url = new URL(String(req.url), 'http://localhost')
      const rest = url.pathname.slice(CONSOLE_SHARE_PREFIX_PATH.length)
      if (rest === CONSOLE_SHARE_ARSENAL_PATH.slice(CONSOLE_SHARE_PREFIX_PATH.length)) {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('allow', 'POST')
          res.end()
          return
        }
        // Body-format validation: the essence must be exactly application/json.
        const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
        if (essence !== 'application/json') {
          sendShareJsonError(res, 415, 'unsupported-media-type', 'content-type must be application/json')
          return
        }
        let text: string | null
        try {
          text = await readBoundedBody(req)
        } catch {
          // Swallows connection errors mid-body: there is nothing left to answer precisely.
          sendShareJsonError(res, 400, 'bad-request', 'request body unreadable')
          return
        }
        if (text === null) {
          sendShareJsonError(res, 413, 'payload-too-large', 'request body is too large')
          return
        }
        const payload = parseArsenalBody(text)
        if (payload === null || !isArsenalToolName(payload.tool)) {
          sendShareJsonError(res, 400, 'bad-request', 'request body must be JSON naming one allowlisted Arsenal tool with an object of arguments')
          return
        }
        const outcome = await callArsenalTool(target, payload.tool, payload.arguments ?? {})
        sendJson(res, outcome.status, outcome.payload)
        return
      }
      if (rest.startsWith('/api/')) {
        proxyToConsole(target, req, res, `${rest}${url.search}`)
        return
      }
      sendShareJsonError(res, 404, 'not-found', `no share route at ${url.pathname}`)
    },
  }), `redteam-console-share: prefix ${CONSOLE_SHARE_PREFIX_PATH}`)
}
