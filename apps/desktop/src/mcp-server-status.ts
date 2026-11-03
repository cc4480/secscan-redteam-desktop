/**
 * Per-server MCP status for the welcome window's MCP settings surface.
 *
 * The harness rows fail silently from the operator's seat: a configured
 * server that is down, rejects its token, or advertises no tools registers
 * zero `mcp__<server>__*` tools and the only record is a Host log line. This
 * probe gives the settings surface the row's real state at the moment it is
 * opened, using the same sources and handshake the rows themselves use: the
 * endpoint and credential each cordis row is composed from, an MCP
 * `initialize` (the reply's advertised capabilities decide the tools-less
 * state, exactly as the harness's tool sync reads them), and a `tools/list`
 * for the count. It is visibility only — nothing here starts, stops, or
 * reconfigures a row, and no row's `failOnStartupError` changes.
 *
 * No credential value leaves this module: a row's token or key is used only
 * as the probe's own bearer or child environment, and every reported detail
 * is a fixed phrase or an HTTP status.
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpServerStatusItem } from './welcome-api.ts'

/** The SecScan row's endpoint, as composed in the desktop bundle patch. */
const SECSCAN_MCP_URL = 'https://secscan.us/api/mcp'

/** The Seclayer row's stdio command arguments, as composed in the desktop bundle patch. */
const SECLAYER_MCP_ARGS: readonly string[] = ['-y', '@seclayer/mcp@1.0.0']

/** MCP protocol version the in-repo clients and servers speak. */
const PROTOCOL_VERSION = '2025-03-26'

/** Default budget for one probe round trip; a server slower than this reads as failed, never as healthy. */
const DEFAULT_TIMEOUT_MS = 5_000

/** The bridge endpoint used when `PC_BRIDGE_URL` is unset, malformed, or not HTTP(S). */
const DEFAULT_BRIDGE_MCP_URL = 'http://127.0.0.1:8765/mcp'

/** The narrow HTTP response surface the probe reads. */
export interface McpHttpResponse {
  /** Whether the status is in the 2xx range. */
  ok: boolean
  /** HTTP status code. */
  status: number
  /** Response headers, read for the MCP session id only. */
  headers: { get(name: string): string | null }
  /** @returns the response body as text (JSON or SSE framing). */
  text(): Promise<string>
}

/** One HTTP request the probe issues. */
export interface McpHttpRequestInit {
  /** Always POST for MCP streamable HTTP. */
  method: string
  /** Header values by lowercase name; an absent session or token is `undefined`. */
  headers: Record<string, string | undefined>
  /** Serialized JSON-RPC message. */
  body: string
  /** Deadline signal for the round trip. */
  signal?: AbortSignal | undefined
}

/** Injectable HTTP transport; the default wraps the global `fetch`. */
export type McpHttpFetch = (url: string, init: McpHttpRequestInit) => Promise<McpHttpResponse>

/** The narrow child-process surface the stdio probe drives. */
export interface McpStdioChild {
  /** The child's standard input, written with newline-delimited JSON-RPC. */
  stdin: { write(chunk: string): void }
  /** The child's standard output, read as newline-delimited JSON-RPC. */
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): void }
  /**
   * Subscribe to the child's exit or spawn error.
   * @param event - lifecycle event to observe.
   * @param listener - invoked with the exit code or error.
   */
  on(event: 'exit' | 'error', listener: (...args: unknown[]) => void): void
  /** Terminate the child; the probe kills every child it spawned once it has its answer. */
  kill(): void
}

