/**
 * The bundled Metasploit RPC daemon: how a real installation's launcher is resolved,
 * what it publishes into the environment the Host composes the runner rows from, when
 * it stays off, and that a daemon this process started never outlives the application.
 */

import type { SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MSFRPC_PORT,
  DesktopMetasploit,
  DesktopMetasploitStartupError,
  MSF_HOME_ENVIRONMENT_NAME,
  MSFRPC_ENVIRONMENT_NAMES,
  MSFRPC_HOST_ENVIRONMENT_NAME,
  MSFRPC_PASS_ENVIRONMENT_NAME,
  MSFRPC_PORT_ENVIRONMENT_NAME,
  MSFRPC_RPC_USER,
  MSFRPC_TLS_ENVIRONMENT_NAME,
  MSFRPC_USER_ENVIRONMENT_NAME,
  findMetasploitHome,
  generatedMsfrpcPassword,
  isOperatorMsfConfigured,
  msfrpcdLaunch,
  type MetasploitChild,
  type MetasploitOptions,
} from '../src/redteam-msf.ts'

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
class FakeChildProcess extends EventEmitter implements MetasploitChild {
  /** Signals delivered to this child, in delivery order. */
  readonly signals: string[] = []
  /** Standard output stream the supervisor listens on. */
  readonly stdout = new PassThrough()
  /** Standard error stream the supervisor listens on. */
  readonly stderr = new PassThrough()
  /** Whether a termination signal makes this child exit, as a healthy daemon does. */
  exitOnSignal = true
  /** Exit code reported once the child has exited. */
  exitCode: number | null = null
  /** Signal reported once the child has exited. */
  signalCode: NodeJS.Signals | null = null

