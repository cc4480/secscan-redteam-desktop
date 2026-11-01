/**
 * The bundled engagement engine: how it is started, what it publishes into the
 * environment the Host composes the MCP rows from, when an operator's own console
 * wins, and that it never outlives the application.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopRedteamRunner,
  DesktopRedteamRunnerStartupError,
  REDTEAM_RUNNER_ENTRY,
  REDTEAM_RUNNER_READY_TIMEOUT_MS,
  REDTEAM_TOOLS_RESOURCE_DIRECTORY,
  allocateLoopbackPort,
  generatedRedteamToken,
  isRedteamConsoleToken,
  isRedteamTestMode,
  probeRedteamConsole,
  redteamConsoleEndpoint,
  redteamRunnerResources,
  redteamToolsDirectory,
  type RedteamRunnerResources,
} from '../src/redteam-runner.ts'
import { DEFAULT_REDTEAM_MCP_URL } from '../src/mcp-credential-contract.ts'
import { desktopNodeEnvironment } from '../src/node-environment.ts'

/** One captured spawn: the child process the supervisor asked the OS for. */
interface SpawnedChild {
  readonly command: string
  readonly args: readonly string[]
  readonly options: { readonly env: NodeJS.ProcessEnv; readonly cwd?: string }
  readonly child: FakeChild
}

/** The subset of `ChildProcess` the supervisor touches, plus what the assertions read. */
interface FakeChild {
  readonly signals: string[]
  /** Captured standard error, so a test can emit the line a failing console would print. */
  readonly stderr: { emit(event: 'data', chunk: string): void }
  /** Whether a termination signal makes this child exit, as a healthy console does. */
  exitOnSignal: boolean
  /** Code reported through `exitCode` once the child has exited. */
  exitCode: number | null
  emit(event: 'exit', code: number | null, signal: string | null): void
}

/** Captured spawns, filled by the mocked `node:child_process`. */
const harness = vi.hoisted(() => ({ spawns: [] as SpawnedChild[] }))

vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    spawn: (command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv; cwd?: string }) => {
      // Shaped like a ChildProcess: the output streams carry data, `once` delivers exit
      // and error, and `kill` records the signal before the child acts on it.
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        signals: [] as string[],
        exitCode: null as number | null,
        signalCode: null as string | null,
        exitOnSignal: true,
        kill: (signal: string) => {
          child.signals.push(signal)
          if (child.exitOnSignal || signal === 'SIGKILL') queueMicrotask(() => { stop(signal) })
          return true
        },
      })
      const stop = (signal: string): void => {
        if (child.signalCode !== null) return
        child.signalCode = signal
        child.emit('exit', null, signal)
      }
      harness.spawns.push({ command, args, options, child })
      return child
    },
  }
})