/** Injectable stdio spawn; the default spawns the row's own command. */
export type McpStdioSpawn = (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => McpStdioChild

/** Where each row's probe target and credential come from, assembled by the shell from the environment and the credential document. */
export interface McpServerProbeInputs {
  /** Effective SecScan MCP token; absent or empty means the row is unkeyed and is not probed. */
  secscanToken?: string | undefined
  /** Effective Seclayer API key; absent or empty means the row is unkeyed and is not probed. */
  seclayerKey?: string | undefined
  /** Effective engagement-runner console endpoint, the same value the MCP step shows. */
  runnerEndpoint: string
  /** Effective runner token the row presents; the bundled console's own token counts. */
  runnerToken?: string | undefined
  /** Raw bridge base URL (`PC_BRIDGE_URL`); resolution follows the bridge row's own rule. */
  bridgeUrl?: string | undefined
  /** Bridge token file (`PC_BRIDGE_TOKEN_FILE`); absent or empty means the default paired-token path. */
  bridgeTokenFile?: string | undefined
  /** Home directory the default bridge token path hangs from; defaults to the OS home. */
  homeDir?: string | undefined
}

/** Injectable transports and budgets for {@link probeMcpServers}; production uses the defaults. */
export interface McpServerStatusOptions {
  /** HTTP transport for the three streamable-HTTP rows. */
  fetch?: McpHttpFetch | undefined
  /** Spawn for the Seclayer stdio row. */
  spawn?: McpStdioSpawn | undefined
  /**
   * Read the bridge token file.
   * @param path - resolved token file path.
   * @returns the file's contents, or `undefined` when it cannot be read.
   */
  readTokenFile?: ((path: string) => Promise<string | undefined>) | undefined
  /** Environment the Seclayer child inherits (its key is merged over it). */
  environment?: NodeJS.ProcessEnv | undefined
  /** Per-probe deadline in milliseconds. */
  timeoutMs?: number | undefined
}

/** One row's probed outcome, before its identity and label are attached. */
interface ProbeOutcome {
  /** The state the row renders with. */
  state: McpServerStatusItem['state']
  /** Tools the server listed; present only for `connected` and `no-tools`. */
  toolCount?: number | undefined
  /** Safe failure detail, e.g. `HTTP 401`. */
  detail?: string | undefined
}

/** @returns whether the value is a JSON object, which every MCP reply is. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Resolve the bridge row's MCP endpoint from its base URL, mirroring the
 * row's own composition rule: a bare origin gets `/mcp` appended, a URL that
 * already carries a path is used as given, and a malformed or non-HTTP(S)
 * value falls back to the loopback default.
 *
 * @param raw - the raw `PC_BRIDGE_URL` value, if any.
 * @returns the MCP endpoint the bridge row connects to.
 */
export function resolveBridgeMcpEndpoint(raw: string | undefined): string {
  const base = (raw ?? '').trim() || 'http://127.0.0.1:8765'
  try {
    const parsed = new URL(base)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return DEFAULT_BRIDGE_MCP_URL
    if (parsed.pathname.replace(/\/+$/, '') === '') parsed.pathname = '/mcp'
    return parsed.toString()
  } catch {
    return DEFAULT_BRIDGE_MCP_URL
  }
}

/**
 * Parse one MCP reply body, which arrives as plain JSON or as SSE `data:`
 * frames depending on the server.
 *
 * @param text - the raw response body.
 * @returns the first JSON-RPC message in the body, or `undefined` when none parses.
 */
function parseRpcBody(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return record(parsed) ? parsed : undefined
  } catch {
    // SSE framing: one JSON message per `data:` line; the reply we asked for is among them.
    for (const line of trimmed.split('\n')) {
      if (!line.startsWith('data:')) continue
      try {
        const parsed: unknown = JSON.parse(line.slice('data:'.length).trim())
        if (record(parsed)) return parsed
      } catch {
        // A keep-alive or partial frame is not the reply; keep scanning.
      }
    }
    return undefined
  }
}

/** The default HTTP transport: the global fetch, with unset headers omitted. */
const defaultFetch: McpHttpFetch = async (url, init) => {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(init.headers)) {
    if (value !== undefined) headers[name] = value
  }
  return fetch(url, {
    method: init.method, headers, body: init.body,
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
  })
}