  /** Records the signal, then exits unless the child is configured to ignore it. */
  kill(signal?: NodeJS.Signals | number): boolean {
    const name: NodeJS.Signals = typeof signal === 'string' ? signal : 'SIGKILL'
    this.signals.push(name)
    if (this.exitOnSignal || name === 'SIGKILL') queueMicrotask(() => { this.exit(null, name) })
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
function spawnIntoHarness(command: string, args: readonly string[], options: SpawnOptions): MetasploitChild {
  const child = new FakeChildProcess()
  harness.spawns.push({ command, args, options, child })
  return child
}

/** Port every defaulted supervisor allocates; a fixed value keeps the assertions readable. */
const FIXED_PORT = 18_777

/** @returns a supervisor wired to the fake child and, by default, a probe that succeeds at once. */
function supervisor(home: string | undefined, environment: NodeJS.ProcessEnv, options: MetasploitOptions = {}): DesktopMetasploit {
  return new DesktopMetasploit(home, environment, {
    spawn: spawnIntoHarness,
    allocatePort: async () => FIXED_PORT,
    probe: async () => true,
    ...options,
  })
}

const roots: string[] = []
afterEach(() => {
  harness.spawns.length = 0
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** @returns a fresh temp directory owned by this test file. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-msfrpcd-'))
  roots.push(root)
  return root
}

/** @returns the Ruby executable name an embedded runtime carries on the platform. */
function rubyName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'ruby.exe' : 'ruby'
}

/** @returns the directly executable msfrpcd name the platform uses. */
function directName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'msfrpcd.exe' : 'msfrpcd'
}

/** A Framework root shaped like the real omnibus install: embedded Ruby runs the framework script. */
function rubyFrameworkHome(platform: NodeJS.Platform): string {
  const root = tempRoot()
  mkdirSync(join(root, 'embedded', 'bin'), { recursive: true })
  mkdirSync(join(root, 'embedded', 'framework'), { recursive: true })
  writeFileSync(join(root, 'embedded', 'bin', rubyName(platform)), '')
  writeFileSync(join(root, 'embedded', 'framework', 'msfrpcd'), '')
  return root
}

/** A Windows Framework root whose only launcher is the batch wrapper. */
function batchFrameworkHome(): string {
  const root = tempRoot()
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(join(root, 'bin', 'msfrpcd.bat'), '@echo off\r\n')
  return root
}

/** A Framework root that carries a directly executable msfrpcd as well. */
function binaryFrameworkHome(platform: NodeJS.Platform): string {
  const root = tempRoot()
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(join(root, 'bin', directName(platform)), '')
  return root
}

/** @returns the RPC flags the supervisor appends after a launcher's own arguments. */
function rpcArgs(port: number, password: string | undefined): string[] {
  return ['-U', MSFRPC_RPC_USER, '-P', password ?? '', '-a', '127.0.0.1', '-p', String(port), '-S', '-f']
}

/** @returns the command processor the resolver names, mirroring its ComSpec fallback. */
function commandProcessor(): string {
  const command = (process.env.ComSpec ?? '').trim()
  return command === '' ? 'cmd.exe' : command
}

/** @returns the newest captured spawn, which every lifecycle test asserts against. */
function lastSpawn(): SpawnedChild {
  const spawn = harness.spawns.at(-1)
  if (spawn === undefined) throw new Error('msfrpcd was not spawned')
  return spawn
}

/** @returns the failure a launch reported, so one assertion can read both its type and its message. */
async function startFailure(msf: DesktopMetasploit): Promise<DesktopMetasploitStartupError> {
  const failure = await msf.start().then(() => undefined, (error: unknown) => error)
  if (!(failure instanceof DesktopMetasploitStartupError)) throw new Error('the daemon started instead of failing')
  return failure
}

const PASSWORD_SHAPE = /^[0-9a-f]{64}$/u

describe('Metasploit Framework launcher resolution', () => {
  it('takes REDTEAM_MSF_HOME as the installation, without probing the default roots', () => {
    const home = join('C:', 'operator', 'metasploit-framework')
    const exists = vi.fn((_path: string) => false)

    expect(findMetasploitHome({ [MSF_HOME_ENVIRONMENT_NAME]: home }, exists)).toBe(home)
    // The operator's word is final, so detection must not go looking for another install.
    expect(exists).not.toHaveBeenCalled()
  })

  it('resolves the real install shape to embedded ruby plus the framework script', () => {
    const platform = process.platform
    const home = rubyFrameworkHome(platform)
    // The omnibus installer also ships the batch wrapper; the direct spawn must win.
    mkdirSync(join(home, 'bin'), { recursive: true })
    writeFileSync(join(home, 'bin', 'msfrpcd.bat'), '@echo off\r\n')
    if (platform !== 'win32') writeFileSync(join(home, 'bin', directName(platform)), '')

    expect(msfrpcdLaunch(home, existsSync, platform)).toEqual({
      command: join(home, 'embedded', 'bin', rubyName(platform)),
      args: [join(home, 'embedded', 'framework', 'msfrpcd')],
      kind: 'embeddedRuby',
    })
  })

  it('resolves the Windows batch wrapper through the command processor', () => {
    const home = batchFrameworkHome()
    expect(msfrpcdLaunch(home, existsSync, 'win32')).toEqual({
      command: commandProcessor(),
      args: ['/c', join(home, 'bin', 'msfrpcd.bat')],
      kind: 'batch',
    })
    // The same tree offers no launcher on a platform where the batch file is meaningless.
    expect(msfrpcdLaunch(home, existsSync, 'linux')).toBeUndefined()
  })

  it('resolves a directly executable msfrpcd when the install carries one', () => {
    const platform: NodeJS.Platform = 'win32'
    const home = binaryFrameworkHome(platform)
    expect(msfrpcdLaunch(home, existsSync, platform)).toEqual({
      command: join(home, 'bin', directName(platform)),
      args: [],
      kind: 'direct',
    })
    expect(msfrpcdLaunch(tempRoot(), existsSync, platform)).toBeUndefined()
  })

  it('spawns nothing when no Metasploit Framework is installed', async () => {
    const environment: NodeJS.ProcessEnv = {}
    const home = findMetasploitHome(environment, () => false)
    expect(home).toBeUndefined()

    expect(await supervisor(home, environment).start()).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
    for (const name of MSFRPC_ENVIRONMENT_NAMES) expect(environment[name]).toBeUndefined()
  })

  it('leaves an operator-configured msfrpcd alone', async () => {
    const environment: NodeJS.ProcessEnv = {
      [MSFRPC_USER_ENVIRONMENT_NAME]: 'operator-user',
      [MSFRPC_PASS_ENVIRONMENT_NAME]: 'operator-secret',
    }
    expect(isOperatorMsfConfigured(environment)).toBe(true)
    // Half a credential cannot authenticate, so it must not suppress the bundled daemon.
    expect(isOperatorMsfConfigured({ [MSFRPC_USER_ENVIRONMENT_NAME]: 'only-user' })).toBe(false)

    const msf = supervisor(rubyFrameworkHome(process.platform), environment, {
      probe: async () => { throw new Error('a configured daemon must not be probed') },
    })
    expect(await msf.start()).toBeUndefined()
    expect(harness.spawns).toHaveLength(0)
    // The operator's own values survive untouched, and the bundled names stay unpublished.
    expect(environment[MSFRPC_USER_ENVIRONMENT_NAME]).toBe('operator-user')
    expect(environment[MSFRPC_PASS_ENVIRONMENT_NAME]).toBe('operator-secret')
    expect(environment[MSFRPC_HOST_ENVIRONMENT_NAME]).toBeUndefined()
    expect(environment[MSFRPC_PORT_ENVIRONMENT_NAME]).toBeUndefined()
    expect(environment[MSFRPC_TLS_ENVIRONMENT_NAME]).toBeUndefined()
  })
})

describe('Metasploit RPC daemon lifecycle', () => {
  it('starts embedded ruby on a free loopback port and publishes what the runner reads', async () => {
    const platform = process.platform
    const home = rubyFrameworkHome(platform)
    // A system Ruby manager's variables, which the embedded runtime must not inherit.
    const environment: NodeJS.ProcessEnv = {
      PATH: join('C:', 'system'),
      GEM_HOME: join('C:', 'ruby', 'gems'),
      RUBY_ROOT: join('C:', 'ruby'),
    }
    const allocatePort = vi.fn(async () => FIXED_PORT)
    const probe = vi.fn(async () => true)
    const msf = new DesktopMetasploit(home, environment, { spawn: spawnIntoHarness, allocatePort, probe, platform })

    const started = await msf.start()
    expect(started).toBeDefined()
    expect(started).toEqual({ host: '127.0.0.1', port: FIXED_PORT, user: MSFRPC_RPC_USER })
    // The endpoint the runner receives carries no credential: only the environment does.
    expect(Reflect.ownKeys(started!)).toEqual(['host', 'port', 'user'])
    expect(allocatePort).toHaveBeenCalledWith(DEFAULT_MSFRPC_PORT)
    expect(probe).toHaveBeenCalledWith('127.0.0.1', FIXED_PORT)

    const spawn = lastSpawn()
    const password = environment[MSFRPC_PASS_ENVIRONMENT_NAME]
    expect(password).toMatch(PASSWORD_SHAPE)
    // The script is the first argument, then the RPC flags, with -f last to stay in the foreground.
    expect(spawn.command).toBe(join(home, 'embedded', 'bin', rubyName(platform)))
    expect(spawn.args[0]).toBe(join(home, 'embedded', 'framework', 'msfrpcd'))
    expect(spawn.args.slice(1)).toEqual(rpcArgs(FIXED_PORT, password))
    expect(spawn.args.at(-1)).toBe('-f')
    expect(spawn.options.cwd).toBe(home)
    expect(spawn.options.windowsHide).toBe(true)
    expect(spawn.options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    // The installer's wrapper clears the system Ruby's GEM_* variables and puts the
    // embedded runtime first on PATH; a direct spawn must reproduce that environment.
    expect(spawn.options.env?.PATH).toBe(`${join(home, 'embedded', 'bin')}${delimiter}${environment.PATH ?? ''}`)
    expect(spawn.options.env?.GEM_HOME).toBeUndefined()
    expect(spawn.options.env?.RUBY_ROOT).toBeUndefined()

    expect(environment[MSFRPC_HOST_ENVIRONMENT_NAME]).toBe('127.0.0.1')
    expect(environment[MSFRPC_PORT_ENVIRONMENT_NAME]).toBe(String(FIXED_PORT))
    expect(environment[MSFRPC_USER_ENVIRONMENT_NAME]).toBe(MSFRPC_RPC_USER)
    expect(environment[MSFRPC_PASS_ENVIRONMENT_NAME]).toBe(password)
    expect(environment[MSFRPC_TLS_ENVIRONMENT_NAME]).toBe('0')
    // The password is the only secret, and it is minted fresh rather than reused.
    // argv is [<script>, -U, user, -P, <password>, ...] for the embedded-Ruby shape.
    expect(password).toBe(spawn.args[4])
    expect(generatedMsfrpcPassword()).toMatch(PASSWORD_SHAPE)
    expect(generatedMsfrpcPassword()).not.toBe(generatedMsfrpcPassword())
  })

  it('starts the Windows batch wrapper through the command processor', async () => {
    const home = batchFrameworkHome()
    const environment: NodeJS.ProcessEnv = {}
    const msf = supervisor(home, environment, { platform: 'win32' })

    expect(await msf.start()).toBeDefined()
    const spawn = lastSpawn()
    const password = environment[MSFRPC_PASS_ENVIRONMENT_NAME]
    expect(spawn.command).toBe(commandProcessor())
    expect(spawn.args.slice(0, 2)).toEqual(['/c', join(home, 'bin', 'msfrpcd.bat')])
    expect(spawn.args.slice(2)).toEqual(rpcArgs(FIXED_PORT, password))
    expect(spawn.options.cwd).toBe(home)
    // The batch wrapper sets its own environment, so this launch inherits the Host's.
    expect(spawn.options.env).toBeUndefined()
    expect(environment[MSFRPC_HOST_ENVIRONMENT_NAME]).toBe('127.0.0.1')
    expect(environment[MSFRPC_PASS_ENVIRONMENT_NAME]).toMatch(PASSWORD_SHAPE)
  })

  it('starts a directly executable msfrpcd when the install carries one', async () => {
    const platform: NodeJS.Platform = 'win32'
    const home = binaryFrameworkHome(platform)
    const environment: NodeJS.ProcessEnv = {}
    const msf = supervisor(home, environment, { platform })

    expect(await msf.start()).toBeDefined()
    const spawn = lastSpawn()
    const password = environment[MSFRPC_PASS_ENVIRONMENT_NAME]
    expect(spawn.command).toBe(join(home, 'bin', directName(platform)))
    expect(spawn.args).toEqual(rpcArgs(FIXED_PORT, password))
    expect(spawn.options.cwd).toBe(home)
    expect(spawn.options.env).toBeUndefined()
    expect(environment[MSFRPC_PORT_ENVIRONMENT_NAME]).toBe(String(FIXED_PORT))
  })

  it('fails with a typed error and kills the child when readiness times out', async () => {
    const home = rubyFrameworkHome(process.platform)
    const environment: NodeJS.ProcessEnv = {}
    const msf = new DesktopMetasploit(home, environment, {
      spawn: spawnIntoHarness,
      allocatePort: async () => FIXED_PORT,
      probe: async () => false,
      timeouts: { readyMs: 20, exitMs: 20 },
    })

    const failure = await startFailure(msf)
    expect(failure).toBeInstanceOf(DesktopMetasploitStartupError)
    expect(failure.message).toMatch(/did not accept connections on 127\.0\.0\.1:18777/u)
    // The generated password never reaches the message an operator sees.
    expect(failure.message).not.toMatch(PASSWORD_SHAPE)
    expect(lastSpawn().child.signals).toEqual(['SIGTERM'])
    for (const name of MSFRPC_ENVIRONMENT_NAMES) expect(environment[name]).toBeUndefined()
  })

  it('clears the five environment names before the daemon is terminated', async () => {
    const home = rubyFrameworkHome(process.platform)
    const environment: NodeJS.ProcessEnv = {}
    const msf = supervisor(home, environment)
    expect(await msf.start()).toBeDefined()
    expect(environment[MSFRPC_HOST_ENVIRONMENT_NAME]).toBe('127.0.0.1')

    await msf.stop()
    expect(lastSpawn().child.signals).toEqual(['SIGTERM'])
    for (const name of MSFRPC_ENVIRONMENT_NAMES) expect(environment[name]).toBeUndefined()
    // A second stop is a no-op rather than a second signal.
    await msf.stop()
    expect(lastSpawn().child.signals).toEqual(['SIGTERM'])
  })
})