const roots: string[] = []
afterEach(() => {
  harness.spawns.length = 0
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A payload directory that looks like the one the application ships. */
function payload(): { root: string; resources: RedteamRunnerResources; engagements: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-engagement-runner-'))
  roots.push(root)
  const directory = join(root, 'redteam-runner')
  mkdirSync(join(directory, 'dist'), { recursive: true })
  writeFileSync(join(directory, ...REDTEAM_RUNNER_ENTRY.split('/')), '// the runner entry point\n')
  return { root, resources: { node: join(root, 'SecScan RedTeam.exe'), directory }, engagements: join(root, 'profile', 'engagements', 'live') }
}

/** @returns the newest captured spawn, which every lifecycle test asserts against. */
function lastSpawn(): SpawnedChild {
  const spawn = harness.spawns.at(-1)
  if (spawn === undefined) throw new Error('the runner was not spawned')
  return spawn
}

/** @returns the failure a launch reported, so one assertion can read both its type and its message. */
async function startFailure(runner: DesktopRedteamRunner): Promise<DesktopRedteamRunnerStartupError> {
  const failure = await runner.start().then(() => undefined, (error: unknown) => error)
  if (!(failure instanceof DesktopRedteamRunnerStartupError)) throw new Error('the runner started instead of failing')
  return failure
}

const NOW = /^[0-9a-f]{64}$/u

describe('bundled engagement runner startup', () => {
  it('starts the payload with the bundled Node runtime on loopback', async () => {
    const { resources, engagements } = payload()
    const environment: NodeJS.ProcessEnv = {}
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_777,
      probe: async () => true,
    })

    const started = await runner.start()
    expect(started).toBeDefined()
    expect(started!.endpoint).toBe('http://127.0.0.1:18777/mcp')
    expect(started!.token).toMatch(NOW)

    const spawn = lastSpawn()
    // The executable is the application's own runtime, not a Node installation on the
    // machine, and it is asked for Node mode exactly as the Host child is.
    expect(spawn.command).toBe(resources.node)
    expect(spawn.args[0]).toBe(join(resources.directory, ...REDTEAM_RUNNER_ENTRY.split('/')))
    expect(spawn.args.slice(1)).toEqual([
      'ui', '--port', '18777', '--listen', '127.0.0.1', '--engagements-dir', engagements,
    ])
    expect(spawn.options.env.ELECTRON_RUN_AS_NODE).toBe('1')
    // The console is started with the token the rows will present, and prints neither.
    expect(spawn.options.env.REDTEAM_UI_TOKEN).toBe(started!.token)
    expect(spawn.options.cwd).toBe(resources.directory)
    expect(runner.consoleEnvironmentNames).toEqual(new Set(['REDTEAM_UI_TOKEN', 'REDTEAM_MCP_URL']))
  })

  it('publishes the endpoint and token into the environment the Host is spawned with', async () => {
    const { resources, engagements } = payload()
    // The same object main() passes to DesktopHostProcess, which is where cordis reads
    // REDTEAM_MCP_URL and REDTEAM_UI_TOKEN while it composes the MCP rows.
    const environment: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_778,
      probe: async () => true,
    })
    const started = await runner.start()

    expect(environment.REDTEAM_MCP_URL).toBe('http://127.0.0.1:18778/mcp')
    expect(environment.REDTEAM_UI_TOKEN).toBe(started!.token)
    // DesktopHostProcess.start builds its spawn environment through this function, so
    // this is the exact object the MCP client rows read at composition time.
    const host = desktopNodeEnvironment('electron', undefined, environment)
    expect(host.REDTEAM_MCP_URL).toBe('http://127.0.0.1:18778/mcp')
    expect(host.REDTEAM_UI_TOKEN).toBe(started!.token)
    expect(host.ELECTRON_RUN_AS_NODE).toBe('1')
    // It is exactly the object handed to the constructor, not a copy.
    expect(host.PATH).toBe('/usr/bin')
  })

  it('stops the console when the application exits and leaves no stale endpoint behind', async () => {
    const { resources, engagements } = payload()
    const environment: NodeJS.ProcessEnv = {}
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_779,
      probe: async () => true,
    })
    await runner.start()
    await runner.stop()

    expect(lastSpawn().child.signals).toEqual(['SIGTERM'])
    expect(runner.consoleEnvironmentNames.size).toBe(0)
    expect(environment.REDTEAM_MCP_URL).toBeUndefined()
    expect(environment.REDTEAM_UI_TOKEN).toBeUndefined()
    // A second stop is a no-op rather than a second signal.
    await runner.stop()
    expect(lastSpawn().child.signals).toEqual(['SIGTERM'])
  })

  it('terminates a console that ignores the graceful signal', async () => {
    const { resources, engagements } = payload()
    const runner = new DesktopRedteamRunner(resources, {}, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_780,
      probe: async () => true,
      timeouts: { exitMs: 20 },
    })
    await runner.start()
    const child = lastSpawn().child
    child.exitOnSignal = false
    await runner.stop()
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })
})

