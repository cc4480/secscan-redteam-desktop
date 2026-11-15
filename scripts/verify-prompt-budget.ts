/**
 * Prompt-payload budget gate.
 *
 * The lean route's prompt payload is a file the model reads on every request, so
 * its size is a cost paid on every turn of a 4K-class local model. The budget is
 * stated in tokens; this gate measures BYTES, which is exact, and converts with the
 * conservative four-bytes-per-token planning constant so that a payload passing the
 * ceiling has not quietly become larger than the number the budget names.
 *
 * What is measured: the profile payload files the standalone trees actually read —
 * the lean profile the tight route returns, and the fuller core profile the roomier
 * route returns. The comment header of each file is not sent to the model, so the
 * measurement strips it before counting.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Token ceiling for the lean profile. */
export const LEAN_PROMPT_TOKEN_BUDGET = 1200

/** Conservative bytes-per-token planning constant used to convert the ceiling. */
export const BYTES_PER_TOKEN = 4

/** Byte ceiling derived from the token budget. */
export const LEAN_PROMPT_BYTE_BUDGET = LEAN_PROMPT_TOKEN_BUDGET * BYTES_PER_TOKEN

/** Where the standalone profile payload lives, relative to the repository root. */
const PROFILE_DIRECTORY = join('packages', 'redteam', 'harness-plugin', 'local-profile')

/** The lean profile: what the tight route returns instead of the full doctrine. */
const LEAN_PROFILE_FILE = 'tight.md'

/** Core payload files the fuller route composes. */
const CORE_PROFILE_FILES = ['core/IDENTITY.md', 'core/SOUL.md', 'core/TOOLS.md', 'core/USER.md', 'core/PROACTIVE_PREFERENCES.md']

/** One measured payload. */
export interface PromptPayload {
  /** File path relative to the repository root. */
  readonly file: string
  /** Payload bytes after the comment header is stripped. */
  readonly bytes: number
  /** Whole bytes divided by {@link BYTES_PER_TOKEN}, rounded up. */
  readonly tokens: number
}

/**
 * Strip a leading HTML comment block, which documents the file for maintainers and
 * is not part of what the model reads.
 * @param text - the raw file contents.
 * @returns the payload the model would see.
 */
export function payloadOf(text: string): string {
  const withoutHeader = text.replace(/^\s*<!--[\s\S]*?-->\s*/, '')
  return withoutHeader.trim()
}

/**
 * Render a path the way the gate reports it: repository-relative, '/'-separated,
 * so the same file reads the same on every platform.
 * @param path - a path built with the platform separator.
 * @returns the '/'-separated form.
 */
export function toRepositoryPath(path: string): string {
  return path.split(process.platform === 'win32' ? '\\' : path.includes('\\') ? '\\' : '/').join('/')
}

/**
 * Measure one payload file.
 * @param root - repository root.
 * @param relative - path relative to the profile directory.
 * @returns the measured payload.
 */
function measure(root: string, relative: string): PromptPayload {
  const path = join(root, PROFILE_DIRECTORY, relative)
  const bytes = Buffer.byteLength(payloadOf(readFileSync(path, 'utf8')), 'utf8')
  // Repository-relative paths are reported with '/' on every platform, so a
  // reader, and a log diff, sees one form regardless of the host.
  const display = toRepositoryPath(join(PROFILE_DIRECTORY, relative))
  return { file: display, bytes, tokens: Math.ceil(bytes / BYTES_PER_TOKEN) }
}

/**
 * Measure every payload that reaches a model through the standalone profile.
 * @param root - repository root; defaults to the checkout this script lives in.
 * @returns the lean profile first, then the core payload files.
 */
export function measurePromptPayloads(root: string): PromptPayload[] {
  return [measure(root, LEAN_PROFILE_FILE), ...CORE_PROFILE_FILES.map(file => measure(root, file))]
}

/**
 * Report the measurement and the budget verdict.
 * @param payloads - measured payloads, lean profile first.
 * @returns the lean profile's result.
 */
export function reportPromptBudget(payloads: readonly PromptPayload[]): { lean: PromptPayload; ok: boolean } {
  const lean = payloads[0]
  if (lean === undefined) throw new Error('prompt budget: the lean profile was not measured')
  for (const payload of payloads) {
    const marker = payload === lean ? 'lean' : 'core'
    console.log(`verify-prompt-budget: ${marker.padEnd(4)} ${String(payload.bytes).padStart(6)} B  ~${String(payload.tokens).padStart(5)} tok  ${payload.file}`)
  }
  const ok = lean.bytes <= LEAN_PROMPT_BYTE_BUDGET
  console.log(
    ok
      ? `verify-prompt-budget: OK — the lean profile is ${lean.bytes} B (~${lean.tokens} tok), within ${LEAN_PROMPT_TOKEN_BUDGET} tok (${LEAN_PROMPT_BYTE_BUDGET} B).`
      : `verify-prompt-budget: OVER — the lean profile is ${lean.bytes} B (~${lean.tokens} tok), above ${LEAN_PROMPT_TOKEN_BUDGET} tok (${LEAN_PROMPT_BYTE_BUDGET} B) by ${lean.bytes - LEAN_PROMPT_BYTE_BUDGET} B.`,
  )
  return { lean, ok }
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { ok } = reportPromptBudget(measurePromptPayloads(root))
  if (!ok) process.exitCode = 1
}
