/**
 * Compact local-model prompt profile for the `local` provider route.
 *
 * A downloaded GGUF answers inside the operator's own llama-server window
 * (32,768 tokens is the shipped Local Models default), which cannot host the
 * full deployment prompt plus the skill catalog plus the conversation. This
 * module assembles the small profile authored in `local-prompt-profile/`:
 * the operating rules verbatim, the core identity/preference files, and the
 * Layer-1 tool stub index, in the documented order. Every other route keeps
 * the full deployment prompt.
 *
 * @module @secscan/redteam-harness-plugin/local-profile
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'

/** Environment override naming the profile directory directly. */
const PROFILE_DIR_ENV = 'SECSCAN_LOCAL_PROFILE_DIR'

/** Files that ride in this order, per `PROFILE.md`'s assembly order. */
const PROFILE_FILES = [
  'core/AGENTS.md',
  'core/SOUL.md',
  'core/IDENTITY.md',
  'core/USER.md',
  'core/TOOLS.md',
  'core/PROACTIVE_PREFERENCES.md',
  'tool-index.md',
] as const

/** Directory candidates for the authored profile, nearest first. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** Assembled text per resolved directory, so one session prices the reads once. */
const assembled = new Map<string, string>()

/** Parsed index names per resolved directory. */
const indexed = new Map<string, Set<string>>()

/**
 * Candidate profile directories, nearest first: the operator's override, the
 * packaged copy inside this plugin, then the repository root for source runs.
 * @returns absolute directory candidates in precedence order.
 */
export function localProfileDirs(): string[] {
  const configured = process.env[PROFILE_DIR_ENV]?.trim()
  const candidates = [
    ...configured === undefined || configured === '' ? [] : [configured],
    // The packaged plugin (`lib/`) and a compiled test tree (`dist-test/src/`)
    // sit one and two directories below the package root.
    join(MODULE_DIR, '..', 'local-profile'),
    join(MODULE_DIR, '..', '..', 'local-profile'),
    join(MODULE_DIR, '..', '..', '..', '..', 'local-prompt-profile'),
    join(process.cwd(), 'local-prompt-profile'),
  ]
  return candidates
}

/**
 * Resolve the first candidate holding every profile file.
 * @returns the usable directory, or undefined when none is complete.
 */
export function resolveLocalProfileDir(): string | undefined {
  for (const directory of localProfileDirs()) {
    if (PROFILE_FILES.every(file => existsSync(join(directory, file)))) return directory
  }
  return undefined
}

/**
 * Provider route an assembly belongs to: the durable routed header first, then
 * the agent's own options, matching the agent loop's own resolution order.
 * @param agent - agent being assembled, when the caller supplied one.
 * @returns the provider route, or undefined before one is known.
 */
function providerOf(agent: Agent | undefined): string | undefined {
  if (agent === undefined) return undefined
  const routed = agent.session.requestHeader()?.config.provider
  if (routed !== undefined && routed.length > 0) return routed
  const configured = agent.options.provider
  return configured !== undefined && configured.length > 0 ? configured : undefined
}

/**
 * Whether this assembly belongs to the local provider route.
 * @param context - assembly context the loop supplies for one request.
 * @returns true when the routed or configured provider is `local`.
 */
export function isLocalAssembly(context: AssembleContext): boolean {
  return providerOf(context.agent) === 'local'
}

/**
 * Assemble the compact profile text for one directory.
 * @param directory - resolved profile directory.
 * @returns the concatenated sections, separated by blank lines.
 */
function readProfile(directory: string): string {
  const cached = assembled.get(directory)
  if (cached !== undefined) return cached
  const text = PROFILE_FILES
    .map(file => readFileSync(join(directory, file), 'utf8').trim())
    .filter(section => section.length > 0)
    .join('\n\n')
  assembled.set(directory, text)
  return text
}

/**
 * The compact local prompt, or undefined when no complete profile is
 * installed — the caller then keeps the full deployment prompt rather than
 * sending a deployment with no operating rules at all.
 * @returns the profile text, or undefined when the profile is absent.
 */
export function localProfileText(): string | undefined {
  const directory = resolveLocalProfileDir()
  return directory === undefined ? undefined : readProfile(directory)
}

/**
 * Tool names the shipped stub index lists, parsed from its rendered entries.
 * The index is the deferral manifest: a tool it documents is exactly a tool the
 * local route declines to pay for, so the two cannot drift apart.
 * @param directory - resolved profile directory.
 * @returns the listed tool names, unprefixed as the index writes them.
 */
function readIndexedToolNames(directory: string): Set<string> {
  const cached = indexed.get(directory)
  if (cached !== undefined) return cached
  const text = readFileSync(join(directory, 'tool-index.md'), 'utf8')
  const names = new Set<string>()
  for (const match of text.matchAll(/^-\s+`([a-z0-9_]+)`/gm)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  indexed.set(directory, names)
  return names
}

/**
 * Tool names the local route defers, or undefined when no profile is installed.
 * @returns the indexed names, or undefined when the profile is absent.
 */
export function deferredToolNames(): ReadonlySet<string> | undefined {
  const directory = resolveLocalProfileDir()
  return directory === undefined ? undefined : readIndexedToolNames(directory)
}

/**
 * Whether one schema belongs to a deferred tool. Schemas arrive namespaced by
 * MCP server (`mcp__alterego__doctor`), while the index writes the bare tool
 * name, so the comparison uses the last namespace segment.
 * @param schemaName - tool name as the assembly sees it.
 * @param deferred - names the index lists.
 * @returns true when any namespace segment matches an indexed name.
 */
export function isDeferredTool(schemaName: string, deferred: ReadonlySet<string>): boolean {
  const separator = schemaName.lastIndexOf('__')
  const bare = separator === -1 ? schemaName : schemaName.slice(separator + 2)
  return deferred.has(schemaName) || deferred.has(bare)
}