describe('operator-supplied console', () => {
  it('never overwrites a token exported for this run', async () => {
    const { resources, engagements } = payload()
    const environment: NodeJS.ProcessEnv = { REDTEAM_UI_TOKEN: 'token-from-the-launch-environment' }
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_781,
      probe: async () => true,
    })

    expect(await runner.start()).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
    expect(environment.REDTEAM_UI_TOKEN).toBe('token-from-the-launch-environment')
    expect(environment.REDTEAM_MCP_URL).toBeUndefined()
    expect(runner.consoleEnvironmentNames.size).toBe(0)
  })

  it('never overwrites an endpoint exported for this run', async () => {
    const { resources, engagements } = payload()
    const environment: NodeJS.ProcessEnv = { REDTEAM_MCP_URL: 'https://console.example.test/mcp' }
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_782,
      probe: async () => true,
    })

    expect(await runner.start()).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
    expect(environment.REDTEAM_MCP_URL).toBe('https://console.example.test/mcp')
  })

  it('leaves a console endpoint stored in the credential document to that console', async () => {
    const { resources, engagements } = payload()
    // Installed from the document, not exported: still the operator's console.
    const environment: NodeJS.ProcessEnv = { REDTEAM_MCP_URL: 'https://console.example.test/mcp' }
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(['REDTEAM_MCP_URL']),
      allocatePort: async () => 18_783,
      probe: async () => true,
    })

    expect(await runner.start()).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
    expect(environment.REDTEAM_MCP_URL).toBe('https://console.example.test/mcp')
  })

  it('reuses a token stored for the console, so an upgrade keeps matching on both sides', async () => {
    const { resources, engagements } = payload()
    const stored = 'stored-console-token-0001'
    const environment: NodeJS.ProcessEnv = { REDTEAM_UI_TOKEN: stored }
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(['REDTEAM_UI_TOKEN']),
      allocatePort: async () => 18_784,
      probe: async () => true,
    })

    const started = await runner.start()
    expect(started).toEqual({ endpoint: 'http://127.0.0.1:18784/mcp', token: stored })
    expect(lastSpawn().options.env.REDTEAM_UI_TOKEN).toBe(stored)
    expect(environment.REDTEAM_UI_TOKEN).toBe(stored)
  })
})

