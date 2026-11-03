/**
 * The bundled llama-server supervisor: how the payload is resolved, the exact argv one
 * start spawns, what readiness accepts, how a crash and a timeout are reported, and that
 * a stop never leaves a child behind. No real process and no socket: the child, the
 * readiness fetch, the clock and the port allocator are injected, and every temporary
 * payload is a file this file writes into a temp directory.
 */

import type { SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlamaServerState } from '../src/llama-api.ts'
import {
  LLAMA_DIRECTORY_ENVIRONMENT_NAME,
  LLAMA_PREFERRED_PORT,
  LlamaServer,
  LlamaServerStartupError,
  llamaServerArgs,
  llamaServerExecutableName,
  llamaServerResources,
  type LlamaChild,
  type LlamaFetch,
  type LlamaServerClock,
  type LlamaServerLocation,
  type LlamaServerOptions,
  type LlamaServerStartInput,
} from '../src/llama-server.ts'

/** One captured spawn: the child the supervisor asked the machine for. */
interface SpawnedChild {
  readonly command: string
  readonly args: readonly string[]
  readonly options: SpawnOptions
  readonly child: FakeChildProcess
}

/** Captured spawns, filled by the injected child factory. */
const harness: { spawns: SpawnedChild[] } = { spawns: [] }

/** The subset of `ChildProcess` the supervisor touches, plus what the assertions read. */
class FakeChildProcess extends EventEmitter implements LlamaChild {
  /** Signals delivered to this child, in delivery order. */
  readonly signals: string[] = []
  /** Standard output stream the supervisor listens on. */
  readonly stdout = new PassThrough()
  /** Standard error stream the supervisor listens on. */
  readonly stderr = new PassThrough()
  /** Whether SIGTERM makes this child exit, as a healthy server does. */
  exitOnSignal = true
  /** Whether SIGKILL makes this child exit, as an operative system does unless the child is wedged. */
  exitOnForce = true
  /** Exit code reported once the child has exited. */
  exitCode: number | null = null
  /** Signal reported once the child has exited. */
  signalCode: NodeJS.Signals | null = null

  /** Records the signal, then exits unless the child is configured to ignore it. */
  kill(signal?: NodeJS.Signals | number): boolean {
    const name: NodeJS.Signals = typeof signal === 'string' ? signal : 'SIGKILL'
    this.signals.push(name)
    const exits = name === 'SIGKILL' ? this.exitOnForce : this.exitOnSignal
    if (exits) queueMicrotask(() => { this.exit(null, name) })
    return true
  }

  /** Exit notification, shaped the way a real child reports it. */
  exit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.signalCode !== null) return
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

/** The injected child factory: no process is ever created by these tests. */
function spawnIntoHarness(command: string, args: readonly string[], options: SpawnOptions): LlamaChild {
  const child = new FakeChildProcess()
  harness.spawns.push({ command, args, options, child })
  return child
}

/** Port every defaulted supervisor allocates; a fixed value keeps the assertions readable. */
const FIXED_PORT = 19_001

/** Model path a start is asked to serve; the file never has to exist for a fake child. */
const MODEL_PATH = join('C:', 'models', 'Huihui-Qwen3.8-27B-abliterated.Q4_K_M.gguf')

/** Stable model id the model store derives for that file. */
const MODEL_ID = 'mradermacher--huihui-qwen3.8-27b-abliterated-gguf--huihui-qwen3.8-27b-abliterated.q4_k_m'

/** The start request every lifecycle test uses. */
const START_INPUT = { modelPath: MODEL_PATH, modelId: MODEL_ID, contextLength: 32_768, threads: 8 }

/** A launch location the directory seam makes irrelevant unless a test exercises resolution. */
const LOCATION: LlamaServerLocation = { packaged: false, resourcesPath: join('C:', 'unused'), appPath: join('C:', 'app') }

/** Temp directories owned by this file, removed after each test. */
const roots: string[] = []

/** Supervisors created by a test, stopped after it so no exit hook outlives the test. */
const servers: LlamaServer[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.killNow()
  harness.spawns.length = 0
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** @returns a fresh temp directory owned by this test file. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llama-server-'))
  roots.push(root)
  return root
}

/** @returns a temp directory shaped like the vendored payload, carrying both platform names. */
function payloadDirectory(): string {
  const directory = tempRoot()
  writeFileSync(join(directory, 'llama-server.exe'), '')
  writeFileSync(join(directory, 'llama-server'), '')
  return directory
}

