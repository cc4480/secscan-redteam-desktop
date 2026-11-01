/**
 * The bundled llama.cpp `llama-server`, as one supervised loopback child of the Desktop
 * process.
 *
 * The local-model feature ships its own inference server: a GGUF this installation
 * downloaded is served by `resources/llama/llama-server.exe` on an ephemeral loopback
 * port, and the Desktop process owns that child for as long as it runs. Readiness is the
 * server's own HTTP surface - `GET /health`, falling back to `GET /v1/models` for a build
 * without the health route - because binding the port says nothing about whether the
 * weights have finished loading: a 27B model is read from disk for tens of seconds.
 *
 * Only one child is ever alive. A start while one runs the same model returns the running
 * state instead of spawning a second, a start while one is still loading joins the
 * in-flight start, and a start for a different model is refused until the caller stops the
 * running one - switching models is an explicit stop followed by a start, never a takeover.
 * A crash leaves the supervisor in `error` with the exit code and the child's last stderr
 * lines, and the next `start()` is the explicit restart. `stop()` is graceful first
 * (`SIGTERM`), forceful after the deadline (`SIGKILL`), and always resolves.
 *
 * The supervisor never touches the model store, the settings or the renderer: it is the
 * lifecycle seam the IPC service composes, and every test drives it through the child,
 * fetch, clock and port seams below instead of starting a real process.
 */

import { spawn, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LlamaServerState } from './llama-api.ts'
import { allocateLoopbackPort } from './redteam-runner.ts'

/** Directory the bundled llama.cpp server occupies beside the bundled runtime. */
export const LLAMA_RESOURCE_DIRECTORY = 'llama'

/** Only address the inference server is ever bound to; it holds no credential but stays local. */
export const LLAMA_SERVER_LOOPBACK = '127.0.0.1'

/**
 * Which bundled binary serves a start, reported in {@link LlamaServerState.binary}.
 * The installation ships the CPU build; a future GPU build would be another label.
 */
export const LLAMA_SERVER_VARIANT = 'cpu'

/** Port the supervisor prefers, which is `0`: the kernel picks an ephemeral loopback port. */
export const LLAMA_PREFERRED_PORT = 0

/** Deadline for `llama-server` to answer its first readiness probe; loading a 27B from disk is slow. */
export const LLAMA_READY_TIMEOUT_MS = 120_000

/** Deadline for the child to exit after each termination signal. */
export const LLAMA_EXIT_TIMEOUT_MS = 5_000

/** Health route that means the model finished loading. */
export const LLAMA_HEALTH_PATH = '/health'

/** OpenAI-compatible route used as the readiness fallback for a build without `/health`. */
export const LLAMA_MODELS_PATH = '/v1/models'

/** Environment name that points an unpackaged launch at another payload directory. */
export const LLAMA_DIRECTORY_ENVIRONMENT_NAME = 'DSH_DESKTOP_LLAMA_DIR'

/** Pause between readiness probes; the port binds quickly but the weights do not load quickly. */
const READY_POLL_INTERVAL_MS = 250

/** Budget for one readiness probe, so a hung server cannot consume the whole deadline. */
const PROBE_TIMEOUT_MS = 2_000

/** Child output retained for a failure message; only the tail is ever quoted. */
const MAX_DIAGNOSTIC_CHARS = 8 * 1024

/** Share of that output quoted in an error message, which a native dialog has to stay readable in. */
const DIAGNOSTIC_IN_MESSAGE_CHARS = 400

/** Windows executable name of the bundled server. */
const WINDOWS_EXECUTABLE = 'llama-server.exe'

/** Executable name on a POSIX host, where the same resolver stays honest even though packaging is win-x64. */
const POSIX_EXECUTABLE = 'llama-server'

/** Message used whenever a stop invalidated an in-flight start. */
const STOPPED_BEFORE_READY = 'desktop llama-server: the local inference server start was stopped before it became ready'

/** How one installation resolves its bundled llama.cpp payload on a launch. */
export interface LlamaServerLocation {
  /** Whether this launch is the packaged application, which fixes where its resources are. */
  readonly packaged: boolean
  /** `process.resourcesPath` of this application. */
  readonly resourcesPath: string
  /** `app.getAppPath()`; an unpackaged launch reaches the payload through this directory. */
  readonly appPath: string
  /** Launch environment, which may point an unpackaged run at another payload directory. */
  readonly environment?: NodeJS.ProcessEnv
}