describe('testing mode', () => {
  it('starts the bundled console despite a token exported for this run, with a fresh token', async () => {
    const { resources, engagements } = payload()
    const stale = 'stale-operator-token-00000001'
    const environment: NodeJS.ProcessEnv = { REDTEAM_TEST_MODE: '1', REDTEAM_UI_TOKEN: stale }
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_791,
      probe: async () => true,
    })

    const started = await runner.start()
    expect(started).toBeDefined()
    expect(started!.endpoint).toBe('http://127.0.0.1:18791/mcp')
    // The fresh token wins on both sides of the row: the console child is spawned
    // with it, and the environment the MCP rows read is overwritten with it, so the
    // inherited token is presented nowhere.
    expect(started!.token).toMatch(NOW)
    expect(started!.token).not.toBe(stale)
    expect(lastSpawn().options.env.REDTEAM_UI_TOKEN).toBe(started!.token)
    expect(environment.REDTEAM_UI_TOKEN).toBe(started!.token)
    expect(environment.REDTEAM_MCP_URL).toBe('http://127.0.0.1:18791/mcp')
    expect(runner.consoleEnvironmentNames).toEqual(new Set(['REDTEAM_UI_TOKEN', 'REDTEAM_MCP_URL']))
    // The bypass is loud: the log names testing mode as the reason the console
    // started, because a bypassed suppression looks identical to a normal start.
    expect(info.mock.calls.flat().join('\n')).toMatch(/REDTEAM_TEST_MODE is on/u)
  })

  it('starts the bundled console despite an endpoint exported for this run', async () => {
    const { resources, engagements } = payload()
    const environment: NodeJS.ProcessEnv = { REDTEAM_TEST_MODE: '1', REDTEAM_MCP_URL: 'https://console.example.test/mcp' }
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_792,
      probe: async () => true,
    })

    const started = await runner.start()
    expect(started).toBeDefined()
    expect(harness.spawns).toHaveLength(1)
    expect(started!.endpoint).toBe('http://127.0.0.1:18792/mcp')
    expect(environment.REDTEAM_MCP_URL).toBe('http://127.0.0.1:18792/mcp')
  })

  it('keeps the operator console winning when testing mode is not exactly on', async () => {
    const { resources, engagements } = payload()
    // Any value other than "1" - here a plausible-looking one - leaves today's
    // suppression exactly as it is.
    const environment: NodeJS.ProcessEnv = { REDTEAM_TEST_MODE: 'true', REDTEAM_UI_TOKEN: 'token-from-the-launch-environment' }
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_793,
      probe: async () => true,
    })

    expect(await runner.start()).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
    expect(environment.REDTEAM_UI_TOKEN).toBe('token-from-the-launch-environment')
    expect(environment.REDTEAM_MCP_URL).toBeUndefined()
    expect(runner.consoleEnvironmentNames.size).toBe(0)
  })

  it('starts normally when testing mode is on and nothing describes an operator console', async () => {
    const { resources, engagements } = payload()
    const environment: NodeJS.ProcessEnv = { REDTEAM_TEST_MODE: '1' }
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_794,
      probe: async () => true,
    })

    const started = await runner.start()
    expect(started).toBeDefined()
    expect(started!.endpoint).toBe('http://127.0.0.1:18794/mcp')
    expect(started!.token).toMatch(NOW)
    expect(lastSpawn().options.env.REDTEAM_UI_TOKEN).toBe(started!.token)
    expect(environment.REDTEAM_MCP_URL).toBe('http://127.0.0.1:18794/mcp')
    expect(environment.REDTEAM_UI_TOKEN).toBe(started!.token)
  })

  it('reads testing mode only from the exact launch value', () => {
    expect(isRedteamTestMode({ REDTEAM_TEST_MODE: '1' })).toBe(true)
    expect(isRedteamTestMode({ REDTEAM_TEST_MODE: '0' })).toBe(false)
    expect(isRedteamTestMode({ REDTEAM_TEST_MODE: ' 1 ' })).toBe(false)
    expect(isRedteamTestMode({})).toBe(false)
  })
})

describe('visible failure instead of an absent engine', () => {
  it('refuses to run when the packaged payload is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-engagement-runner-'))
    roots.push(root)
    const runner = new DesktopRedteamRunner({ node: join(root, 'electron'), directory: join(root, 'redteam-runner') }, {}, {
      engagementsDir: join(root, 'engagements'),
      installed: new Set(),
      allocatePort: async () => 18_785,
      probe: async () => true,
    })

    const failure = await startFailure(runner)
    expect(failure.message).toMatch(/does not carry the engagement engine/u)
    expect(failure.message).toContain(join(root, 'redteam-runner', 'dist', 'cli.js'))
    expect(harness.spawns).toHaveLength(0)
    expect(runner.consoleEnvironmentNames.size).toBe(0)
  })

  it('reports the console that never answers, and does not leave it running', async () => {
    const { resources, engagements } = payload()
    const environment: NodeJS.ProcessEnv = {}
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_786,
      probe: async () => false,
      timeouts: { readyMs: 20, exitMs: 20 },
    })

    const failure = await startFailure(runner)
    expect(failure.message).toMatch(/did not answer on http:\/\/127\.0\.0\.1:18786\/mcp/u)
    expect(harness.spawns).toHaveLength(1)
    // The failed child is terminated, so the port it took cannot be held by an orphan.
    expect(lastSpawn().child.signals).toEqual(['SIGTERM'])
    expect(environment.REDTEAM_MCP_URL).toBeUndefined()
    expect(environment.REDTEAM_UI_TOKEN).toBeUndefined()
  })

  it('reports a console that exits before it answers, quoting what it printed', async () => {
    const { resources, engagements } = payload()
    const runner = new DesktopRedteamRunner(resources, {}, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_787,
      // The child exits while the probe is still failing; its own last line is what an
      // operator needs to see, because the dialog cannot show a log file.
      probe: async () => {
        const child = lastSpawn().child
        child.stderr.emit('data', 'Error: listen EACCES: permission denied 127.0.0.1:18787\n')
        child.exitCode = 1
        return false
      },
      timeouts: { readyMs: 20, exitMs: 20 },
    })

    const failure = await startFailure(runner)
    expect(failure.message).toMatch(/exited with code 1 before answering/u)
    expect(failure.message).toContain('EACCES')
  })
})