/** The default stdio spawn: the row's command with piped stdio, adapted to {@link McpStdioChild}. */
const defaultSpawn: McpStdioSpawn = (command, args, env) => {
  const child = spawn(command, [...args], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  if (child.stdin === null || child.stdout === null) {
    child.kill()
    throw new Error('mcp-server-status: the stdio child has no piped stdio')
  }
  const stdin = child.stdin
  const stdout = child.stdout
  return {
    stdin: { write: (chunk: string) => { stdin.write(chunk) } },
    stdout: { on: (event, listener) => { stdout.on(event, listener) } },
    on: (event, listener) => { child.on(event, listener) },
    kill: () => { child.kill() },
  }
}

/**
 * Read a token file's contents; pairing is judged by the caller under the
 * consumers' own rule (a missing, unreadable, or whitespace-only file is not
 * a pairing).
 *
 * @param path - the token file to read.
 * @returns the file's contents, or `undefined` when it cannot be read.
 */
async function defaultReadTokenFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Probe one streamable-HTTP row: initialize, then — only when the reply
 * advertises a tools capability — list its tools and count them. This is the
 * same handshake the harness performs; a tools-less reply is reported as
 * `no-tools`, never as a healthy connection.
 *
 * @param fetchImpl - HTTP transport.
 * @param url - the row's MCP endpoint.
 * @param token - the bearer token the row presents.
 * @param timeoutMs - deadline per round trip.
 * @returns the row's outcome; every failure is a `failed` outcome, never a throw.
 */
async function probeHttpServer(fetchImpl: McpHttpFetch, url: string, token: string, timeoutMs: number): Promise<ProbeOutcome> {
  let sessionId: string | undefined
  const post = async (message: Record<string, unknown>): Promise<{ response: McpHttpResponse; parsed: Record<string, unknown> | undefined }> => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(timeoutMs),
    })
    sessionId = response.headers.get('mcp-session-id') ?? sessionId
    return { response, parsed: parseRpcBody(await response.text()) }
  }
  try {
    const initialized = await post({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'secscan-mcp-settings', version: '1' } },
    })
    if (!initialized.response.ok) return { state: 'failed', detail: `HTTP ${initialized.response.status}` }
    const result = initialized.parsed !== undefined && record(initialized.parsed.result) ? initialized.parsed.result : undefined
    if (initialized.parsed === undefined || initialized.parsed.error !== undefined || result === undefined) return { state: 'failed' }
    const capabilities = record(result.capabilities) ? result.capabilities : undefined
    if (capabilities?.tools === undefined) return { state: 'no-tools', toolCount: 0 }
    try {
      await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
    } catch {
      // The notification is fire-and-forget; the tools/list reply below is the verdict.
    }
    const listed = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    if (!listed.response.ok) return { state: 'failed', detail: `HTTP ${listed.response.status}` }
    const listResult = listed.parsed !== undefined && record(listed.parsed.result) ? listed.parsed.result : undefined
    if (listed.parsed === undefined || listed.parsed.error !== undefined || listResult === undefined || !Array.isArray(listResult.tools)) {
      return { state: 'failed' }
    }
    return { state: 'connected', toolCount: listResult.tools.length }
  } catch {
    return { state: 'failed' }
  }
}

/**
 * Probe the Seclayer stdio row: spawn the row's own command with its key,
 * speak newline-delimited JSON-RPC, and count the listed tools. The child is
 * always killed once the probe settles — the settings surface borrows the
 * server for one handshake and never leaves a second copy running.
 *
 * @param spawnImpl - child factory.
 * @param key - the Seclayer API key the row presents.
 * @param environment - environment the child inherits; the key merges over it.
 * @param timeoutMs - deadline for the whole handshake.
 * @returns the row's outcome; every failure is a `failed` outcome, never a throw.
 */
