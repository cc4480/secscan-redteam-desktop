/**
 * Metasploit Framework's RPC daemon, as one supervised loopback child of the Desktop process.
 *
 * Metasploit is the one optional external this product runs: a machine that carries
 * Framework gets an authenticated `msfrpcd` on an ephemeral loopback port with a
 * password this process mints, and a machine without it keeps the Metasploit bridge
 * reported as blocked instead of failing the launch. The engagement runner reads
 * `REDTEAM_MSFRPC_HOST/PORT/USER/PASS/TLS` from the environment while cordis composes
 * the profile, so `start()` installs them there only after the daemon accepts
 * connections; a daemon the operator configured always wins and suppresses this one.
 */

import { spawn, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { delimiter, dirname, join } from 'node:path'
import { allocateLoopbackPort } from './redteam-runner.ts'

/** Environment name that points this process at an installed Metasploit Framework. */
export const MSF_HOME_ENVIRONMENT_NAME = 'REDTEAM_MSF_HOME'

/** Environment name the RPC daemon's host reaches the engagement runner through. */
export const MSFRPC_HOST_ENVIRONMENT_NAME = 'REDTEAM_MSFRPC_HOST'

/** Environment name the RPC daemon's port reaches the engagement runner through. */
export const MSFRPC_PORT_ENVIRONMENT_NAME = 'REDTEAM_MSFRPC_PORT'

/** Environment name the RPC user both sides authenticate with. */
export const MSFRPC_USER_ENVIRONMENT_NAME = 'REDTEAM_MSFRPC_USER'

/** Environment name carrying the RPC password; never logged and never part of an error. */
export const MSFRPC_PASS_ENVIRONMENT_NAME = 'REDTEAM_MSFRPC_PASS'

/** Environment name that tells the runner whether the socket speaks TLS (`0` = plain loopback). */
export const MSFRPC_TLS_ENVIRONMENT_NAME = 'REDTEAM_MSFRPC_TLS'

/** Every name {@link DesktopMetasploit.start} publishes; {@link DesktopMetasploit.stop} removes exactly these. */
export const MSFRPC_ENVIRONMENT_NAMES = [
  MSFRPC_HOST_ENVIRONMENT_NAME,
  MSFRPC_PORT_ENVIRONMENT_NAME,
  MSFRPC_USER_ENVIRONMENT_NAME,
  MSFRPC_PASS_ENVIRONMENT_NAME,
  MSFRPC_TLS_ENVIRONMENT_NAME,
] as const

/** Only address msfrpcd is ever bound to: it drives live pentest tooling. */
export const MSFRPC_LOOPBACK = '127.0.0.1'

/** Port msfrpcd prefers, which is the framework's own default. */
export const DEFAULT_MSFRPC_PORT = 55_553

/** RPC identity the bundled daemon is started for, which is msfrpcd's own default user. */
export const MSFRPC_RPC_USER = 'msf'

/** Deadline for msfrpcd to accept a connection; a Framework cold start is slow. */
export const MSF_READY_TIMEOUT_MS = 30_000

/** Deadline for the child to exit after each termination signal. */
export const MSF_EXIT_TIMEOUT_MS = 5_000

/** Bytes of entropy in a generated RPC password; 64 hexadecimal characters are plenty for a loopback daemon. */
const PASSWORD_BYTES = 32

/** Pause between readiness probes; msfrpcd binds its port before it loads a single module. */
const READY_POLL_INTERVAL_MS = 250

/** Budget for one readiness probe, so a hung daemon cannot consume the whole deadline. */
const PROBE_TIMEOUT_MS = 2_000

/** Child output retained for the failure message and the crash report. */
const MAX_DIAGNOSTIC_CHARS = 8 * 1024

/** Share of that output quoted in an error message, which a native dialog has to stay readable in. */
const DIAGNOSTIC_IN_MESSAGE_CHARS = 400

/** Replacement for a secret that reached the diagnostic tail; the password never leaves this process. */
const REDACTED = '[redacted]'

/** Ruby variables the installer's wrapper clears, so a system Ruby cannot supply the framework's gems. */
const EMBEDDED_RUBY_ENVIRONMENT_NAMES = ['GEM_HOME', 'GEM_PATH', 'GEM_ROOT', 'RUBY_ENGINE', 'RUBY_ROOT'] as const

/** The child members the supervisor touches; a `ChildProcess` satisfies this shape. */
export interface MetasploitChild {
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

/** Endpoint a running msfrpcd answers on; it deliberately carries no password. */
export interface MetasploitRpcEndpoint {
  /** Loopback address the daemon was bound to. */
  readonly host: string
  /** Loopback port the daemon listens on. */
  readonly port: number
  /** RPC user both sides present. */
  readonly user: string
}

/** How to launch an installation's msfrpcd: the command plus the arguments that precede the RPC flags. */
export interface MetasploitLaunch {
  /** Executable to spawn: embedded Ruby, the command processor, or msfrpcd itself. */
  readonly command: string
  /** Arguments that must precede the RPC flags: a framework script, or `/c` plus a batch file. */
  readonly args: readonly string[]
  /**
   * Which launcher shape this is. An `embeddedRuby` launch needs the environment the
   * installer's wrapper sets up, because a system Ruby's GEM_* variables would make the
   * framework load the wrong gems; the other shapes inherit the launch environment.
   */
  readonly kind: 'embeddedRuby' | 'batch' | 'direct'
}

/** Lifecycle inputs of one {@link DesktopMetasploit}. */
export interface MetasploitOptions {
  /** Overrides the child factory; a test supplies an in-memory child instead of a process. */
  readonly spawn?: (command: string, args: readonly string[], options: SpawnOptions) => MetasploitChild
  /** Overrides the readiness probe; a test answers without a socket. */
  readonly probe?: (host: string, port: number) => Promise<boolean>
  /** Overrides the loopback port probe; a test supplies a fixed port instead of binding one. */
  readonly allocatePort?: (preferred: number) => Promise<number>
  /** Overrides the platform whose launcher names apply; a test pins the Windows batch shape. */
  readonly platform?: NodeJS.Platform
  /** Shortened deadlines, so a test exercises a failure path without waiting out the production budget. */
  readonly timeouts?: {
    /** Readiness deadline; defaults to {@link MSF_READY_TIMEOUT_MS}. */
    readonly readyMs?: number
    /** Exit deadline per termination signal; defaults to {@link MSF_EXIT_TIMEOUT_MS}. */
    readonly exitMs?: number
  }
}

/** The bundled daemon could not be started; the Metasploit bridge would otherwise be silently absent. */
export class DesktopMetasploitStartupError extends Error {}

/**
 * Resolve the Metasploit Framework installation this launch should use.
 * `REDTEAM_MSF_HOME` wins outright: an operator who names an installation expects
 * that installation to be judged on its own, not silently replaced by a detected one.
 * Otherwise the roots a Framework installer uses by default are probed for a marker
 * file, because an install is present exactly when its launcher or Ruby exists.
 * @param environment - Launch environment; `REDTEAM_MSF_HOME` overrides detection.
 * @param exists - File probe, which a test replaces instead of touching the filesystem.
 * @returns The installed Framework root, or `undefined` when no installation was found.
 */
export function findMetasploitHome(
  environment: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const configured = (environment[MSF_HOME_ENVIRONMENT_NAME] ?? '').trim()
  if (configured !== '') return configured
  for (const candidate of metasploitHomeCandidates(environment)) {
    if (frameworkMarkers(candidate).some(marker => exists(marker))) return candidate
  }
  return undefined
}

/**
 * Decide whether the operator already supplied an msfrpcd of their own.
 * Both credential names are required: half a credential cannot authenticate, so the
 * bundled daemon may still start and publish the complete set.
 * @param environment - Launch environment, or the object the Host is spawned with.
 * @returns whether both RPC credential names carry a value.
 */
export function isOperatorMsfConfigured(environment: NodeJS.ProcessEnv): boolean {
  return hasValue(environment[MSFRPC_USER_ENVIRONMENT_NAME]) && hasValue(environment[MSFRPC_PASS_ENVIRONMENT_NAME])
}

/**
 * Resolve how to launch msfrpcd from a Framework installation.
 *
 * A real installation offers more than one shape, and the shapes are not
 * interchangeable. The Windows omnibus installer ships `bin/msfrpcd.bat`, a wrapper
 * that runs the framework's own `msfrpcd` script through the bundled Ruby, and no
 * spawnable `msfrpcd.exe`; a `bin/` directory on a source or Linux install carries a
 * Ruby script directly. Preference runs from the most direct launch to the most
 * indirection: embedded Ruby plus the framework script (no shell in the supervised
 * path), then the Windows batch wrapper through the command processor, then a
 * directly executable `msfrpcd`.
 * @param home - Metasploit Framework root.
 * @param exists - File probe, which a test replaces instead of touching the filesystem.
 * @param platform - Platform whose launcher names apply; a test pins one path explicitly.
 * @returns The launcher command and its leading arguments, or `undefined` when the
 * installation carries no recognized launcher.
 */
export function msfrpcdLaunch(
  home: string,
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): MetasploitLaunch | undefined {
  const script = msfrpcdScriptPath(home)
  if (exists(script)) {
    const ruby = rubyNames(platform)
      .map(name => join(home, 'embedded', 'bin', name))
      .find(candidate => exists(candidate))
    // Spawning the embedded Ruby directly keeps cmd.exe out of the supervision path,
    // which is what lets the daemon stay the child this process owns and kills.
    if (ruby !== undefined) return { command: ruby, args: [script], kind: 'embeddedRuby' }
  }
  const batch = msfrpcdBatchPath(home)
  if (platform === 'win32' && exists(batch)) {
    // Node refuses to spawn a .bat without a shell (EINVAL), so the batch wrapper goes
    // through the command processor the operator's shell already names.
    const command = (process.env.ComSpec ?? '').trim()
    return { command: command === '' ? 'cmd.exe' : command, args: ['/c', batch], kind: 'batch' }
  }
  const direct = msfrpcdCandidatePaths(home, platform).find(candidate => exists(candidate))
  if (direct !== undefined) return { command: direct, args: [], kind: 'direct' }
  return undefined
}

/**
 * Mint the RPC password a daemon this process starts is authenticated with.
 * @returns 32 bytes of entropy as hexadecimal, which is not guessable from the app.
 */
export function generatedMsfrpcPassword(): string {
  return randomBytes(PASSWORD_BYTES).toString('hex')
}

/** @returns whether the environment value carries something other than whitespace. */
function hasValue(value: string | undefined): boolean {
  return (value ?? '').trim() !== ''
}

/**
 * Build the environment an embedded Ruby launch needs.
 *
 * The installer's batch wrapper clears the GEM_* and RUBY_* variables a system Ruby
 * manager exports and puts the embedded runtime first on PATH. Spawning Ruby directly
 * must do the same, or the framework can load gems from an operator's other Ruby.
 * @param ruby - Absolute embedded Ruby executable.
 * @param environment - Launch environment the Host uses.
 * @returns A copy of that environment prepared for the embedded runtime.
 */
function embeddedRubyEnvironment(ruby: string, environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const prepared: NodeJS.ProcessEnv = { ...environment }
  for (const name of EMBEDDED_RUBY_ENVIRONMENT_NAMES) Reflect.deleteProperty(prepared, name)
  const rubyBin = dirname(ruby)
  const inheritedPath = prepared.PATH
  prepared.PATH = inheritedPath === undefined ? rubyBin : `${rubyBin}${delimiter}${inheritedPath}`
  return prepared
}

/** @returns the default install roots of a Framework installer on this platform. */
function metasploitHomeCandidates(environment: NodeJS.ProcessEnv): readonly string[] {
  if (process.platform !== 'win32') return ['/opt/metasploit-framework']
  const programFiles = (environment.ProgramFiles ?? '').trim()
  return [
    'C:\\metasploit-framework',
    'C:\\metasploit',
    join(programFiles === '' ? 'C:\\Program Files' : programFiles, 'Metasploit'),
    'E:\\metasploit-framework',
  ]
}

/** @returns the Ruby executable names an embedded runtime may carry, most likely first. */
function rubyNames(platform: NodeJS.Platform): readonly string[] {
  return platform === 'win32' ? ['ruby.exe', 'ruby'] : ['ruby']
}

/** @returns every path a Framework installation may carry a directly executable msfrpcd at, most likely first. */
function msfrpcdCandidatePaths(home: string, platform: NodeJS.Platform): readonly string[] {
  if (platform === 'win32') {
    return [
      join(home, 'bin', 'msfrpcd.exe'),
      join(home, 'bin', 'msfrpcd'),
      join(home, 'embedded', 'bin', 'msfrpcd.exe'),
      join(home, 'embedded', 'bin', 'msfrpcd'),
    ]
  }
  return [join(home, 'bin', 'msfrpcd'), join(home, 'embedded', 'bin', 'msfrpcd')]
}

/** @returns the Windows batch wrapper that runs the framework's msfrpcd through embedded Ruby. */
function msfrpcdBatchPath(home: string): string {
  return join(home, 'bin', 'msfrpcd.bat')
}

/** @returns the framework checkout's own msfrpcd script, inside the embedded runtime. */
function msfrpcdScriptPath(home: string): string {
  return join(home, 'embedded', 'framework', 'msfrpcd')
}

/** @returns the marker files that prove an installation root really is a Framework checkout. */
function frameworkMarkers(home: string): readonly string[] {
  // Detection runs before a launcher shape is chosen, so every known marker counts.
  const markers: string[] = [msfrpcdBatchPath(home), msfrpcdScriptPath(home)]
  for (const name of ['ruby.exe', 'ruby']) markers.push(join(home, 'embedded', 'bin', name), join(home, 'bin', name))
  for (const name of ['msfrpcd.exe', 'msfrpcd']) markers.push(join(home, 'bin', name), join(home, 'embedded', 'bin', name))
  return markers
}

/**
 * Ask whether the daemon's loopback port accepts connections yet.
 * A port that accepts is not proof of identity, but for a daemon this process started
 * on a port it just chose, acceptance is the readiness the runner needs.
 * @param host - Loopback address the daemon binds.
 * @param port - Port the daemon was started with.
 * @param timeoutMs - Budget for one connection attempt.
 * @returns whether something accepted the connection.
 */
function probeMsfrpcPort(host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host, port })
    let settled = false
    const finish = (reachable: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(reachable)
    }
    socket.setTimeout(timeoutMs, () => { finish(false) })
    socket.once('connect', () => { finish(true) })
    socket.once('error', () => { finish(false) })
  })
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
 * One Metasploit RPC daemon: the `msfrpcd` of an installation this machine already
 * carries, started on loopback with a password this process owns, published into the
 * environment the Host is spawned with, and stopped with this process.
 *
 * The daemon is optional by design. No installation means `start()` reports the
 * absence and takes no other action, so the readiness report keeps the Metasploit
 * items blocked instead of the launch failing. A credential the operator exported
 * describes their own daemon, and it wins: the bundled one then stays off and nothing
 * is overwritten.
 */
