import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'

/**
 * Resolve the Python interpreter command.
 *
 * @param configured - an explicit command from a CLI flag, if any
 * @returns the configured command, else FOUNDRY_PYTHON, else "python3"
 */
export function resolvePython(configured?: string): string {
  return configured ?? process.env.FOUNDRY_PYTHON ?? 'python3'
}

/**
 * Reserve an ephemeral loopback port and release it for the child process.
 *
 * @returns a currently free TCP port on 127.0.0.1
 */
export async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

/**
 * Stop a child process: SIGTERM first, SIGKILL after a grace period.
 *
 * @param proc - the child process to stop
 * @returns a promise that settles once the process has exited
 */
export async function stopProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  const exited = new Promise<void>(resolve => proc.once('exit', () => resolve()))
  proc.kill('SIGTERM')
  const grace = new Promise<void>(resolve => setTimeout(resolve, 3000))
  await Promise.race([exited, grace])
  if (proc.exitCode === null && proc.signalCode === null) {
    proc.kill('SIGKILL')
    await exited
  }
}

/** A booted bundle app variant. */
export interface BootedApp {
  proc: ChildProcess
  port: number
  base: string
}

/**
 * Boot one bundle app variant on an ephemeral loopback port and wait until
 * it answers HTTP 200 on `/`. The child is owned by the caller, who must
 * stop it with {@link stopProcess}.
 *
 * @param python - the Python interpreter command
 * @param dir - the bundle directory
 * @param variant - "vuln" or "patched"
 * @returns the running process, its port, and its base URL
 */
export async function bootApp(python: string, dir: string, variant: 'vuln' | 'patched'): Promise<BootedApp> {
  const port = await freePort()
  const proc = spawn(python, [join(dir, variant, 'app.py')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  proc.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000) })
  const ready = await waitReady(port, proc)
  if (!ready) {
    await stopProcess(proc)
    throw new Error(`${variant} app never became ready on port ${port}: ${stderr.trim().slice(-300)}`)
  }
  return { proc, port, base: `http://127.0.0.1:${port}` }
}

/**
 * Poll a booted app until it answers HTTP 200 on `/` or exits.
 *
 * @param port - the port the app listens on
 * @param proc - the app process, watched for early exit
 * @param timeoutMs - readiness deadline, 10s by default
 * @returns true when the app answered 200 before the deadline
 */
export async function waitReady(port: number, proc: ChildProcess, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) return false
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
      await resp.text()
      if (resp.status === 200) return true
    } catch {
      // not up yet; keep polling
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  return false
}

/**
 * Run a bundle's probe.py against a booted variant, as the ceiling layer does.
 *
 * @param python - the Python interpreter command
 * @param dir - the bundle directory
 * @param port - the port of the variant under test
 * @returns the probe's exit code (0 = marker observed), or -1 when it was killed
 */
export async function runProbe(python: string, dir: string, port: number): Promise<number> {
  const proc = spawn(python, [join(dir, 'probe.py')], {
    env: { ...process.env, BASE_URL: `http://127.0.0.1:${port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout?.resume()
  proc.stderr?.resume()
  return await new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      resolve(-1)
    }, 30_000)
    proc.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code ?? -1)
    })
    proc.once('error', () => {
      clearTimeout(timer)
      resolve(-1)
    })
  })
}
