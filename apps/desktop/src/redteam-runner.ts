/** The bundled engagement runner, as one supervised loopback child of the Desktop process. */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import {
  REDTEAM_CONSOLE_ENVIRONMENT_NAMES,
  type McpEnvironmentName,
} from './mcp-credential-contract.ts'
import { desktopNodeEnvironment } from './node-environment.ts'

/** Directory the packaged payload occupies beside the bundled runtime. */
export const REDTEAM_RUNNER_RESOURCE_DIRECTORY = 'redteam-runner'

/** Entry point inside that directory, which is the runner's own `bin` field. */
export const REDTEAM_RUNNER_ENTRY = 'dist/cli.js'

/** Directory the packaged tool payload occupies beside the bundled runner. */
export const REDTEAM_TOOLS_RESOURCE_DIRECTORY = 'tools'

/** Port the console prefers, and the one an operator's own console normally holds. */
export const DEFAULT_REDTEAM_RUNNER_PORT = 8787

/** Only address the console is ever bound to: it drives live pentest tooling. */
export const REDTEAM_RUNNER_LOOPBACK = '127.0.0.1'

/** Server name the console reports in its MCP `initialize` reply, which is what readiness means. */
export const REDTEAM_RUNNER_SERVER_NAME = 'secscan-redteam-runner'

/** Deadline for the console to answer its first MCP request. */
export const REDTEAM_RUNNER_READY_TIMEOUT_MS = 20_000

/** Deadline for the child to exit after each termination signal. */
export const REDTEAM_RUNNER_EXIT_TIMEOUT_MS = 5_000

/** Pause between readiness probes; the console binds its port within milliseconds of starting. */
const READY_POLL_INTERVAL_MS = 250

/** Budget for one readiness probe, so a hung console cannot consume the whole deadline. */
const PROBE_TIMEOUT_MS = 2_000

/** Strength floor the runner enforces on a token handed to it; a shorter value would fail its startup. */
const MINIMUM_TOKEN_LENGTH = 16

/** Bytes of entropy in a generated token; the runner's own generator uses 32. */
const TOKEN_BYTES = 32

/** Child output retained for the failure message and the crash report. */
const MAX_DIAGNOSTIC_CHARS = 8 * 1024

/** Share of that output quoted in an error message, which a native dialog has to stay readable in. */
const DIAGNOSTIC_IN_MESSAGE_CHARS = 400

/** Where the payload lives and which runtime executes it. */
export interface RedteamRunnerResources {
  /** Application executable used as the bundled Node runtime, run in Node mode. */
  readonly node: string
  /** Absolute directory holding the runner's manifest, its `dist`, and its dependencies. */
  readonly directory: string
}

/** Endpoint and bearer token the console process and the MCP client rows share. */
export interface RedteamRunnerConsole {
  /** Streamable-HTTP MCP endpoint on loopback. */
  readonly endpoint: string
  /** Bearer token both sides present. */
  readonly token: string
}

/** How one installation resolves its bundled payload on a launch. */
export interface RedteamRunnerLocation {
  /** Whether this launch is the packaged application, which fixes where its resources are. */
  readonly packaged: boolean
  /** `process.resourcesPath` of this application. */
  readonly resourcesPath: string
  /** `app.getAppPath()`; an unpackaged launch reaches the payload through this directory. */
  readonly appPath: string
  /** Application executable used as the bundled Node runtime. */
  readonly node: string
  /** Launch environment, which may point an unpackaged run at another payload directory. */
  readonly environment?: NodeJS.ProcessEnv
}