export class DesktopMetasploit {
  private child: MetasploitChild | undefined
  private exited: Promise<void> | undefined
  private diagnostic = ''
  private spawnError: Error | undefined
  private active: MetasploitRpcEndpoint | undefined
  private stopping = false
  private exitHook: (() => void) | undefined

  /**
   * @param home - Metasploit Framework root, or `undefined` when none was detected.
   * @param environment - Environment the Host is spawned with; the daemon's values are installed here.
   * @param options - Test seams for the child factory, the probe, the port allocator and the deadlines.
   */
  constructor(
    private readonly home: string | undefined,
    private readonly environment: NodeJS.ProcessEnv,
    private readonly options: MetasploitOptions,
  ) {}

  /**
   * Start the daemon, or report that no bundled daemon should run.
   * @returns The loopback endpoint the runner will use, or `undefined` when the
   * daemon is suppressed by an operator-configured one or by an absent installation.
   * @throws DesktopMetasploitStartupError when the installation carries no recognized
   * launcher, no loopback port is free, the daemon exits, or it never accepts a connection.
   */
  async start(): Promise<MetasploitRpcEndpoint | undefined> {
    if (this.active !== undefined) return this.active
    if (isOperatorMsfConfigured(this.environment)) {
      // The person is driving their own daemon; the bundled one must not compete for it.
      console.info('desktop msfrpcd: the launch environment configures an msfrpcd, so the bundled daemon stays off')
      return undefined
    }
    if (this.home === undefined) {
      console.info('desktop msfrpcd: no Metasploit Framework installation was found, so the bundled daemon stays off')
      return undefined
    }

    const launch = msfrpcdLaunch(this.home, existsSync, this.options.platform ?? process.platform)
    if (launch === undefined) {
      throw new DesktopMetasploitStartupError(
        `desktop msfrpcd: ${this.home} carries no recognized msfrpcd launcher, so this installation cannot start `
        + 'the Metasploit bridge. Expected embedded/bin/ruby with embedded/framework/msfrpcd, bin/msfrpcd.bat, '
        + 'or bin/msfrpcd. Install Metasploit Framework there, or set REDTEAM_MSF_HOME to an installation that has it.',
      )
    }
    let port: number
    try {
      port = await (this.options.allocatePort ?? allocateLoopbackPort)(DEFAULT_MSFRPC_PORT)
    } catch {
      throw new DesktopMetasploitStartupError(
        `desktop msfrpcd: no free loopback port near ${String(DEFAULT_MSFRPC_PORT)}, so the daemon cannot start`,
      )
    }

    const password = generatedMsfrpcPassword()
    const childEnvironment = launch.kind === 'embeddedRuby'
      ? embeddedRubyEnvironment(launch.command, this.environment)
      : undefined
    const spawnChild = this.options.spawn
      ?? ((command: string, args: readonly string[], spawnOptions: SpawnOptions): MetasploitChild => spawn(command, args, spawnOptions))
    const child = spawnChild(launch.command, [
      // A framework script or a batch wrapper takes its own leading arguments.
      ...launch.args,
      '-U', MSFRPC_RPC_USER,
      '-P', password,
      '-a', MSFRPC_LOOPBACK,
      '-p', String(port),
      // msfrpcd's -S disables SSL on the RPC socket, which matches REDTEAM_MSFRPC_TLS=0:
      // the socket never leaves loopback, so Framework's self-signed certificate would
      // only add a trust problem to a channel that is already local.
      '-S',
      // -f keeps msfrpcd in the foreground. Without it the daemon forks and the process
      // this supervisor owns exits, leaving a daemon nobody terminates - the orphan this
      // child exists to prevent.
      '-f',
    ], {
      // msfrpcd resolves its libraries from the framework root it lives under.
      cwd: this.home,
      ...(childEnvironment === undefined ? {} : { env: childEnvironment }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    this.stopping = false
    this.diagnostic = ''
    this.spawnError = undefined
    const collect = (chunk: Buffer | string): void => {
      this.diagnostic = (this.diagnostic + chunk.toString()).slice(-MAX_DIAGNOSTIC_CHARS)
    }
    const collectFrom = (stream: NodeJS.ReadableStream | null): void => { stream?.on('data', collect) }
    collectFrom(child.stdout)
    collectFrom(child.stderr)
    // Node reports a spawn failure - a launcher that is not executable, a missing
    // dynamic library - as an error event instead of an exit; without a listener that
    // event would be thrown from the event loop and take the application down.
    child.on('error', (error) => {
      this.spawnError = error
      collect(error.message)
    })
    // A child is not terminated with its parent: an abrupt exit would otherwise leave
    // the daemon holding its port. The hook lives only while a child does.
    this.exitHook = () => { this.killNow() }
    process.once('exit', this.exitHook)
    this.exited = new Promise<void>((resolve) => {
      child.once('exit', (code, signal) => {
        if (!this.stopping && this.active !== undefined) {
          // A daemon that dies after readiness leaves the Metasploit items absent.
          console.error(`desktop msfrpcd: the Metasploit RPC daemon stopped after startup (exit ${String(code)}, signal ${String(signal)})`)
        }
        resolve()
      })
    })

    try {
      await this.awaitReady(child, port, password)
    } catch (error) {
      // A half-started daemon must never outlive the failure it caused.
      await this.stop().catch(() => undefined)
      throw error
    }
    this.active = { host: MSFRPC_LOOPBACK, port, user: MSFRPC_RPC_USER }
    // Only now do these describe a daemon that answers. The runner reads them while
    // cordis composes the profile, so an environment without them keeps the bridge
    // honestly reported as blocked.
    this.environment[MSFRPC_HOST_ENVIRONMENT_NAME] = MSFRPC_LOOPBACK
    this.environment[MSFRPC_PORT_ENVIRONMENT_NAME] = String(port)
    this.environment[MSFRPC_USER_ENVIRONMENT_NAME] = MSFRPC_RPC_USER
    this.environment[MSFRPC_PASS_ENVIRONMENT_NAME] = password
    this.environment[MSFRPC_TLS_ENVIRONMENT_NAME] = '0'
    console.info(`desktop msfrpcd: the bundled Metasploit RPC daemon is listening on ${MSFRPC_LOOPBACK}:${String(port)}`)
    return this.active
  }

  /**
   * Stop the daemon and release its port, escalating when it does not exit.
   * The published environment names are deleted before the child is signalled, so a
   * replacement Host is never pointed at a daemon that is already going away.
   * @returns Completion of child exit.
   * @throws Error when the child survives SIGKILL, because the port would stay held.
   */
  async stop(): Promise<void> {
    const child = this.child
    const active = this.active
    this.child = undefined
    this.active = undefined
    this.spawnError = undefined
    this.detachExitHook()
    if (active !== undefined) {
      // These five names described a daemon that no longer exists; leaving them behind
      // would point a replacement Host at a dead endpoint.
      for (const name of MSFRPC_ENVIRONMENT_NAMES) Reflect.deleteProperty(this.environment, name)
    }
    if (child === undefined) return
    this.stopping = true
    const exited = this.exited ?? Promise.resolve()
    const deadline = this.options.timeouts?.exitMs ?? MSF_EXIT_TIMEOUT_MS
    child.kill('SIGTERM')
    if (await settledWithin(exited, deadline)) return
    child.kill('SIGKILL')
    if (!await settledWithin(exited, deadline)) {
      throw new Error('desktop msfrpcd: the Metasploit RPC daemon did not exit after SIGKILL')
    }
  }

  /** Terminate the daemon without awaiting, for a process that is exiting without a next turn. */
  killNow(): void {
    const child = this.child
    const active = this.active
    this.child = undefined
    this.active = undefined
    this.spawnError = undefined
    this.detachExitHook()
    if (active !== undefined) {
      for (const name of MSFRPC_ENVIRONMENT_NAMES) Reflect.deleteProperty(this.environment, name)
    }
    child?.kill('SIGKILL')
  }

  /** Release the process exit hook, so a stopped daemon leaves no listener behind. */
  private detachExitHook(): void {
    if (this.exitHook === undefined) return
    process.removeListener('exit', this.exitHook)
    this.exitHook = undefined
  }

  /** Poll the daemon's loopback port until it accepts, its deadline passes, or it exits. */
  private async awaitReady(child: MetasploitChild, port: number, password: string): Promise<void> {
    const probe = this.options.probe ?? probeMsfrpcPort
    const ceiling = this.options.timeouts?.readyMs ?? MSF_READY_TIMEOUT_MS
    const deadline = Date.now() + ceiling
    for (;;) {
      if (await probe(MSFRPC_LOOPBACK, port)) return
      if (this.spawnError !== undefined) {
        throw this.failure(`msfrpcd could not be started: ${this.spawnError.message}`, [password])
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw this.failure(
          `msfrpcd exited with code ${String(child.exitCode)} before accepting connections on ${MSFRPC_LOOPBACK}:${String(port)}`,
          [password],
        )
      }
      if (Date.now() >= deadline) {
        throw this.failure(
          `msfrpcd did not accept connections on ${MSFRPC_LOOPBACK}:${String(port)} within ${String(ceiling)} ms`,
          [password],
        )
      }
      await pause(READY_POLL_INTERVAL_MS)
    }
  }

  /**
   * @param detail - What failed, phrased for an operator.
   * @param secrets - Values that must never appear in the message, redacted even if the child echoed them.
   * @returns The startup error, quoting the child's own last output because a dialog cannot show a log.
   */
  private failure(detail: string, secrets: readonly string[]): DesktopMetasploitStartupError {
    let tail = this.diagnostic.trim().replace(/\s+/gu, ' ').slice(-DIAGNOSTIC_IN_MESSAGE_CHARS)
    for (const secret of secrets) {
      if (secret !== '') tail = tail.split(secret).join(REDACTED)
    }
    return new DesktopMetasploitStartupError(`desktop msfrpcd: ${detail}${tail === '' ? '' : `: ${tail}`}`)
  }
}