describe('console address', () => {
  it('keeps the preferred port reachable as the default endpoint', () => {
    expect(redteamConsoleEndpoint(8787)).toBe(DEFAULT_REDTEAM_MCP_URL)
    expect(redteamConsoleEndpoint(8787)).toBe('http://127.0.0.1:8787/mcp')
    expect(() => redteamConsoleEndpoint(0)).toThrow(/not a loopback port/u)
    expect(() => redteamConsoleEndpoint(70_000)).toThrow(/not a loopback port/u)
  })

  it('moves to a free loopback port when the preferred one is held', async () => {
    const { createServer } = await import('node:net')
    const held = createServer()
    await new Promise<void>((resolve) => { held.listen(0, '127.0.0.1', () => { resolve() }) })
    const address = held.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    try {
      const chosen = await allocateLoopbackPort(port)
      expect(chosen).not.toBe(port)
      expect(chosen).toBeGreaterThan(0)
    } finally {
      await new Promise<void>((resolve) => { held.close(() => { resolve() }) })
    }
  })

  it('generates a token the runner accepts, and rejects one below its floor', () => {
    expect(generatedRedteamToken()).toMatch(NOW)
    expect(generatedRedteamToken()).not.toBe(generatedRedteamToken())
    expect(isRedteamConsoleToken(generatedRedteamToken())).toBe(true)
    expect(isRedteamConsoleToken('  short-token  ')).toBe(false)
  })

  it('answers a probe only for the console it expected', async () => {
    const reply = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)))
    try {
      reply({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'secscan-redteam-runner' } } })
      expect(await probeRedteamConsole('http://127.0.0.1:8787/mcp', 't')).toBe(true)
      reply({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'something-else' } } })
      expect(await probeRedteamConsole('http://127.0.0.1:8787/mcp', 't')).toBe(false)
      reply({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'unauthorized' } })
      expect(await probeRedteamConsole('http://127.0.0.1:8787/mcp', 't')).toBe(false)
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))
      expect(await probeRedteamConsole('http://127.0.0.1:8787/mcp', 't')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('declares a readiness budget long enough for a cold start', () => {
    // The console loads its module graph, the profile store and the dashboard assets
    // before it listens; anything shorter would turn a slow disk into a failed launch.
    expect(REDTEAM_RUNNER_READY_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
  })
})

