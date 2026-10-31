/**
 * Hugging Face Hub client for the bundled local-model feature.
 *
 * Three operations, all transport-injectable so a test never reaches the network:
 * list a repository's files, build the resolve URL for one file, and download it to
 * disk with resume support. This module never logs: the token is only ever written
 * as an `Authorization: Bearer` header, and a failure message carries neither the
 * token nor a URL's query string.
 */

import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FileHandle } from 'node:fs/promises'
import type { LlamaDownloadProgress, LlamaRepoFile } from './llama-api.ts'

/** Origin every Hub request is built from. */
const HUGGING_FACE_ORIGIN = 'https://huggingface.co'

/** Repository listing endpoint, relative to {@link HUGGING_FACE_ORIGIN}. */
const REPO_API_PATH = '/api/models'

/** Model files the manager offers. */
const GGUF_FILE_PATTERN = /\.gguf$/iu

/** Minimum gap between progress callbacks, about four events per second. */
const PROGRESS_INTERVAL_MS = 250

/** Hub identifiers: exactly one owner segment and one repository segment. */
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u

/** Progress emitted while bytes land; the manager maps it into a `LlamaDownloadProgress`. */
export type HuggingFaceDownloadProgress = Pick<LlamaDownloadProgress, 'receivedBytes' | 'totalBytes'>

/** One parsed `Content-Range` response header. */
interface PartialRange {
  readonly start: number
  readonly end: number
  readonly total?: number
}

/** Options for {@link listRepoFiles}. */
export interface ListRepoFilesOptions {
  /** Hub repository, e.g. `mradermacher/Huihui-Qwen3.8-27B-abliterated-GGUF`. */
  readonly repo: string
  /** Hub token for gated repositories; sent only as a Bearer header. */
  readonly token?: string
  /** Overrides the transport; a test supplies its own. */
  readonly fetch?: typeof fetch
}

/** Options for {@link resolveFileUrl}. */
export interface ResolveFileUrlOptions {
  /** Hub repository in owner/name form. */
  readonly repo: string
  /** File path inside the repository. */
  readonly file: string
}

/** Options for {@link downloadFile}. */
export interface DownloadFileOptions {
  /** Fully resolved Hub URL, typically from {@link resolveFileUrl}. */
  readonly url: string
  /** Final path; bytes land in `<destination>.part` until the download verifies. */
  readonly destination: string
  /** Hub token; sent only as an `Authorization: Bearer` header. */
  readonly token?: string
  /** Called with byte counts, throttled to about four events per second. */
  readonly onProgress?: (progress: HuggingFaceDownloadProgress) => void
  /** Aborts the transfer; the part file is kept so a later call resumes. */
  readonly signal?: AbortSignal
  /** Overrides the transport; a test supplies its own. */
  readonly fetch?: typeof fetch
}

/** Result of one completed download. */
export interface DownloadFileResult {
  /** Bytes written to `destination`. */
  readonly sizeBytes: number
}

/** Cancellation raised when the caller's `AbortSignal` stopped a download; the part file survives. */
export class DownloadCancelledError extends Error {
  /** Builds the one cancellation error every aborted call reports. */
  constructor() {
    super('the model download was cancelled')
    this.name = 'DownloadCancelledError'
  }
}

/**
 * @param value - a byte count read from JSON.
 * @returns the count when it is a non-negative safe integer, otherwise `undefined`.
 */
function byteCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * @param value - a `Content-Length` response header.
 * @returns the declared byte count when it is a non-negative safe integer.
 */
function declaredByteCount(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value.trim())) return undefined
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

/**
 * @param value - any decoded JSON value.
 * @returns whether the value is a plain JSON object.
 */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param repo - operator-supplied Hub identifier.
 * @returns the identifier when it is exactly `owner/name`.
 * @throws Error naming the accepted shape; the rejected text is not echoed, so a
 *   value pasted into the wrong field cannot be logged as though it were a token.
 */
