/** Session corpus discovery and canonical directory naming for the one-time V4 migration. */

import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { encodeSegment, parseGenerationLogFilename, type JsonlCompression } from '../packages/session/session-persistence-jsonl/src/format.ts'

/** One discovered input: a Session directory, or an entry whose layout is unsupported. */
export interface Candidate {
  readonly directory: string
  readonly source?: { readonly filename: string; readonly version: number; readonly compression: JsonlCompression; readonly bytes: number }
  readonly error?: unknown
}

/**
 * Inspect one Session directory and select its newest generation log.
 * @param directory - absolute Session directory path.
 * @returns the directory with its selected source, or the inspection error.
 */
export async function inspectDirectory(directory: string): Promise<Candidate> {
  try {
    const entries = await readdir(directory)
    const generations = entries.flatMap(filename => (['none', 'zstd'] as const).flatMap((compression) => {
      const version = parseGenerationLogFilename(filename, compression)
      return version === undefined ? [] : [{ filename, version, compression }]
    })).sort((left, right) => right.version - left.version || left.filename.localeCompare(right.filename))
    const selected = generations[0]
    if (selected === undefined) return { directory }
    const metadata = await stat(join(directory, selected.filename))
    return { directory, source: { ...selected, bytes: metadata.size } }
  } catch (error: unknown) {
    return { directory, error }
  }
}

/**
 * Enumerate every Session directory under one root, rejecting unsupported layouts and links.
 * @param root - absolute Session root path.
 * @returns discovered inputs in project-then-Session name order.
 */
export async function discover(root: string): Promise<Candidate[]> {
  const candidates: Candidate[] = []
  const projects = await readdir(root, { withFileTypes: true })
  for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = join(root, project.name)
    if (project.isSymbolicLink()) {
      candidates.push({ directory, error: new Error('project symbolic links are not traversed') })
      continue
    }
    if (!project.isDirectory()) {
      if (project.name.endsWith('.jsonl') || project.name.endsWith('.jsonl.zstd')) {
        candidates.push({ directory, error: new Error('unsupported flat-file layout; expected project/session/generation') })
      }
      continue
    }
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(directory, entry.name)
        if (entry.isSymbolicLink()) candidates.push({ directory: path, error: new Error('Session symbolic links are not traversed') })
        else if (entry.isDirectory()) candidates.push(await inspectDirectory(path))
        else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.jsonl.zstd')) {
          candidates.push({ directory: path, error: new Error('unsupported flat-file layout; expected project/session/generation') })
        }
      }
    } catch (error: unknown) {
      candidates.push({ directory, error })
    }
  }
  return candidates
}

/**
 * Decode the Session id a directory name encodes, refusing noncanonical names.
 * @param directory - absolute Session directory path.
 * @returns the decoded Session id.
 */
export function directoryId(directory: string): SessionId {
  const segment = basename(directory)
  const id = segment.replace(/~([0-9A-F]{4})/gu, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  if (encodeSegment(id) !== segment) throw new Error(`noncanonical Session directory name ${JSON.stringify(segment)}`)
  return SessionId(id)
}