/** Payload directory and the server executable inside it. */
export interface LlamaServerResources {
  /** Absolute directory holding `llama-server` and its GGML runtime DLLs. */
  readonly directory: string
  /** Absolute path of the bundled server executable. */
  readonly binary: string
}

/** What one start serves and with which limits; the IPC service reads it from the model store and settings. */
export interface LlamaServerStartInput {
  /** Absolute path of the downloaded GGUF file. */
  readonly modelPath: string
  /** Absolute path of the model's vision projector companion, passed as `--mmproj` when present. */
  readonly mmprojPath?: string
  /** Stable model id the server advertises as its alias. */
  readonly modelId: string
  /** Context window passed as `-c`. */
  readonly contextLength: number
  /** Threads passed as `-t` and `-tb`. */
  readonly threads: number
}

/** The child members the supervisor touches; a `ChildProcess` satisfies this shape. */
export interface LlamaChild {
  /** Standard output, retained only for the failure message. */
  readonly stdout: NodeJS.ReadableStream | null
  /** Standard error, retained only for the failure message. */
  readonly stderr: NodeJS.ReadableStream | null
  /** Exit code once the child has exited, otherwise `null`. */
  readonly exitCode: number | null
  /** Terminating signal once the child has exited, otherwise `null`. */
  readonly signalCode: NodeJS.Signals | null
  /** Terminates the child, or refuses when it is already gone. */
  kill(signal?: NodeJS.Signals | number): boolean
  /** Registers the one exit notification the supervisor reads. */
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  /** Registers the spawn-failure notification Node raises instead of an exit. */
  on(event: 'error', listener: (error: Error) => void): void
}

/** The head of a readiness response; a fake stands in for `Response` in the tests. */
export interface LlamaFetchResponse {
  /** Whether the request succeeded, which is what readiness means. */
  readonly ok: boolean
  /** HTTP status, kept for diagnostics and assertions. */
  readonly status: number
}

/** Fetches one loopback URL for readiness; injectable so no test opens a socket. */
export type LlamaFetch = (url: string) => Promise<LlamaFetchResponse>

/** Time source and pause used by the readiness loop; injectable so a timeout test costs no wall time. */
export interface LlamaServerClock {
  /** Current epoch milliseconds. */
  now(): number
  /** Resolves after the pause. */
  sleep(milliseconds: number): Promise<void>
}

/** Lifecycle inputs of one {@link LlamaServer}. */
export interface LlamaServerOptions {
  /** Overrides the child factory; a test supplies an in-memory child instead of a process. */
  readonly spawn?: (command: string, args: readonly string[], options: SpawnOptions) => LlamaChild
  /** Overrides the readiness fetch; a test answers without a socket. */
  readonly fetch?: LlamaFetch
  /** Overrides the loopback port probe; a test supplies a fixed port instead of binding one. */
  readonly allocatePort?: (preferred: number) => Promise<number>
  /** Overrides the readiness clock; a test advances time without sleeping. */
  readonly clock?: LlamaServerClock
  /** Overrides the payload directory, which is the seam a test points at a temp directory. */
  readonly directory?: string
  /** Shortened deadlines, so a test exercises a failure path without waiting out the production budget. */
  readonly timeouts?: {
    /** Readiness deadline; defaults to {@link LLAMA_READY_TIMEOUT_MS}. */
    readonly readyMs?: number
    /** Exit deadline per termination signal; defaults to {@link LLAMA_EXIT_TIMEOUT_MS}. */
    readonly exitMs?: number
  }
}

/** The bundled server could not be started; the local model would otherwise be silently absent. */
export class LlamaServerStartupError extends Error {}

/**
 * Resolve the executable name the bundled payload carries on a platform.
 * @param platform - Platform whose name applies; a test pins one path explicitly.
 * @returns `llama-server.exe` on Windows, `llama-server` elsewhere.
 */
export function llamaServerExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? WINDOWS_EXECUTABLE : POSIX_EXECUTABLE
}

/**
 * Resolve the payload directory a launch reads.
 * A directory the launch environment names wins; otherwise a packaged install carries the
 * payload beside the runtime and an unpackaged launch reads the checked-in one.
 * @param location - Where this application's resources are and how it was launched.
 * @returns Absolute directory holding the server executable.
 */