/** Lifecycle inputs of one {@link DesktopRedteamRunner}. */
export interface RedteamRunnerOptions {
  /** Directory the console keeps engagement state in; installation-owned and per user. */
  readonly engagementsDir: string
  /** Environment names this process already installed from the operator's credential document. */
  readonly installed: ReadonlySet<McpEnvironmentName>
  /** Overrides the loopback port probe; a test supplies a fixed port instead of binding one. */
  readonly allocatePort?: (preferred: number) => Promise<number>
  /** Overrides the readiness probe; a test answers without a socket. */
  readonly probe?: (endpoint: string, token: string) => Promise<boolean>
  /** Shortened deadlines, so a test exercises a failure path without waiting out the production budget. */
  readonly timeouts?: {
    /** Readiness deadline; defaults to {@link REDTEAM_RUNNER_READY_TIMEOUT_MS}. */
    readonly readyMs?: number
    /** Exit deadline per termination signal; defaults to {@link REDTEAM_RUNNER_EXIT_TIMEOUT_MS}. */
    readonly exitMs?: number
  }
}

/** The bundled console could not be started; the engagement tools would otherwise be silently absent. */
export class DesktopRedteamRunnerStartupError extends Error {}

/**
 * Resolve the directory a launch executes the runner from.
 * A packaged install carries it beside the runtime; an unpackaged launch reads the
 * checked-in payload, or the directory the environment names.
 * @param location - Where this application's resources are and how it was launched.
 * @returns Payload directory and the runtime that executes it.
 */
export function redteamRunnerResources(location: RedteamRunnerLocation): RedteamRunnerResources {
  const configured = location.environment?.DSH_DESKTOP_REDTEAM_RUNNER_DIR
  if (configured !== undefined && configured !== '') return { node: location.node, directory: configured }
  return {
    node: location.node,
    directory: location.packaged
      ? join(location.resourcesPath, REDTEAM_RUNNER_RESOURCE_DIRECTORY)
      : join(location.appPath, 'resources', REDTEAM_RUNNER_RESOURCE_DIRECTORY),
  }
}

/**
 * Resolve the directory the bundled tools payload is read from.
 * The payload sits beside the runner payload this launch executes, and the console
 * resolves nmap, ffuf, nuclei and the wordlists from it ahead of PATH. An operator who
 * exported a directory has provisioned it themselves, so their value wins.
 * @param location - Where this application's resources are and how it was launched.
 * @returns Directory holding the bundled tool payloads.
 */
export function redteamToolsDirectory(location: RedteamRunnerLocation): string {
  const configured = location.environment?.REDTEAM_TOOLS_DIR
  if (configured !== undefined && configured !== '') return configured
  return join(dirname(redteamRunnerResources(location).directory), REDTEAM_TOOLS_RESOURCE_DIRECTORY)
}

/**
 * Build the console's MCP endpoint.
 * @param port - Loopback port the console listens on.
 * @returns Streamable-HTTP MCP endpoint on `127.0.0.1`.
 */
export function redteamConsoleEndpoint(port: number): string {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop engagement runner: ${String(port)} is not a loopback port`)
  }
  return `http://${REDTEAM_RUNNER_LOOPBACK}:${String(port)}/mcp`
}

/**
 * Mint a token for a console this application starts itself.
 * @returns 32 bytes of entropy as hexadecimal, the length the runner generates for itself.
 */
export function generatedRedteamToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex')
}

/**
 * Decide whether a stored token can be handed to the runner.
 * The runner refuses anything below its own strength floor at startup, so a value
 * that cannot clear it is replaced by a generated one instead of failing the launch.
 * @param value - candidate token, usually one an operator stored for the console.
 * @returns whether the runner would accept it.
 */
export function isRedteamConsoleToken(value: string): boolean {
  return value.trim().length >= MINIMUM_TOKEN_LENGTH
}

/**
 * Pick a loopback port for the console, preferring the one an operator's console uses.
 * The preferred port is tried first so a fixed bookmark or a previously configured
 * endpoint keeps working; a host that already holds it gets an ephemeral port instead
 * of a failed launch. Nothing is ever bound beyond loopback.
 * @param preferred - Port to try first.
 * @param host - Loopback address to bind; tests use the default.
 * @returns A port that was free on that address when it was checked.
 */
