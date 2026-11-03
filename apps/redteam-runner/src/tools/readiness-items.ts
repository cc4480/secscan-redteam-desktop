/**
 * Readiness item types and probes — extracted from readiness.ts to keep the
 * readiness module under the 300-line budget. Never throws, never touches a target.
 */
import { execFileSync } from "node:child_process"
import { connect as netConnect } from "node:net"
import { describeSource, type ResolvedBinary } from "../toolchain.js"

export type ReadinessState = 'ready' | 'missing' | 'unreachable' | 'not-configured' | 'paused'

export interface ReadinessItem {
  /** Stable identifier used by the UI / tests. */
  id: string
  /** Human label. */
  label: string
  state: ReadinessState
  /** What was found, when relevant (path, version, endpoint). */
  detail?: string
  /** What to do when the state is not `ready`. */
  fix?: string
  /** Required items block an engagement; optional ones only degrade it. */
  required: boolean
}

export interface ReadinessReport {
  /** True when every required item is ready. */
  ok: boolean
  items: ReadinessItem[]
  /** Short human summary, e.g. "3 of 9 ready — 2 required missing". */
  summary: string
}

/** One version probe. Returns the first output line, or undefined when not runnable. */
export function probeBinary(bin: string, args: readonly string[]): string | undefined {
  try {
    const out = execFileSync(bin, [...args], { stdio: 'pipe', timeout: 8000, encoding: 'utf8' })
    return String(out).split('\n')[0]?.trim() || 'present'
  } catch {
    return undefined
  }
}

/** TCP reachability for the Metasploit RPC daemon (1s, no target traffic). */
export function probeTcp(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port })
    const done = (reachable: boolean): void => {
      socket.destroy()
      resolve(reachable)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * Detail line for a resolved binary: the path AND the source that picked it.
 * "Not found" is only actionable when the report says whether the operator's
 * env, the bundled tools directory or PATH was tried.
 */
export function resolvedDetail(resolved: ResolvedBinary, present: boolean): string {
  return `${resolved.path} [from ${describeSource(resolved)}]${present ? '' : ' -- not found'}`
}