async function probeStdioServer(spawnImpl: McpStdioSpawn, key: string, environment: NodeJS.ProcessEnv, timeoutMs: number): Promise<ProbeOutcome> {
  let child: McpStdioChild
  try {
    child = spawnImpl(process.platform === 'win32' ? 'npx.cmd' : 'npx', SECLAYER_MCP_ARGS, { ...environment, SECLAYER_API_KEY: key })
  } catch {
    return { state: 'failed' }
  }
  return new Promise<ProbeOutcome>((resolve) => {
    let settled = false
    let phase: 'initialize' | 'tools' = 'initialize'
    let buffer = ''
    const finish = (outcome: ProbeOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolve(outcome)
    }
    const timer = setTimeout(() => { finish({ state: 'failed' }) }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (line.trim() === '') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        if (!record(parsed)) continue
        if (phase === 'initialize' && parsed.id === 1) {
          const result = record(parsed.result) ? parsed.result : undefined
          if (parsed.error !== undefined || result === undefined) { finish({ state: 'failed' }); return }
          const capabilities = record(result.capabilities) ? result.capabilities : undefined
          if (capabilities?.tools === undefined) { finish({ state: 'no-tools', toolCount: 0 }); return }
          phase = 'tools'
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`)
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
        } else if (phase === 'tools' && parsed.id === 2) {
          const result = record(parsed.result) ? parsed.result : undefined
          if (parsed.error !== undefined || result === undefined || !Array.isArray(result.tools)) { finish({ state: 'failed' }); return }
          finish({ state: 'connected', toolCount: result.tools.length })
          return
        }
      }
    })
    child.on('exit', () => { finish({ state: 'failed' }) })
    child.on('error', () => { finish({ state: 'failed' }) })
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'secscan-mcp-settings', version: '1' } },
    })}\n`)
  })
}

/**
 * Probe every configured MCP row and return one status item per row, in the
 * order the MCP step presents them. Rows without a seated credential are
 * named (`unkeyed` / `unpaired`) without being probed, because probing them
 * could only reproduce the harness's silent 401 or empty-token spawn.
 *
 * @param inputs - each row's endpoint and credential sources.
 * @param options - injectable transports and budgets; production uses the defaults.
 * @returns the four rows' status items.
 */
export async function probeMcpServers(inputs: McpServerProbeInputs, options: McpServerStatusOptions = {}): Promise<McpServerStatusItem[]> {
  const fetchImpl = options.fetch ?? defaultFetch
  const spawnImpl = options.spawn ?? defaultSpawn
  const readTokenFile = options.readTokenFile ?? defaultReadTokenFile
  const environment = options.environment ?? process.env
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const tokenFile = (inputs.bridgeTokenFile ?? '').trim() || join(inputs.homeDir ?? homedir(), '.config', 'pc-bridge', 'token')
  const bridgeTokenFileContents = await readTokenFile(tokenFile)
  const bridgeToken = bridgeTokenFileContents !== undefined && bridgeTokenFileContents.trim() !== ''
    ? bridgeTokenFileContents.trim()
    : undefined

  const secscanToken = inputs.secscanToken
  const secscan: Promise<ProbeOutcome> = secscanToken !== undefined && secscanToken.trim() !== ''
    ? probeHttpServer(fetchImpl, SECSCAN_MCP_URL, secscanToken, timeoutMs)
    : Promise.resolve({ state: 'unkeyed' })
  const seclayerKey = inputs.seclayerKey
  const seclayer: Promise<ProbeOutcome> = seclayerKey !== undefined && seclayerKey.trim() !== ''
    ? probeStdioServer(spawnImpl, seclayerKey, environment, timeoutMs)
    : Promise.resolve({ state: 'unkeyed' })
  const redteam: Promise<ProbeOutcome> = probeHttpServer(fetchImpl, inputs.runnerEndpoint, inputs.runnerToken ?? '', timeoutMs)
  const alterego: Promise<ProbeOutcome> = bridgeToken === undefined
    ? Promise.resolve({ state: 'unpaired' })
    : probeHttpServer(fetchImpl, resolveBridgeMcpEndpoint(inputs.bridgeUrl), bridgeToken, timeoutMs)

  const [secscanOutcome, seclayerOutcome, redteamOutcome, alteregoOutcome] = await Promise.all([secscan, seclayer, redteam, alterego])
  return [
    { id: 'secscan', label: 'SecScan MCP', ...secscanOutcome },
    { id: 'seclayer', label: 'Seclayer MCP', ...seclayerOutcome },
    { id: 'redteam', label: 'Engagement runner', ...redteamOutcome },
    { id: 'alterego', label: 'AlterEgo bridge', ...alteregoOutcome },
  ]
}
