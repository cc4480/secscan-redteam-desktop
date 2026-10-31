/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { Transport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './index.ts'

/**
 * Resolve named secrets from this process's environment for one child spawn.
 * @param names - env names declared by config `secretEnv`.
 * @returns the values found, keyed by name, and the names that were unset or empty.
 */
export function resolveSecretEnv(names: readonly string[]): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {}
  const missing: string[] = []
  for (const name of names) {
    const value = process.env[name]
    if (value === undefined || value === '') missing.push(name)
    else values[name] = value
  }
  return { values, missing }
}

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env, plus the values the
 * config's `secretEnv` names resolve to. The resolved secrets merge last:
 * the scrub drops credential-shaped names by design, so a named secret is
 * the deliberate supply that survives it, and it wins over a same-named
 * literal in `env`. The MCP SDK owns the actual spawn, so this transport
 * shares the scrub definition rather than the spawn path.
 */
function buildChildEnv(extra: Record<string, string>, secretEnv: readonly string[]): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra, ...resolveSecretEnv(secretEnv).values }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env, config.secretEnv),
        cwd: config.cwd,
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers } },
      )
  }
}