export async function allocateLoopbackPort(preferred: number, host = REDTEAM_RUNNER_LOOPBACK): Promise<number> {
  const attempt = (port: number): Promise<number | undefined> => new Promise((resolvePort) => {
    const server = createServer()
    server.unref()
    server.once('error', () => { resolvePort(undefined) })
    server.listen(port, host, () => {
      const address = server.address()
      const bound = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => { resolvePort(bound) })
    })
  })
  const chosen = (await attempt(preferred)) ?? (await attempt(0))
  if (chosen === undefined || chosen < 1) {
    throw new DesktopRedteamRunnerStartupError(`desktop engagement runner: no free port on ${host}`)
  }
  return chosen
}

/** @returns whether the value is a JSON object, which every MCP reply is. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Ask the console for its MCP server identity, which is what being ready means here.
 * A probe that answered from the port alone could accept a different service; this
 * one also proves the token the MCP rows will present is the token it expects.
 * @param endpoint - Console MCP endpoint.
 * @param token - Bearer token the console was started with.
 * @param timeoutMs - Budget for the round trip.
 * @returns whether the console answered `initialize` as itself.
 */
export async function probeRedteamConsole(endpoint: string, token: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const body: unknown = await response.json()
    if (!record(body) || !record(body.result) || !record(body.result.serverInfo)) return false
    return body.result.serverInfo.name === REDTEAM_RUNNER_SERVER_NAME
  } catch {
    return false
  }
}

/** @returns whether `exit` settles within the deadline. */
async function settledWithin(exit: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      exit.then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => { resolve(false) }, milliseconds) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** @returns completion after the pause. */
async function pause(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, milliseconds) })
}

/**
 * One engagement engine: the runner the application ships, started on loopback with a
 * token this process owns, and stopped with this process.
 *
 * The MCP client rows read `REDTEAM_MCP_URL` and `REDTEAM_UI_TOKEN` from the environment
 * while cordis composes the profile, so `start()` installs both in the very object the
 * Host is spawned with. An endpoint or token the operator already supplied - exported,
 * or stored in this installation's credential document - describes a console this
 * process did not start, and it wins: the bundled runner then stays off and nothing is
 * overwritten.
 *
 * The console itself is spawned with `REDTEAM_TOOLS_DIR` pointing at the tools payload
 * beside the runner, because the runner resolves its bundled binaries - nmap, ffuf,
 * nuclei, the wordlists - from that directory ahead of PATH. A directory the operator
 * exported is passed through unchanged and never overwritten. When this installation
 * carries no tools payload the variable is left unset, so the tools stay PATH-resolved
 * and readiness reports them missing rather than claiming they are present.
 */
export class DesktopRedteamRunner {
  private child: ChildProcess | undefined
  private exited: Promise<void> | undefined
  private diagnostic = ''
  private active: RedteamRunnerConsole | undefined
  private stopping = false
  private exitHook: (() => void) | undefined

  /**
   * @param resources - Payload directory and the bundled Node runtime that executes it.
   * @param environment - Environment the MCP client rows read; the console values are installed here.
   * @param options - Engagement storage, the operator's own environment names, and test seams.
   */
  constructor(
    private readonly resources: RedteamRunnerResources,
    private readonly environment: NodeJS.ProcessEnv,
    private readonly options: RedteamRunnerOptions,
  ) {}

  /**
   * Environment names this process owns for the bundled console.
   * Empty while the console is suppressed or stopped, which is what keeps a configured
   * installation from reporting its own generated token as an operator-supplied one.
   */
  get consoleEnvironmentNames(): ReadonlySet<McpEnvironmentName> {
    return this.active === undefined
      ? new Set<McpEnvironmentName>()
      : new Set<McpEnvironmentName>(REDTEAM_CONSOLE_ENVIRONMENT_NAMES)
  }