function llamaPayloadDirectory(location: LlamaServerLocation): string {
  const configured = (location.environment?.[LLAMA_DIRECTORY_ENVIRONMENT_NAME] ?? '').trim()
  if (configured !== '') return configured
  if (location.packaged) return join(location.resourcesPath, LLAMA_RESOURCE_DIRECTORY)
  return join(location.appPath, 'resources', LLAMA_RESOURCE_DIRECTORY)
}

/**
 * Resolve the directory a launch executes the server from.
 * @param location - Where this application's resources are and how it was launched.
 * @param platform - Platform whose executable name applies; a test pins one path explicitly.
 * @returns Payload directory and the server executable inside it.
 */
export function llamaServerResources(
  location: LlamaServerLocation,
  platform: NodeJS.Platform = process.platform,
): LlamaServerResources {
  const directory = llamaPayloadDirectory(location)
  return { directory, binary: join(directory, llamaServerExecutableName(platform)) }
}

/**
 * Build the exact argv one start spawns with.
 *
 * The flags are pinned rather than tuned at the call site: `-c` is the operator's context
 * window, `-t`/`-tb` share one thread count, and `-b 2048`/`-ub 512` are the batch sizes
 * the CPU build is qualified with. `--alias` publishes the model id the runner's
 * OpenAI-compatible rows address, `--jinja` enables the chat template the GGUF carries,
 * and `-ngl 0` keeps every layer on the CPU because the bundled build has no GPU backend.
 * A model with a vision projector companion adds `--mmproj` right after `-m`; without
 * one the argv is exactly the long-standing list.
 * @param input - Model, limits and the loopback port the server was allocated.
 * @returns The argv, in the fixed order the supervisor asserts.
 */
export function llamaServerArgs(
  input: LlamaServerStartInput & { readonly port: number },
): readonly string[] {
  return [
    '-m', input.modelPath,
    ...input.mmprojPath === undefined ? [] : ['--mmproj', input.mmprojPath],
    '--alias', input.modelId,
    '-c', String(input.contextLength),
    '-t', String(input.threads),
    '-tb', String(input.threads),
    '-b', '2048',
    '-ub', '512',
    '--host', LLAMA_SERVER_LOOPBACK,
    '--port', String(input.port),
    '--jinja',
    '-ngl', '0',
  ]
}

/** @returns the default fetcher: one bounded GET against a loopback readiness route. */
async function fetchLlamaProbe(url: string): Promise<LlamaFetchResponse> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  return { ok: response.ok, status: response.status }
}

/**
 * Ask the server whether it finished loading its model.
 * `/health` answers 503 while the weights load, so a non-OK health response falls through
 * to `/v1/models`; either route answering 200 means the server is serving.
 * @param port - Loopback port the child was started with.
 * @param fetcher - Readiness fetch, real by default and injected by a test.
 * @returns whether a readiness route answered successfully.
 */
async function probeLlamaServer(port: number, fetcher: LlamaFetch): Promise<boolean> {
  for (const path of [LLAMA_HEALTH_PATH, LLAMA_MODELS_PATH]) {
    try {
      const response = await fetcher(`http://${LLAMA_SERVER_LOOPBACK}:${String(port)}${path}`)
      if (response.ok) return true
    } catch {
      // The server has not bound its port yet; the readiness deadline decides when to give up.
    }
  }
  return false
}

/** @returns the default child factory: a real detached-stdio child process. */
function defaultSpawn(command: string, args: readonly string[], options: SpawnOptions): LlamaChild {
  return spawn(command, args, options)
}

/** @returns a human-readable reason the child stopped, which a failure message quotes. */
function exitDescription(code: number | null, signal: NodeJS.Signals | null): string {
  return signal !== null ? `signal ${signal}` : `code ${String(code)}`
}

