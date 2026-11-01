/**
 * The Arsenal bridge: the one place the browser-facing share surface speaks
 * MCP, so the browser never has to.
 *
 * The runner console exposes its Arsenal index only as MCP tools on its
 * token-gated `/mcp` endpoint (there are no Arsenal HTTP routes). The bridge
 * accepts exactly the three read-only Arsenal tools, forwards each as a
 * stateless JSON-RPC `tools/call` with the console bearer attached
 * server-side, and answers the browser with the tool's own JSON result. Any
 * other tool name is refused here, before anything is sent.
 */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { ARSENAL_TOOL_NAMES, type ArsenalToolName, type ConsoleShareErrorPayload } from './shared.ts'
import type { ConsoleTarget } from './proxy.ts'

/** Response-body ceiling for one Arsenal answer; search results are bounded lists, never megabytes. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/** Deadline for one Arsenal call; the index answers in milliseconds when healthy. */
const CALL_TIMEOUT_MS = 30_000

/**
 * Whether a requested tool name is one the bridge forwards.
 * @param tool - the requested tool name.
 * @returns true when the name is on the read-only Arsenal allowlist.
 */
export function isArsenalToolName(tool: string): tool is ArsenalToolName {
  return (ARSENAL_TOOL_NAMES as readonly string[]).includes(tool)
}

/** One settled bridge call: the HTTP status and JSON payload for the browser. */
export interface ArsenalCallOutcome {
  /** HTTP status the share route answers with. */
  readonly status: number
  /** The tool's parsed JSON result, or a {@link ConsoleShareErrorPayload}. */
  readonly payload: unknown
}

function failure(status: number, code: string, message: string): ArsenalCallOutcome {
  const payload: ConsoleShareErrorPayload = { code, message }
  return { status, payload }
}

interface RpcResponse {
  readonly result?: {
    readonly isError?: boolean
    readonly content?: readonly { readonly type?: string; readonly text?: string }[]
  }
  readonly error?: { readonly message?: string }
}

/**
 * Call one allowlisted Arsenal tool on the console's `/mcp` endpoint.
 * @param target - the console base URL and bearer.
 * @param tool - the allowlisted tool name.
 * @param args - the tool arguments, forwarded verbatim.
 * @returns the outcome to answer the browser with.
 */
export async function callArsenalTool(
  target: ConsoleTarget,
  tool: ArsenalToolName,
  args: Record<string, unknown>,
): Promise<ArsenalCallOutcome> {
  const url = new URL('/mcp', `${target.baseUrl}/`)
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  })
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    ...(target.token === '' ? {} : { authorization: `Bearer ${target.token}` }),
  }
  const issue = url.protocol === 'https:' ? httpsRequest : httpRequest
  let text: string
  try {
    text = await new Promise<string>((resolve, reject) => {
      const upstream = issue(url, { method: 'POST', headers }, (upstreamRes) => {
        const chunks: Buffer[] = []
        let size = 0
        upstreamRes.on('data', (chunk: Buffer) => {
          size += chunk.byteLength
          if (size > MAX_RESPONSE_BYTES) {
            upstreamRes.destroy(new Error(`arsenal response exceeded ${MAX_RESPONSE_BYTES} bytes`))
            return
          }
          chunks.push(chunk)
        })
        upstreamRes.on('end', () => { resolve(Buffer.concat(chunks, size).toString('utf8')) })
        upstreamRes.on('error', reject)
      })
      upstream.setTimeout(CALL_TIMEOUT_MS, () => {
        upstream.destroy(new Error(`arsenal call timed out after ${CALL_TIMEOUT_MS} ms`))
      })
      upstream.on('error', reject)
      upstream.end(body)
    })
  } catch (error) {
    return failure(502, 'console-unavailable', `runner console unreachable: ${(error as Error).message}`)
  }
  let rpc: RpcResponse
  try {
    rpc = JSON.parse(text) as RpcResponse
  } catch {
    // Swallows the parse error: a non-JSON answer is exactly the bad-response case.
    return failure(502, 'arsenal-bad-response', 'the console answered the Arsenal call with a non-JSON response')
  }
  if (rpc.error !== undefined) {
    return failure(502, 'arsenal-error', rpc.error.message ?? 'the console refused the Arsenal call')
  }
  const resultText = rpc.result?.content?.[0]?.text
  if (rpc.result === undefined || resultText === undefined) {
    return failure(502, 'arsenal-bad-response', 'the console answered the Arsenal call without a tool result')
  }
  if (rpc.result.isError === true) {
    return failure(502, 'arsenal-tool-failed', resultText)
  }
  try {
    return { status: 200, payload: JSON.parse(resultText) as unknown }
  } catch {
    // The tools answer JSON text today; a future plain-text answer still
    // reaches the browser, wrapped rather than dropped.
    return { status: 200, payload: { text: resultText } }
  }
}