  /**
   * Start the console, or report that an operator-supplied one wins.
   * @returns The endpoint and token the MCP rows will use, or `undefined` when the
   * bundled runner is suppressed by a configured console.
   * @throws DesktopRedteamRunnerStartupError when the payload is absent, the child exits,
   * or no MCP reply arrives before the readiness deadline.
   */
  async start(): Promise<RedteamRunnerConsole | undefined> {
    if (this.active !== undefined) return this.active
    const operator = REDTEAM_CONSOLE_ENVIRONMENT_NAMES.filter(name => !this.options.installed.has(name)
      && (this.environment[name] ?? '') !== '')
    if (operator.length > 0) {
      // The person is driving a shared or remote console; the bundled one must not compete for it.
      console.info(`desktop engagement runner: ${operator.join(' and ')} came from the launch environment, so the bundled console stays off`)
      return undefined
    }
    const configured = (this.environment.REDTEAM_MCP_URL ?? '').trim()
    if (configured !== '') {
      console.info(`desktop engagement runner: a console endpoint is configured (${configured}), so the bundled console stays off`)
      return undefined
    }

    const entry = join(this.resources.directory, REDTEAM_RUNNER_ENTRY)
    if (!existsSync(entry)) {
      throw new DesktopRedteamRunnerStartupError(
        `desktop engagement runner: ${entry} is missing, so this installation does not carry the engagement engine. `
        + 'Reinstall the application, or set REDTEAM_MCP_URL to a console you run yourself.',
      )
    }
    const port = await (this.options.allocatePort ?? allocateLoopbackPort)(DEFAULT_REDTEAM_RUNNER_PORT)
    const endpoint = redteamConsoleEndpoint(port)
    const stored = (this.environment.REDTEAM_UI_TOKEN ?? '').trim()
    // A stored token is the operator's, and reusing it keeps the row's bearer value
    // identical across the upgrade that starts bundling the runner.
    const token = isRedteamConsoleToken(stored) ? stored : generatedRedteamToken()
    mkdirSync(this.options.engagementsDir, { recursive: true })
    // Resolved before spawning so the console inherits one directory for the whole run,
    // and so an absent payload costs nothing: the variable is then simply not installed.
    const toolsDirectory = this.bundledToolsDirectory()

    const child = spawn(this.resources.node, [
      entry,
      'ui',
      '--port', String(port),
      '--listen', REDTEAM_RUNNER_LOOPBACK,
      '--engagements-dir', this.options.engagementsDir,
    ], {
      cwd: this.resources.directory,
      // The same bundled runtime the Host runs on: no Node installation is assumed.
      env: desktopNodeEnvironment(this.resources.node, undefined, {
        ...this.environment,
        REDTEAM_UI_TOKEN: token,
        ...(toolsDirectory === undefined ? {} : { REDTEAM_TOOLS_DIR: toolsDirectory }),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    this.stopping = false
    this.diagnostic = ''
    const collect = (chunk: Buffer | string): void => {
      this.diagnostic = (this.diagnostic + chunk.toString()).slice(-MAX_DIAGNOSTIC_CHARS)
    }
    const collectFrom = (stream: NodeJS.ReadableStream | null): void => { stream?.on('data', collect) }
    collectFrom(child.stdout)
    collectFrom(child.stderr)
    // A child is not terminated with its parent: an abrupt exit - app.exit, an unhandled
    // failure, a crash - would otherwise leave the console holding its port. The hook
    // lives only while a child does, so nothing accumulates across restarts.
    this.exitHook = () => { this.killNow() }
    process.once('exit', this.exitHook)
    this.exited = new Promise<void>((resolve) => {
      child.once('exit', (code, signal) => {
        if (!this.stopping && this.active !== undefined) {
          // A console that dies after readiness leaves the engagement tools absent; the
          // exit is reported where the application's own diagnostics are read.
          console.error(`desktop engagement runner: the console stopped after startup (exit ${String(code)}, signal ${String(signal)})`)
        }
        resolve()
      })
    })

    try {
      await this.awaitReady(child, endpoint, token)
    } catch (error) {
      // A half-started console must never outlive the failure it caused.
      await this.stop().catch(() => undefined)
      throw error
    }
    this.active = { endpoint, token }
    this.environment.REDTEAM_MCP_URL = endpoint
    this.environment.REDTEAM_UI_TOKEN = token
    console.info(`desktop engagement runner: the bundled console is listening on ${endpoint}`)
    return this.active
  }

  /**
   * Stop the console and release its port, escalating when it does not exit.
   * @returns Completion of child exit.
   * @throws Error when the child survives SIGKILL, because the port would stay held.
   */
  async stop(): Promise<void> {
    const child = this.child
    const active = this.active
    this.child = undefined
    this.active = undefined
    this.detachExitHook()
    if (active !== undefined) {
      // The endpoint and token described a console that no longer exists; leaving them
      // behind would point a replacement Host at nothing.
      Reflect.deleteProperty(this.environment, 'REDTEAM_MCP_URL')
      Reflect.deleteProperty(this.environment, 'REDTEAM_UI_TOKEN')
    }
    if (child === undefined) return
    this.stopping = true
    const exited = this.exited ?? Promise.resolve()
    const deadline = this.options.timeouts?.exitMs ?? REDTEAM_RUNNER_EXIT_TIMEOUT_MS
    child.kill('SIGTERM')
    if (await settledWithin(exited, deadline)) return
    child.kill('SIGKILL')
    if (!await settledWithin(exited, deadline)) {
      throw new Error('desktop engagement runner: the console did not exit after SIGKILL')
    }
  }

  /** Terminate the console without awaiting, for a process that is exiting without a next turn. */
  killNow(): void {
    this.detachExitHook()
    this.child?.kill('SIGKILL')
    this.child = undefined
    this.active = undefined
  }

  /** Release the process exit hook, so a stopped console leaves no listener behind. */
  private detachExitHook(): void {
    if (this.exitHook === undefined) return
    process.removeListener('exit', this.exitHook)
    this.exitHook = undefined
  }

  /**
   * @returns the tools payload this launch exports to the console, or `undefined` when the
   * operator named their own directory or this installation carries no tools payload.
   */
  private bundledToolsDirectory(): string | undefined {
    const configured = this.environment.REDTEAM_TOOLS_DIR
    if (configured !== undefined && configured !== '') return undefined
    const directory = join(dirname(this.resources.directory), REDTEAM_TOOLS_RESOURCE_DIRECTORY)
    return existsSync(directory) ? directory : undefined
  }

  /** Poll the console's MCP endpoint until it identifies itself, its deadline passes, or it exits. */
  private async awaitReady(child: ChildProcess, endpoint: string, token: string): Promise<void> {
    const probe = this.options.probe ?? probeRedteamConsole
    const ceiling = this.options.timeouts?.readyMs ?? REDTEAM_RUNNER_READY_TIMEOUT_MS
    const deadline = Date.now() + ceiling
    for (;;) {
      if (await probe(endpoint, token)) return
      if (child.exitCode !== null || child.signalCode !== null) {
        throw this.failure(`the console exited with code ${String(child.exitCode)} before answering on ${endpoint}`)
      }
      if (Date.now() >= deadline) {
        throw this.failure(`the console did not answer on ${endpoint} within ${String(ceiling)} ms`)
      }
      await pause(READY_POLL_INTERVAL_MS)
    }
  }

  /** @returns the startup error, quoting the child's own last output because a dialog cannot show a log. */
  private failure(detail: string): DesktopRedteamRunnerStartupError {
    const tail = this.diagnostic.trim().replace(/\s+/gu, ' ').slice(-DIAGNOSTIC_IN_MESSAGE_CHARS)
    return new DesktopRedteamRunnerStartupError(`desktop engagement runner: ${detail}${tail === '' ? '' : `: ${tail}`}`)
  }
}
