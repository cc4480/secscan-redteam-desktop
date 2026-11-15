/** Installed-bundle smoke: install the packed tarballs outside the workspace and probe them. */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ReleaseBundle } from './publish-npm-baseline-bundle.ts'
import type { CommandRunner } from './publish-npm-baseline-command.ts'
import {
  commandFailure,
  installedArtifactEnvironment,
  npmClientEnvironment,
} from './publish-npm-baseline-command.ts'

const POSIX_WEB_PROBE = String.raw`
import errno, os, pty, select, signal, sys, time
node, bin_path, cwd, timeout_seconds = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(node, [node, bin_path, "web", "--no-open", "--host", "127.0.0.1", "--port", "0"], os.environ.copy())

output = bytearray()
ready_seen = False
termination_sent = False
deadline = time.monotonic() + float(timeout_seconds)
status = None
while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        if chunk:
            output.extend(chunk)

    snapshot = bytes(output)
    if not termination_sent and b"dsh web: http://127.0.0.1:" in snapshot:
        ready_seen = True
        os.kill(pid, signal.SIGTERM)
        termination_sent = True

    waited, candidate = os.waitpid(pid, os.WNOHANG)
    if waited == pid:
        status = candidate
        break

if status is None:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
if not ready_seen:
    sys.stderr.write("installed dsh web did not reach its ready URL\n")
    sys.exit(124)
actual_exit = os.waitstatus_to_exitcode(status)
if actual_exit != 0:
    sys.stderr.write(f"installed dsh web exited {actual_exit}, expected 0\n")
    sys.exit(125)
`

/**
 * Confirm a path resolves inside the isolated consumer directory.
 * @param root - the consumer root the path must stay under.
 * @param path - the path to check.
 * @param label - the description used in the error.
 */
function assertPathWithin(root: string, path: string, label: string): void {
  const rootPath = realpathSync.native(root)
  const candidate = realpathSync.native(path)
  const fromRoot = relative(rootPath, candidate)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} resolved outside the isolated consumer: ${candidate}`)
  }
}

/** Installs one complete bundle outside the workspace and probes the shipped dsh entry. */
export class InstalledBundleSmoke {
  constructor(
    private readonly bundle: ReleaseBundle,
    private readonly runner: CommandRunner,
  ) {}

  /** Install the bundle into a fresh consumer and probe its CLI and Web startup. */
  run(): void {
    const consumerRoot = mkdtempSync(join(tmpdir(), 'dsh-npm-consumer-'))
    try {
      const dependencies = Object.fromEntries(this.bundle.manifest.packages.map(pkg => [
        pkg.name,
        pathToFileURL(this.bundle.tarballPath(pkg)).href,
      ]))
      writeFileSync(resolve(consumerRoot, 'package.json'), `${JSON.stringify({
        name: 'dsh-npm-baseline-consumer',
        version: '0.0.0',
        private: true,
        dependencies,
      }, null, 2)}\n`)

      console.log(
        `publish-npm-baseline: installing ${this.bundle.manifest.packages.length} local tarballs`,
      )
      this.runner.run('npm', [
        'install',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        `--registry=${this.bundle.manifest.registry}`,
      ], consumerRoot, npmClientEnvironment())

      const bin = resolve(consumerRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
      assertPathWithin(consumerRoot, bin, 'installed dsh bin')
      const environment = installedArtifactEnvironment(consumerRoot)
      const version = this.runner.capture(
        process.execPath,
        [bin, '--version'],
        consumerRoot,
        environment,
      )
      if (version !== this.bundle.manifest.version) {
        throw new Error(
          `installed dsh --version returned ${JSON.stringify(version)}; `
          + `expected ${this.bundle.manifest.version}`,
        )
      }
      this.probeWeb(bin, consumerRoot, environment)
      console.log('publish-npm-baseline: installed dsh entry and Web startup probes passed')
    } finally {
      rmSync(consumerRoot, { recursive: true, force: true })
    }
  }

  private probeWeb(bin: string, consumerRoot: string, environment: NodeJS.ProcessEnv): void {
    if (process.platform === 'win32') {
      throw new Error('installed dsh Web probe requires a POSIX host with python3')
    }
    const result = this.runner.result(
      'python3',
      ['-c', POSIX_WEB_PROBE, process.execPath, bin, consumerRoot, '60'],
      consumerRoot,
      environment,
    )
    if (result.status !== 0) {
      throw commandFailure('python3', ['installed-dsh-web-probe'], result)
    }
  }
}