function repoIdentifier(repo: string): string {
  if (!REPO_PATTERN.test(repo)) throw new Error('the Hugging Face repository must be in owner/name form')
  return repo
}

/**
 * @param file - file path inside the repository.
 * @returns the path with each segment percent-encoded and the separators kept.
 * @throws Error when the path is absolute or climbs out of the repository.
 */
function repositoryFilePath(file: string): string {
  const segments = file.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('the Hugging Face file must be a relative path inside the repository')
  }
  return segments.map(segment => encodeURIComponent(segment)).join('/')
}

/**
 * @param token - optional Hub token.
 * @returns request headers carrying the token as a Bearer credential; an empty token is omitted.
 */
function authorizationHeaders(token: string | undefined): Headers {
  const headers = new Headers()
  if (token !== undefined && token !== '') headers.set('authorization', `Bearer ${token}`)
  return headers
}

/**
 * Read one repository-listing reply.
 * @param fetchImpl - transport.
 * @param url - fully built Hub API URL; never echoed in a failure.
 * @param token - optional Hub token.
 * @returns the decoded JSON value.
 * @throws Error for transport, auth, missing-repository, other-status and JSON failures.
 */
async function requestListingJson(fetchImpl: typeof fetch, url: string, token: string | undefined): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers: authorizationHeaders(token) })
  } catch {
    throw new Error('the Hugging Face repository listing could not be read')
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Hugging Face could not read this repository (HTTP ${String(response.status)}): check the owner/name spelling (a repo is "owner/name", never a file name); set HF_TOKEN only if the repo is gated`,
    )
  }
  if (response.status === 404) throw new Error('Hugging Face repo not found')
  if (!response.ok) throw new Error(`Hugging Face repository listing failed (HTTP ${String(response.status)})`)
  try {
    return await response.json()
  } catch {
    throw new Error('Hugging Face returned an unreadable repository listing')
  }
}

/**
 * Read byte sizes from the repository tree API, best effort.
 *
 * The tree endpoint is one extra request that repeats an expensive listing, so it is
 * only consulted when the main reply omitted sizes and any failure simply leaves the
 * sizes unknown.
 *
 * @param fetchImpl - transport.
 * @param repo - validated repository identifier.
 * @param token - optional Hub token.
 * @returns path-to-size entries, or `undefined` when the tree could not be read.
 */
async function repositoryTreeSizes(
  fetchImpl: typeof fetch,
  repo: string,
  token: string | undefined,
): Promise<Map<string, number> | undefined> {
  try {
    const response = await fetchImpl(
      `${HUGGING_FACE_ORIGIN}${REPO_API_PATH}/${repo}/tree/main`,
      { headers: authorizationHeaders(token) },
    )
    if (!response.ok) return undefined
    const parsed: unknown = await response.json()
    if (!Array.isArray(parsed)) return undefined
    const sizes = new Map<string, number>()
    for (const entry of parsed) {
      if (!record(entry)) continue
      const path = entry.path
      const size = byteCount(entry.size)
      if (typeof path === 'string' && size !== undefined) sizes.set(path, size)
    }
    return sizes
  } catch {
    return undefined
  }
}

/**
 * @param left - one repository file.
 * @param right - another repository file.
 * @returns an ascending-size order; entries without a known size follow, ordered by name.
 */
function compareBySize(left: LlamaRepoFile, right: LlamaRepoFile): number {
  if (left.sizeBytes !== undefined && right.sizeBytes !== undefined) return left.sizeBytes - right.sizeBytes
  if (left.sizeBytes !== undefined) return -1
  if (right.sizeBytes !== undefined) return 1
  if (left.file === right.file) return 0
  return left.file < right.file ? -1 : 1
}

/**
 * @param header - `Content-Range` response header.
 * @param expectedStart - byte offset the requested range had to start at.
 * @returns the parsed range when it matches the requested resume point.
 */
function partialRange(header: string | null, expectedStart: number): PartialRange | undefined {
  if (header === null) return undefined
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(header.trim())
  if (match === null) return undefined
  const start = Number(match[1])
  const end = Number(match[2])
  const totalText = match[3]
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start !== expectedStart || end < start) {
    return undefined
  }
  if (totalText === undefined || totalText === '*') return { start, end }
  const total = Number(totalText)
  if (!Number.isSafeInteger(total) || total <= end) return undefined
  return { start, end, total }
}

/**
 * @param partPath - retained part file.
 * @returns the bytes already landed, or zero when there is nothing to resume.
 */
async function retainedBytes(partPath: string): Promise<number> {
  try {
    const retained = await stat(partPath)
    return retained.isFile() ? retained.size : 0
  } catch {
    return 0
  }
}

/**
 * @param partPath - retained part file.
 * @returns after the part file is gone; removal is best effort.
 */
async function discardPart(partPath: string): Promise<void> {
  try {
    await unlink(partPath)
  } catch {
    // The part file was already gone, or removal failed; the caller reports the real failure.
  }
}

/**
 * @param handle - part file handle the download may still hold.
 * @returns after the handle is closed; an already-closed handle is tolerated.
 */
async function closeQuietly(handle: FileHandle): Promise<void> {
  try {
    await handle.close()
  } catch {
    // Closing an already-closed or broken handle changes nothing for the caller.
  }
}

/**
 * List the files a Hub repository offers.
 *
 * The listing comes from `GET /api/models/<repo>`; when that reply omits a size, the
 * tree API is read once, best effort, so files sort by size when the Hub reports one.
 * A tree failure never fails the listing.
 *
 * @param options - repository, optional token, optional transport.
 * @returns every sibling, with `isGguf` set and sized entries first in ascending size order.
 * @throws Error for a malformed repo, a refused or absent repository, or an unreadable reply.
 */
export async function listRepoFiles(options: ListRepoFilesOptions): Promise<LlamaRepoFile[]> {
  const repo = repoIdentifier(options.repo)
  const fetchImpl = options.fetch ?? globalThis.fetch
  const listing = await requestListingJson(fetchImpl, `${HUGGING_FACE_ORIGIN}${REPO_API_PATH}/${repo}`, options.token)
  if (!record(listing) || !Array.isArray(listing.siblings)) {
    throw new Error('Hugging Face returned an unexpected repository listing')
  }
  let files: LlamaRepoFile[] = []
  for (const entry of listing.siblings) {
    if (!record(entry) || typeof entry.rfilename !== 'string' || entry.rfilename === '') {
      throw new Error('Hugging Face returned an unexpected repository listing')
    }
    const size = byteCount(entry.size)
    files.push({
      file: entry.rfilename,
      isGguf: GGUF_FILE_PATTERN.test(entry.rfilename),
      ...size === undefined ? {} : { sizeBytes: size },
    })
  }
  if (files.some(file => file.sizeBytes === undefined)) {
    const sizes = await repositoryTreeSizes(fetchImpl, repo, options.token)
    if (sizes !== undefined) {
      files = files.map((file) => {
        if (file.sizeBytes !== undefined) return file
        const size = sizes.get(file.file)
        return size === undefined ? file : { ...file, sizeBytes: size }
      })
    }
  }
  return files.sort(compareBySize)
}

/**
 * Build the direct download URL of one repository file.
 * @param options - repository and file path.
 * @returns `https://huggingface.co/<repo>/resolve/main/<file>` with encoded path segments.
 * @throws Error for a malformed repo or a file path outside the repository.
 */
export function resolveFileUrl(options: ResolveFileUrlOptions): string {
  const repo = repoIdentifier(options.repo)
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
  return `${HUGGING_FACE_ORIGIN}/${repo}/resolve/main/${repositoryFilePath(options.file)}`
}

/**
 * Download one Hub file to `destination`, resuming a retained `<destination>.part`.
 *
 * Bytes stream into `destination.part`; the file is synced and renamed into place only
 * after the size verifies. An existing part file adds a `Range` request from its length;
 * a `206` reply appends, while a `200` reply (the server ignored the range) restarts the
 * file from zero. Progress fires at most about four times per second, plus once at the end.
 *
 * Cancellation through `signal` keeps the part file, so the next call resumes from the
 * bytes that landed. Every other failure removes the part file, so a retry never resumes
 * into bytes from a failed transfer.
 *
 * @param options - URL, destination, optional token, progress listener, signal and transport.
 * @returns the number of bytes now in `destination`.
 * @throws DownloadCancelledError when the caller aborted, Error for any other failure.
 */
export async function downloadFile(options: DownloadFileOptions): Promise<DownloadFileResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const partPath = `${options.destination}.part`
  await mkdir(dirname(options.destination), { recursive: true })
  const retained = await retainedBytes(partPath)
  const headers = authorizationHeaders(options.token)
  if (retained > 0) headers.set('range', `bytes=${String(retained)}-`)

  let response: Response
  try {
    response = await fetchImpl(options.url, {
      headers,
      ...options.signal === undefined ? {} : { signal: options.signal },
    })
  } catch {
    if (options.signal?.aborted === true) throw new DownloadCancelledError()
    await discardPart(partPath)
    throw new Error('the Hugging Face download could not be started')
  }

  const status = response.status
  if (status !== 200 && status !== 206) {
    await discardPart(partPath)
    if (status === 401 || status === 403) {
      throw new Error(
        `Hugging Face could not download this file (HTTP ${String(status)}): check the repository spelling and public access; set HF_TOKEN only if the repo is gated`,
      )
    }
    if (status === 404) throw new Error('Hugging Face file not found')
    throw new Error(`Hugging Face download failed (HTTP ${String(status)})`)
  }

  const remaining = status === 206 ? partialRange(response.headers.get('content-range'), retained) : undefined
  if (status === 206 && remaining === undefined) {
    await discardPart(partPath)
    throw new Error('Hugging Face returned a partial download this client cannot resume')
  }
  const startOffset = remaining === undefined ? 0 : remaining.start
  const totalBytes = remaining === undefined
    ? declaredByteCount(response.headers.get('content-length'))
    : remaining.total ?? remaining.end + 1

  const body = response.body
  if (body === null) {
    await discardPart(partPath)
    throw new Error('the Hugging Face download returned no content')
  }

  const handle = await open(partPath, startOffset > 0 ? 'a' : 'w')
  let receivedBytes = startOffset
  let emittedAt = 0
  const emit = (): void => {
    emittedAt = Date.now()
    options.onProgress?.({
      receivedBytes,
      ...totalBytes === undefined ? {} : { totalBytes },
    })
  }

  const reader = body.getReader()
  try {
    emit()
    for (;;) {
      if (options.signal?.aborted === true) throw new DownloadCancelledError()
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      await handle.write(value)
      if (Date.now() - emittedAt >= PROGRESS_INTERVAL_MS) emit()
    }
    if (totalBytes !== undefined && receivedBytes !== totalBytes) {
      throw new Error(
        `the Hugging Face download is incomplete: expected ${String(totalBytes)} bytes, received ${String(receivedBytes)}`,
      )
    }
    emit()
    await handle.sync()
    await handle.close()
    await rename(partPath, options.destination)
    return { sizeBytes: receivedBytes }
  } catch (error: unknown) {
    await closeQuietly(handle)
    await reader.cancel().catch(() => {
      // The stream is already drained, cancelled or aborted; cleanup is best effort.
    })
    if (error instanceof DownloadCancelledError || options.signal?.aborted === true) {
      throw new DownloadCancelledError()
    }
    await discardPart(partPath)
    throw error instanceof Error ? error : new Error('the Hugging Face download failed')
  }
}