/** @returns a fetcher that reports every readiness route as ready, and the URLs it saw. */
function readyFetch(): { fetcher: LlamaFetch; calls: string[] } {
  const calls: string[] = []
  const fetcher: LlamaFetch = async (url) => {
    calls.push(url)
    return { ok: true, status: 200 }
  }
  return { fetcher, calls }
}

/** @returns a supervisor wired to the fakes, with a fixed port and an immediately ready fetch. */
function supervisor(directory: string, options: LlamaServerOptions = {}): LlamaServer {
  const { fetcher } = readyFetch()
  const created = new LlamaServer(LOCATION, {
    directory,
    spawn: spawnIntoHarness,
    allocatePort: async () => FIXED_PORT,
    fetch: fetcher,
    ...options,
  })
  servers.push(created)
  return created
}

/** @returns the states a supervisor publishes from now on. */
function recordStates(target: LlamaServer): LlamaServerState[] {
  const states: LlamaServerState[] = []
  target.onState((state) => { states.push(state) })
  return states
}

/** @returns the newest captured spawn. */
function lastSpawn(): SpawnedChild {
  const spawn = harness.spawns.at(-1)
  if (spawn === undefined) throw new Error('llama-server was not spawned')
  return spawn
}

/** @returns completion after the event loop has delivered the pending stream data. */
function tick(): Promise<void> {
  return new Promise<void>((resolve) => { setImmediate(resolve) })
}

/** @returns the failure a start reported, so one assertion can read both its type and its message. */
async function startFailure(
  target: LlamaServer,
  input: LlamaServerStartInput = START_INPUT,
): Promise<LlamaServerStartupError> {
  const failure = await target.start(input).then(() => undefined, (error: unknown) => error)
  if (!(failure instanceof LlamaServerStartupError)) throw new Error('the server started instead of failing')
  return failure
}

describe('llama-server payload resolution', () => {
  it('resolves the executable beside the packaged resources', () => {
    const resourcesPath = join('C:', 'Program Files', 'SecScan RedTeam', 'resources')
    const resolved = llamaServerResources(
      { packaged: true, resourcesPath, appPath: join('C:', 'unused') },
      'win32',
    )

    expect(resolved).toEqual({
      directory: join(resourcesPath, 'llama'),
      binary: join(resourcesPath, 'llama', 'llama-server.exe'),
    })
    expect(llamaServerExecutableName('win32')).toBe('llama-server.exe')
    expect(llamaServerExecutableName('linux')).toBe('llama-server')
  })

  it('resolves the checked-in payload for an unpackaged launch', () => {
    const appPath = join('C:', 'dsh-src', 'apps', 'desktop')
    const resolved = llamaServerResources(
      { packaged: false, resourcesPath: join('C:', 'unused'), appPath },
      'linux',
    )

    expect(resolved).toEqual({
      directory: join(appPath, 'resources', 'llama'),
      binary: join(appPath, 'resources', 'llama', 'llama-server'),
    })
  })

  it('lets DSH_DESKTOP_LLAMA_DIR override both layouts', () => {
    const configured = join('C:', 'operator', 'llama')
    const resolved = llamaServerResources({
      packaged: true,
      resourcesPath: join('C:', 'unused'),
      appPath: join('C:', 'unused'),
      environment: { [LLAMA_DIRECTORY_ENVIRONMENT_NAME]: configured },
    }, 'win32')

    expect(resolved).toEqual({ directory: configured, binary: join(configured, 'llama-server.exe') })
  })
})