describe('payload location', () => {
  it('reads the packaged payload from the application resources', () => {
    expect(redteamRunnerResources({
      packaged: true, resourcesPath: join('C:', 'App', 'resources'), appPath: join('C:', 'App', 'resources', 'app.asar'),
      node: join('C:', 'App', 'SecScan RedTeam.exe'),
    })).toEqual({
      node: join('C:', 'App', 'SecScan RedTeam.exe'),
      directory: join('C:', 'App', 'resources', 'redteam-runner'),
    })
  })

  it('reads the checked-in payload for an unpackaged launch, unless the environment names one', () => {
    expect(redteamRunnerResources({
      packaged: false, resourcesPath: join('C:', 'Other'), appPath: join('C:', 'repo', 'apps', 'desktop'), node: 'electron',
    })).toEqual({ node: 'electron', directory: join('C:', 'repo', 'apps', 'desktop', 'resources', 'redteam-runner') })
    expect(redteamRunnerResources({
      packaged: false, resourcesPath: join('C:', 'Other'), appPath: join('C:', 'repo', 'apps', 'desktop'), node: 'electron',
      environment: { DSH_DESKTOP_REDTEAM_RUNNER_DIR: join('C:', 'checkout', 'redteam-runner') },
    })).toEqual({ node: 'electron', directory: join('C:', 'checkout', 'redteam-runner') })
  })

  it('reads the bundled tools from the application resources when packaged', () => {
    expect(REDTEAM_TOOLS_RESOURCE_DIRECTORY).toBe('tools')
    expect(redteamToolsDirectory({
      packaged: true, resourcesPath: join('C:', 'App', 'resources'), appPath: join('C:', 'App', 'resources', 'app.asar'),
      node: join('C:', 'App', 'SecScan RedTeam.exe'),
    })).toBe(join('C:', 'App', 'resources', 'tools'))
  })

  it('reads the bundled tools from the checked-in resources for an unpackaged launch', () => {
    expect(redteamToolsDirectory({
      packaged: false, resourcesPath: join('C:', 'Other'), appPath: join('C:', 'repo', 'apps', 'desktop'), node: 'electron',
    })).toBe(join('C:', 'repo', 'apps', 'desktop', 'resources', 'tools'))
  })

  it('leaves the tools directory to an operator who names one', () => {
    // A provisioned tree replaces the bundled location; an empty value names no directory,
    // so the launch keeps resolving the payload this installation ships.
    const packaged = {
      packaged: true, resourcesPath: join('C:', 'App', 'resources'), appPath: join('C:', 'App', 'resources', 'app.asar'),
      node: join('C:', 'App', 'SecScan RedTeam.exe'),
    }
    expect(redteamToolsDirectory({ ...packaged, environment: { REDTEAM_TOOLS_DIR: join('C:', 'provisioned', 'tools') } }))
      .toBe(join('C:', 'provisioned', 'tools'))
    expect(redteamToolsDirectory({ ...packaged, environment: { REDTEAM_TOOLS_DIR: '' } }))
      .toBe(join('C:', 'App', 'resources', 'tools'))
  })
})

describe('bundled tools payload', () => {
  it('exports the tools directory it ships to the console it starts', async () => {
    const { root, resources, engagements } = payload()
    const tools = join(root, 'tools')
    mkdirSync(tools, { recursive: true })
    const environment: NodeJS.ProcessEnv = {}
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_788,
      probe: async () => true,
    })

    await runner.start()
    // The runner resolves its bundled binaries from here ahead of PATH, so the console
    // never depends on which tools the machine happens to have installed.
    expect(lastSpawn().options.env.REDTEAM_TOOLS_DIR).toBe(tools)
    // Only the console's environment names it; the environment the Host is spawned with
    // describes the console, not the tools directory.
    expect(environment.REDTEAM_TOOLS_DIR).toBeUndefined()
  })

  it('leaves the tools PATH-resolved when this installation ships no tools payload', async () => {
    const { resources, engagements } = payload()
    // Nothing under the sibling `tools` directory: the payload was never provisioned.
    const runner = new DesktopRedteamRunner(resources, {}, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_789,
      probe: async () => true,
    })

    await runner.start()
    // Absent payload: the tools stay PATH-resolved, and readiness reports them missing.
    expect(lastSpawn().options.env.REDTEAM_TOOLS_DIR).toBeUndefined()
  })

  it('never overwrites a tools directory exported for this run', async () => {
    const { root, resources, engagements } = payload()
    // A payload this installation ships, and a provisioned tree the operator named.
    mkdirSync(join(root, 'tools'), { recursive: true })
    const provisioned = join(root, 'provisioned', 'tools')
    const environment: NodeJS.ProcessEnv = { REDTEAM_TOOLS_DIR: provisioned }
    const runner = new DesktopRedteamRunner(resources, environment, {
      engagementsDir: engagements,
      installed: new Set(),
      allocatePort: async () => 18_790,
      probe: async () => true,
    })

    await runner.start()
    expect(lastSpawn().options.env.REDTEAM_TOOLS_DIR).toBe(provisioned)
  })
})