/** @returns the message of an unknown failure, for a log line that cannot assume an Error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** @returns why the start request cannot be served, or `undefined` when it can. */
function invalidStartReason(input: LlamaServerStartInput): string | undefined {
  if (input.modelPath.trim() === '') return 'the model path is empty'
  if (input.mmprojPath !== undefined && input.mmprojPath.trim() === '') {
    return 'the vision projector path is empty'
  }
  if (input.modelId.trim() === '') return 'the model id is empty'
  if (!Number.isSafeInteger(input.contextLength) || input.contextLength < 1) {
    return `context length ${String(input.contextLength)} is not a positive integer`
  }
  if (!Number.isSafeInteger(input.threads) || input.threads < 1) {
    return `thread count ${String(input.threads)} is not a positive integer`
  }
  return undefined
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

/** The clock a production run uses: wall time and a real pause. */
const systemClock: LlamaServerClock = {
  now: () => Date.now(),
  sleep: async (milliseconds: number): Promise<void> => {
    await new Promise<void>((resolve) => { setTimeout(resolve, milliseconds) })
  },
}

/**
 * One inference server child: the bundled `llama-server` for the model the operator chose,
 * started on an ephemeral loopback port, observed until it serves, and stopped with the
 * application.
 *
 * State is pushed through {@link LlamaServer.onState} rather than polled by the UI: a
 * transition to `starting` happens before the spawn, `running` only once a readiness
 * route answered, and `error` whenever the child exits after startup or a start fails.
 * The last transition is always readable through {@link LlamaServer.state}.
 */
export class LlamaServer {
  private currentState: LlamaServerState = { status: 'stopped' }
  private readonly listeners = new Set<(state: LlamaServerState) => void>()
  private child: LlamaChild | undefined
  private exited: Promise<void> | undefined
  private spawnError: Error | undefined
  private stdoutOutput = ''
  private stderrOutput = ''
  private stopping = false
  private exitHook: (() => void) | undefined
  private generation = 0
  private startTask: Promise<LlamaServerState> | undefined

  /**
   * @param location - Where this launch's resources are and how it was launched.
   * @param options - Test seams for the child factory, readiness fetch, port allocator,
   * clock and payload directory, plus shortened deadlines.
   */
  constructor(
    private readonly location: LlamaServerLocation,
    private readonly options: LlamaServerOptions = {},
  ) {}

  /** @returns the observable state right now, which the IPC service and the UI read. */
  get state(): LlamaServerState {
    return this.currentState
  }

  /**
   * Observe every state transition.
   * @param listener - Called with the new state on each transition; a throwing listener is
   * logged and does not disturb the supervisor.
   * @returns A disposer that removes the listener.
   */
  onState(listener: (state: LlamaServerState) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Start the server for one model, or join the child that already exists.
   * @param input - Model path and id plus the context length and thread count to serve it with.
   * @returns The state the start settled on: `running` on success, and the state at the
   * time of a concurrent call when one was already in flight.
   * @throws LlamaServerStartupError when the payload is absent, no port is free, the child
   * exits before answering, the readiness deadline passes, or another model is already
   * served. Switching models is an explicit `stop()` followed by a `start()`: the running
   * server is never replaced behind the operator's back, and its state stays `running`.
   */
  async start(input: LlamaServerStartInput): Promise<LlamaServerState> {
    const pending = this.startTask
    if (pending !== undefined) return pending
    if (this.child !== undefined) {
      const serving = this.currentState.modelId
      if (serving === input.modelId) return this.currentState
      throw new LlamaServerStartupError(
        `desktop llama-server: the local inference server is already serving ${serving ?? 'another model'}; `
        + `stop it before starting ${input.modelId}`,
      )
    }
    const generation = ++this.generation
    this.stopping = false
    const task = this.launch(input, generation)
    this.startTask = task
    try {
      return await task
    } finally {
      if (this.startTask === task) this.startTask = undefined
    }
  }

  /**
   * Stop the server and release its port, escalating to SIGKILL when it does not exit.
   * Always resolves: a stop that the operating system cannot complete is reported in the
   * log, and the supervisor still reports `stopped` so the operator is not trapped.
   * @returns The state after the stop, which is `stopped`.
   */
  async stop(): Promise<LlamaServerState> {
    const child = this.child
    // Invalidate any in-flight start first: its readiness loop must not publish `error`
    // over the `stopped` this stop settles on.
    this.generation += 1
    this.stopping = true
    this.child = undefined
    this.detachExitHook()
    if (child === undefined) {
      this.settleStopped()
      return this.currentState
    }
    try {
      const exited = this.exited ?? Promise.resolve()
      const deadline = this.options.timeouts?.exitMs ?? LLAMA_EXIT_TIMEOUT_MS
      child.kill('SIGTERM')
      if (!await settledWithin(exited, deadline)) {
        child.kill('SIGKILL')
        if (!await settledWithin(exited, deadline)) {
          console.error('desktop llama-server: the local inference server did not exit after SIGKILL')
        }
      }
    } catch (error) {
      console.error(`desktop llama-server: stopping the local inference server failed: ${messageOf(error)}`)
    } finally {
      this.settleStopped()
    }
    return this.currentState
  }

  /** Terminate the server without awaiting, for a process that is exiting without a next turn. */
  killNow(): void {
    this.detachExitHook()
    const child = this.child
    this.child = undefined
    this.generation += 1
    this.stopping = true
    // A process that is exiting has no listener left to care; skip the notification.
    this.currentState = { status: 'stopped' }
    child?.kill('SIGKILL')
  }

  /** @returns the payload this launch executes, honoring the directory test seam. */
  private resources(): LlamaServerResources {
    const directory = this.options.directory
    if (directory !== undefined) {
      return { directory, binary: join(directory, llamaServerExecutableName()) }
    }
    return llamaServerResources(this.location)
  }

  /** Run one start from binary resolution through readiness, ending in `running` or an error. */
  private async launch(input: LlamaServerStartInput, generation: number): Promise<LlamaServerState> {
    const invalid = invalidStartReason(input)
    if (invalid !== undefined) {
      throw this.failFor(generation, input.modelId, `desktop llama-server: the start request is invalid: ${invalid}`)
    }
    const resources = this.resources()
    if (!existsSync(resources.binary)) {
      const remedy = this.location.packaged
        ? 'Reinstall the application.'
        : 'Run `node apps/desktop/scripts/vendor-llama.mjs` from the repository root to materialize the pinned runtime.'
      throw this.failFor(
        generation,
        input.modelId,
        `desktop llama-server: ${resources.binary} is missing, so this installation does not carry the local `
        + `inference server. ${remedy}`,
      )
    }
    let port: number
    try {
      port = await (this.options.allocatePort ?? allocateLoopbackPort)(LLAMA_PREFERRED_PORT)
    } catch {
      throw this.failFor(
        generation,
        input.modelId,
        'desktop llama-server: no free loopback port is available for the local inference server',
      )
    }
    this.assertCurrent(generation)
    this.publish({ status: 'starting', modelId: input.modelId, binary: LLAMA_SERVER_VARIANT })
    const spawnChild = this.options.spawn ?? defaultSpawn
    let child: LlamaChild
    try {
      child = spawnChild(resources.binary, llamaServerArgs({ ...input, port }), {
        cwd: resources.directory,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      throw this.failFor(
        generation,
        input.modelId,
        `desktop llama-server: ${resources.binary} could not be spawned: ${messageOf(error)}`,
      )
    }
    this.attach(child, input.modelId)
    try {
      await this.awaitReady(child, port, input.modelId, resources.binary, generation)
    } catch (error) {
      // A half-started server must never outlive the failure it caused.
      await this.terminate()
      throw error
    }
    if (this.generation !== generation || this.stopping) {
      await this.terminate()
      throw new LlamaServerStartupError(STOPPED_BEFORE_READY)
    }
    const running: LlamaServerState = {
      status: 'running',
      baseUrl: `http://${LLAMA_SERVER_LOOPBACK}:${String(port)}/v1`,
      port,
      modelId: input.modelId,
      binary: LLAMA_SERVER_VARIANT,
    }
    this.publish(running)
    return running
  }

  /**
   * Wire the child's streams, spawn failure, exit notification and the process exit hook.
   * The hook lives only while a child does, so an application exit - or a crash - never
   * leaves an orphan holding the loopback port and no listener accumulation across restarts.
   */
  private attach(child: LlamaChild, modelId: string): void {
    this.child = child
    this.stopping = false
    this.spawnError = undefined
    this.stdoutOutput = ''
    this.stderrOutput = ''
    const keep = (stream: NodeJS.ReadableStream | null, append: (text: string) => void): void => {
      stream?.on('data', (chunk: Buffer | string) => { append(chunk.toString()) })
    }
    keep(child.stdout, (text) => { this.stdoutOutput = (this.stdoutOutput + text).slice(-MAX_DIAGNOSTIC_CHARS) })
    keep(child.stderr, (text) => { this.stderrOutput = (this.stderrOutput + text).slice(-MAX_DIAGNOSTIC_CHARS) })
    // Node reports a spawn failure - a missing DLL, an unreadable executable - as an error
    // event instead of an exit; without a listener that event would be thrown from the
    // event loop and take the application down.
    child.on('error', (error) => { this.spawnError = error })
    this.exitHook = () => { this.killNow() }
    process.once('exit', this.exitHook)
    this.exited = new Promise<void>((resolve) => {
      child.once('exit', (code, signal) => {
        const wasRunning = this.currentState.status === 'running'
        resolve()
        if (this.stopping || !wasRunning) return
        // The server died after readiness, so nothing is serving: there is no automatic
        // restart - the next start() is the explicit one - and the status says why.
        this.child = undefined
        this.detachExitHook()
        this.publish({
          status: 'error',
          modelId,
          binary: LLAMA_SERVER_VARIANT,
          error: `desktop llama-server: the local inference server exited with ${exitDescription(code, signal)} `
            + `after startup${this.diagnosticSuffix()}`,
        })
      })
    })
  }

  /**
   * Poll the readiness routes until one answers, the child exits, or the deadline passes.
   * @throws LlamaServerStartupError carrying the child's last output, because an operator
   * faces a dialog rather than a log.
   */
  private async awaitReady(
    child: LlamaChild,
    port: number,
    modelId: string,
    binary: string,
    generation: number,
  ): Promise<void> {
    const fetcher = this.options.fetch ?? fetchLlamaProbe
    const clock = this.options.clock ?? systemClock
    const ceiling = this.options.timeouts?.readyMs ?? LLAMA_READY_TIMEOUT_MS
    const deadline = clock.now() + ceiling
    const endpoint = `http://${LLAMA_SERVER_LOOPBACK}:${String(port)}`
    for (;;) {
      this.assertCurrent(generation)
      if (await probeLlamaServer(port, fetcher)) return
      this.assertCurrent(generation)
      const spawnError = this.spawnError
      if (spawnError !== undefined) {
        throw this.failFor(
          generation,
          modelId,
          `desktop llama-server: ${binary} could not be started: ${spawnError.message}${this.diagnosticSuffix()}`,
        )
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw this.failFor(
          generation,
          modelId,
          'desktop llama-server: the local inference server exited with '
          + `${exitDescription(child.exitCode, child.signalCode)} before it answered on ${endpoint}`
          + this.diagnosticSuffix(),
        )
      }
      if (clock.now() >= deadline) {
        throw this.failFor(
          generation,
          modelId,
          `desktop llama-server: the local inference server did not become ready on ${endpoint} `
          + `within ${String(ceiling)} ms${this.diagnosticSuffix()}`,
        )
      }
      await clock.sleep(READY_POLL_INTERVAL_MS)
    }
  }

  /** @throws LlamaServerStartupError when a stop invalidated the start this call belongs to. */
  private assertCurrent(generation: number): void {
    if (this.generation !== generation) throw new LlamaServerStartupError(STOPPED_BEFORE_READY)
  }

  /** Stop the child a failed start owns, without escalating to a second error state. */
  private async terminate(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.child = undefined
    this.detachExitHook()
    const exited = this.exited ?? Promise.resolve()
    const deadline = this.options.timeouts?.exitMs ?? LLAMA_EXIT_TIMEOUT_MS
    child.kill('SIGTERM')
    if (await settledWithin(exited, deadline)) return
    child.kill('SIGKILL')
    await settledWithin(exited, deadline)
  }

  /** Publish the error state and return the error to throw, unless a stop won the race. */
  private failFor(generation: number, modelId: string, message: string): LlamaServerStartupError {
    if (this.generation === generation) {
      this.publish({ status: 'error', modelId, binary: LLAMA_SERVER_VARIANT, error: message })
    }
    return new LlamaServerStartupError(message)
  }

  /** Publish `stopped` once, so an idempotent stop does not repeat a transition. */
  private settleStopped(): void {
    if (this.currentState.status === 'stopped') return
    this.publish({ status: 'stopped' })
  }

  /** Set the state and notify every observer. */
  private publish(next: LlamaServerState): void {
    this.currentState = next
    for (const listener of [...this.listeners]) {
      try {
        listener(next)
      } catch (error) {
        console.error(`desktop llama-server: a state listener failed: ${messageOf(error)}`)
      }
    }
  }

  /** @returns the child's last output as one readable clause, stderr first. */
  private diagnosticSuffix(): string {
    const source = this.stderrOutput.trim() === '' ? this.stdoutOutput : this.stderrOutput
    const tail = source.trim().replace(/\s+/gu, ' ').slice(-DIAGNOSTIC_IN_MESSAGE_CHARS)
    return tail === '' ? '' : `: ${tail}`
  }

  /** Release the process exit hook, so a stopped child leaves no listener behind. */
  private detachExitHook(): void {
    if (this.exitHook === undefined) return
    process.removeListener('exit', this.exitHook)
    this.exitHook = undefined
  }
}