describe('llama-server lifecycle', () => {
  it('spawns the pinned argv once and reaches running with a loopback baseUrl', async () => {
    const directory = payloadDirectory()
    const allocatePort = vi.fn(async () => FIXED_PORT)
    const { fetcher, calls } = readyFetch()
    const target = new LlamaServer(LOCATION, { directory, spawn: spawnIntoHarness, allocatePort, fetch: fetcher })
    servers.push(target)
    const states = recordStates(target)

    const started = await target.start(START_INPUT)

    expect(started).toEqual({
      status: 'running',
      baseUrl: `http://127.0.0.1:${FIXED_PORT}/v1`,
      port: FIXED_PORT,
      modelId: MODEL_ID,
      binary: 'cpu',
    })
    expect(target.state).toEqual(started)
    expect(states.map(state => state.status)).toEqual(['starting', 'running'])
    expect(allocatePort).toHaveBeenCalledWith(LLAMA_PREFERRED_PORT)
    // A 200 from /health is readiness on its own: the /v1/models fallback is not asked.
    expect(calls).toEqual([`http://127.0.0.1:${FIXED_PORT}/health`])

    const spawn = lastSpawn()
    expect(spawn.command).toBe(join(directory, llamaServerExecutableName()))
    expect(spawn.args).toEqual([
      '-m', MODEL_PATH,
      '--alias', MODEL_ID,
      '-c', '32768',
      '-t', '8',
      '-tb', '8',
      '-b', '2048',
      '-ub', '512',
      '--host', '127.0.0.1',
      '--port', String(FIXED_PORT),
      '--jinja',
      '-ngl', '0',
    ])
    expect(spawn.args).toEqual(llamaServerArgs({ ...START_INPUT, port: FIXED_PORT }))
    expect(spawn.options.cwd).toBe(directory)
    expect(spawn.options.windowsHide).toBe(true)
    expect(spawn.options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
  })

  it('passes the vision projector companion as --mmproj right after the model', async () => {
    const mmprojPath = join('C:', 'models', 'mmproj-Huihui-Qwen3.8-27B-abliterated-f16.gguf')
    const withCompanion = { ...START_INPUT, mmprojPath }
    expect(llamaServerArgs({ ...withCompanion, port: FIXED_PORT })).toEqual([
      '-m', MODEL_PATH,
      '--mmproj', mmprojPath,
      '--alias', MODEL_ID,
      '-c', '32768',
      '-t', '8',
      '-tb', '8',
      '-b', '2048',
      '-ub', '512',
      '--host', '127.0.0.1',
      '--port', String(FIXED_PORT),
      '--jinja',
      '-ngl', '0',
    ])
    // Without a companion the argv is exactly the long-standing one.
    expect(llamaServerArgs({ ...START_INPUT, port: FIXED_PORT })).toEqual([
      '-m', MODEL_PATH,
      '--alias', MODEL_ID,
      '-c', '32768',
      '-t', '8',
      '-tb', '8',
      '-b', '2048',
      '-ub', '512',
      '--host', '127.0.0.1',
      '--port', String(FIXED_PORT),
      '--jinja',
      '-ngl', '0',
    ])

    const directory = payloadDirectory()
    const target = supervisor(directory)
    const started = await target.start(withCompanion)
    expect(started.status).toBe('running')
    expect(lastSpawn().args).toEqual(llamaServerArgs({ ...withCompanion, port: FIXED_PORT }))
  })

  it('refuses a start whose vision projector path is blank', async () => {
    const directory = payloadDirectory()
    const target = supervisor(directory)
    const failure = await startFailure(target, { ...START_INPUT, mmprojPath: '  ' })
    expect(failure.message).toContain('the vision projector path is empty')
    expect(harness.spawns).toHaveLength(0)
  })

  it('falls back to /v1/models while /health reports the model still loading', async () => {
    const directory = payloadDirectory()
    const calls: string[] = []
    const fetcher: LlamaFetch = async (url) => {
      calls.push(url)
      return url.endsWith('/health') ? { ok: false, status: 503 } : { ok: true, status: 200 }
    }
    const target = new LlamaServer(LOCATION, {
      directory,
      spawn: spawnIntoHarness,
      allocatePort: async () => FIXED_PORT,
      fetch: fetcher,
    })
    servers.push(target)

    const started = await target.start(START_INPUT)

    expect(started.status).toBe('running')
    expect(calls).toEqual([
      `http://127.0.0.1:${FIXED_PORT}/health`,
      `http://127.0.0.1:${FIXED_PORT}/v1/models`,
    ])
  })

  it('fails with a typed error, publishes error and kills the child when a silent child stalls', async () => {
    const directory = payloadDirectory()
    let now = 0
    const clock: LlamaServerClock = {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds },
    }
    const fetcher: LlamaFetch = async () => ({ ok: false, status: 503 })
    const target = new LlamaServer(LOCATION, {
      directory,
      spawn: spawnIntoHarness,
      allocatePort: async () => FIXED_PORT,
      fetch: fetcher,
      clock,
      timeouts: { readyMs: 1_000, stallMs: 1_000, exitMs: 20 },
    })
    servers.push(target)
    const states = recordStates(target)

    const failure = await startFailure(target)

    // A live but silent child fails by the stall path, not the old generic ceiling wording.
    expect(failure.message).toMatch(/load stalled on http:\/\/127\.0\.0\.1:19001/u)
    expect(failure.message).toMatch(/no new output for 1000 ms/u)
    expect(failure.message).not.toMatch(/did not become ready .* within \d+ ms/u)
    expect(target.state.status).toBe('error')
    expect(target.state.error).toBe(failure.message)
    expect(states.map(state => state.status)).toEqual(['starting', 'error'])
    // The injected clock proves the loop honoured the stall bound without sleeping.
    expect(now).toBeGreaterThanOrEqual(1_000)
    expect(now).toBeLessThan(2_000)
    expect(lastSpawn().child.signals).toEqual(['SIGTERM'])
  })

  it('keeps waiting past the readiness ceiling while load output keeps advancing, then succeeds', async () => {
    const directory = payloadDirectory()
    let now = 0
    let steps = 0
    const clock: LlamaServerClock = {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; await tick() },
    }
    const fetcher: LlamaFetch = async () => {
      steps += 1
      lastSpawn().child.stderr.write(`llama_model_loader: loading tensor ${String(steps)}\n`)
      return now >= 2_600 ? { ok: true, status: 200 } : { ok: false, status: 503 }
    }
    const target = supervisor(directory, {
      fetch: fetcher,
      clock,
      timeouts: { readyMs: 1_000, stallMs: 1_000, exitMs: 20 },
    })
    const states = recordStates(target)

    const started = await target.start(START_INPUT)

    // Readiness arrived at 2600 ms, well past the 1000 ms ceiling: progress kept the wait alive.
    expect(started.status).toBe('running')
    expect(now).toBeGreaterThanOrEqual(2_600)
    expect(states.map(state => state.status)).toEqual(['starting', 'running'])
    expect(lastSpawn().child.signals).toEqual([])
  })

  it('fails with the stall message and the diagnostic tail when output stops advancing', async () => {
    const directory = payloadDirectory()
    let now = 0
    const clock: LlamaServerClock = {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; await tick() },
    }
    const fetcher: LlamaFetch = async () => ({ ok: false, status: 503 })
    const target = supervisor(directory, {
      spawn: (command, args, options) => {
        const child = spawnIntoHarness(command, args, options)
        lastSpawn().child.stderr.write('llama_model_loader: loading model tensors\n')
        return child
      },
      fetch: fetcher,
      clock,
      timeouts: { readyMs: 1_000, stallMs: 1_000, exitMs: 20 },
    })
    const states = recordStates(target)

    const failure = await startFailure(target)

    expect(failure.message).toMatch(/load stalled/u)
    expect(failure.message).toMatch(/no new output for 1000 ms/u)
    expect(failure.message).toMatch(/\d+ ms elapsed/u)
    // The retained stderr tail rides the stall message, as it does the other failure paths.
    expect(failure.message).toContain('loading model tensors')
    expect(failure.message).not.toMatch(/did not become ready .* within \d+ ms/u)
    expect(target.state.status).toBe('error')
    expect(states.map(state => state.status)).toEqual(['starting', 'error'])
    expect(now).toBeGreaterThanOrEqual(1_000)
    expect(now).toBeLessThan(2_000)
    expect(lastSpawn().child.signals).toEqual(['SIGTERM'])
  })

  it('reports a child that exits before readiness with its exit code, not a stall', async () => {
    const directory = payloadDirectory()
    const fetcher: LlamaFetch = async () => {
      lastSpawn().child.exit(2, null)
      return { ok: false, status: 503 }
    }
    const target = supervisor(directory, {
      fetch: fetcher,
      timeouts: { readyMs: 1_000, stallMs: 1_000, exitMs: 20 },
    })

    const failure = await startFailure(target)

    expect(failure.message).toMatch(/exited with code 2 before it answered on http:\/\/127\.0\.0\.1:19001/u)
    expect(failure.message).not.toMatch(/stalled/u)
    expect(target.state.status).toBe('error')
    expect(target.state.error).toBe(failure.message)
  })

  it('reports a crash after startup with the exit code and the last stderr lines', async () => {
    const target = supervisor(payloadDirectory())
    const states = recordStates(target)
    await target.start(START_INPUT)
    const child = lastSpawn().child

    child.stderr.write('llama-server: failed to load model\n')
    await tick()
    child.exit(1, null)

    expect(target.state.status).toBe('error')
    expect(target.state.error).toMatch(/exited with code 1 after startup/u)
    expect(target.state.error).toMatch(/failed to load model/u)
    expect(target.state.baseUrl).toBeUndefined()
    expect(target.state.port).toBeUndefined()
    expect(states.map(state => state.status)).toEqual(['starting', 'running', 'error'])

    // A crash is not restarted behind the operator's back; an explicit start is.
    expect((await target.start(START_INPUT)).status).toBe('running')
    expect(harness.spawns).toHaveLength(2)
  })

  it('never spawns a second child: concurrent and repeated starts join the first', async () => {
    const target = supervisor(payloadDirectory())

    const [first, second] = await Promise.all([
      target.start(START_INPUT),
      target.start(START_INPUT),
    ])

    expect(harness.spawns).toHaveLength(1)
    expect(second).toEqual(first)
    expect(await target.start(START_INPUT)).toEqual(first)
    expect(harness.spawns).toHaveLength(1)
  })

  it('refuses a start for another model while one is running, and keeps it serving', async () => {
    const target = supervisor(payloadDirectory())
    await target.start(START_INPUT)
    const child = lastSpawn().child

    const failure = await startFailure(target, { ...START_INPUT, modelId: 'other-model' })

    expect(failure.message).toMatch(/already serving/u)
    expect(failure.message).toMatch(/other-model/u)
    // Switching models is an explicit stop then start, never a takeover of the running child.
    expect(harness.spawns).toHaveLength(1)
    expect(child.signals).toEqual([])
    expect(target.state.status).toBe('running')
    expect(target.state.modelId).toBe(MODEL_ID)
  })

  it('stops the child gracefully and an idempotent second stop sends nothing', async () => {
    const target = supervisor(payloadDirectory())
    const states = recordStates(target)
    await target.start(START_INPUT)
    const child = lastSpawn().child

    expect(await target.stop()).toEqual({ status: 'stopped' })
    expect(child.signals).toEqual(['SIGTERM'])
    expect(states.filter(state => state.status === 'stopped')).toHaveLength(1)

    expect(await target.stop()).toEqual({ status: 'stopped' })
    expect(child.signals).toEqual(['SIGTERM'])
    expect(states.filter(state => state.status === 'stopped')).toHaveLength(1)
  })

  it('escalates to SIGKILL when the child ignores the graceful signal', async () => {
    const target = supervisor(payloadDirectory(), { timeouts: { exitMs: 20 } })
    await target.start(START_INPUT)
    const child = lastSpawn().child
    child.exitOnSignal = false

    expect((await target.stop()).status).toBe('stopped')
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('still resolves and reports stopped when even SIGKILL is not waited out', async () => {
    const target = supervisor(payloadDirectory(), { timeouts: { exitMs: 20 } })
    await target.start(START_INPUT)
    const child = lastSpawn().child
    child.exitOnSignal = false
    child.exitOnForce = false
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(target.stop()).resolves.toEqual({ status: 'stopped' })
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(logged).toHaveBeenCalled()
  })

  it('fails with a typed error and spawns nothing when the payload is absent', async () => {
    const target = supervisor(tempRoot())
    const states = recordStates(target)

    const failure = await startFailure(target)

    expect(failure.message).toMatch(/is missing/u)
    expect(failure.message).toContain('node apps/desktop/scripts/vendor-llama.mjs')
    expect(failure.message).not.toContain('Reinstall the application')
    expect(harness.spawns).toHaveLength(0)
    expect(target.state.status).toBe('error')
    expect(states.map(state => state.status)).toEqual(['error'])
  })

  it('names reinstalling as the remedy when a packaged payload is absent', async () => {
    const { fetcher } = readyFetch()
    const target = new LlamaServer(
      { packaged: true, resourcesPath: join('C:', 'unused'), appPath: join('C:', 'app') },
      { directory: tempRoot(), spawn: spawnIntoHarness, allocatePort: async () => FIXED_PORT, fetch: fetcher },
    )
    servers.push(target)

    const failure = await startFailure(target)

    expect(failure.message).toMatch(/is missing/u)
    expect(failure.message).toContain('Reinstall the application')
    expect(failure.message).not.toContain('vendor-llama')
    expect(harness.spawns).toHaveLength(0)
    expect(target.state.status).toBe('error')
  })

  it('rejects an invalid start request without spawning', async () => {
    const target = supervisor(payloadDirectory())

    const failure = await startFailure(target, { ...START_INPUT, threads: 0 })

    expect(failure.message).toMatch(/thread count 0 is not a positive integer/u)
    expect(harness.spawns).toHaveLength(0)
  })
})
