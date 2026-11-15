/**
 * Minimal GGUF metadata reader.
 *
 * Why: the operator needs to know what a downloaded model can actually hold
 * before selecting it — its context window and how much output it will give —
 * and that information lives in the file's own metadata header, not in its
 * file name. This module reads that header directly, with no dependency and
 * without loading the model: GGUF metadata sits at the front of the file and
 * the tensors follow it, so only a small bounded prefix is ever touched.
 *
 * The format (little-endian throughout):
 *
 *   uint32 magic 'GGUF', uint32 version, uint64 tensorCount, uint64 kvCount
 *   repeated kvCount times: string key, uint32 valueType, <value>
 *
 * `string` is uint64 length + UTF-8 bytes; `array` is uint32 elementType +
 * uint64 length + payload. Keys we care about (`general.architecture`,
 * `<arch>.context_length`) appear in the leading general metadata, well before
 * the giant tokenizer arrays, so parsing stops as soon as it has what it needs
 * or hits a bounded budget. A model whose header cannot be read yields an empty
 * result rather than an exception: a missing number must never fail a download
 * that has already succeeded.
 */

import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'

/** GGUF magic, little-endian `'GGUF'`. */
const GGUF_MAGIC = 0x4655_4747

/** Metadata value type ids, per the GGUF specification. */
const VALUE_UINT8 = 0
const VALUE_INT8 = 1
const VALUE_UINT16 = 2
const VALUE_INT16 = 3
const VALUE_UINT32 = 4
const VALUE_INT32 = 5
const VALUE_FLOAT32 = 6
const VALUE_BOOL = 7
const VALUE_STRING = 8
const VALUE_ARRAY = 9
const VALUE_UINT64 = 10
const VALUE_INT64 = 11
const VALUE_FLOAT64 = 12

/** Fixed payload widths of the scalar value types, in bytes. */
const SCALAR_WIDTHS: Readonly<Record<number, number>> = {
  [VALUE_UINT8]: 1,
  [VALUE_INT8]: 1,
  [VALUE_UINT16]: 2,
  [VALUE_INT16]: 2,
  [VALUE_UINT32]: 4,
  [VALUE_INT32]: 4,
  [VALUE_FLOAT32]: 4,
  [VALUE_BOOL]: 1,
  [VALUE_UINT64]: 8,
  [VALUE_INT64]: 8,
  [VALUE_FLOAT64]: 8,
}

/** Bytes read from the file at once; a re-read only ever grows this window. */
const CHUNK_BYTES = 256 * 1024

/**
 * Upper bound on the metadata prefix this reader will walk. Generic metadata is
 * kilobytes; the only way to reach this is a pathological header, which is not
 * worth reading to the end of.
 */
const MAX_METADATA_BYTES = 32 * 1024 * 1024

/** Stop after this many key/value pairs if the wanted keys have not appeared. */
const MAX_PAIRS = 512

/** What a GGUF header declares about the model it describes. */
export interface GgufMetadata {
  /** `general.architecture`, e.g. `llama`, `qwen2`, `gemma3`. */
  readonly architecture?: string
  /** Context window the model declares, when it declares one. */
  readonly contextLength?: number
  /**
   * An explicitly declared output cap, when the header carries one. Rare: GGUF
   * has no standard max-output field, so most models leave this undefined and
   * the caller derives one (see model-limits.ts).
   */
  readonly declaredMaxOutputTokens?: number
  /** `general.name`, when present. */
  readonly name?: string
  /** Bytes of the file that were actually read to reach this answer. */
  readonly consumedBytes: number
}

/** An empty result, for a file that is not a readable GGUF. */
const EMPTY: GgufMetadata = Object.freeze({ consumedBytes: 0 })

/**
 * A forward cursor over a bounded prefix of one file.
 *
 * Reads are synchronous with respect to the caller (each step awaits the bytes it
 * needs), which keeps the parser a single readable function while still never
 * loading more than one window plus the current value.
 */
class PrefixReader {
  private readonly handle: FileHandle
  private buffer: Buffer = Buffer.alloc(0)
  private offset = 0
  private filePosition = 0
  private ended = false

  constructor(handle: FileHandle) {
    this.handle = handle
  }

  /** @returns bytes read from the file so far. */
  get consumed(): number {
    return this.filePosition - (this.buffer.length - this.offset)
  }

  /**
   * Ensure at least `count` unread bytes are buffered.
   * @param count - how many bytes the next step needs.
   * @returns false when the file ended first.
   */
  private async ensure(count: number): Promise<boolean> {
    while (this.buffer.length - this.offset < count) {
      if (this.ended) return false
      if (this.consumed > MAX_METADATA_BYTES) throw new Error('the GGUF metadata header is implausibly large')
      const chunk = Buffer.allocUnsafe(CHUNK_BYTES)
      const { bytesRead } = await this.handle.read(chunk, 0, CHUNK_BYTES, this.filePosition)
      if (bytesRead === 0) {
        this.ended = true
        return false
      }
      this.filePosition += bytesRead
      const remaining = this.buffer.subarray(this.offset)
      this.buffer = Buffer.concat([remaining, chunk.subarray(0, bytesRead)])
      this.offset = 0
    }
    return true
  }

  /**
   * @param count - byte count.
   * @returns the next `count` bytes, or undefined when the file ended.
   */
  async bytes(count: number): Promise<Buffer | undefined> {
    if (!await this.ensure(count)) return undefined
    const slice = this.buffer.subarray(this.offset, this.offset + count)
    this.offset += count
    return slice
  }

  /** @returns the next unsigned 32-bit integer, or undefined when the file ended. */
  async uint32(): Promise<number | undefined> {
    const view = await this.bytes(4)
    return view === undefined ? undefined : view.readUInt32LE(0)
  }

  /** @returns the next unsigned 64-bit integer as a Number, or undefined when the file ended. */
  async uint64(): Promise<number | undefined> {
    const view = await this.bytes(8)
    return view === undefined ? undefined : Number(view.readBigUInt64LE(0))
  }

  /**
   * @param length - byte length of the string.
   * @returns the decoded string, or undefined when the file ended.
   */
  async string(length: number): Promise<string | undefined> {
    const view = await this.bytes(length)
    return view === undefined ? undefined : view.toString('utf8')
  }
}

/**
 * @param valueType - GGUF metadata value type id.
 * @returns the fixed payload width, or undefined for a variable-width type.
 */
function scalarWidth(valueType: number): number | undefined {
  return SCALAR_WIDTHS[valueType]
}

/**
 * Read a scalar as a number.
 * @param view - the value's bytes.
 * @param valueType - GGUF metadata value type id.
 * @returns the numeric value, when the type is numeric.
 */
function scalarValue(view: Buffer, valueType: number): number | undefined {
  switch (valueType) {
    case VALUE_UINT8: return view.readUInt8(0)
    case VALUE_INT8: return view.readInt8(0)
    case VALUE_UINT16: return view.readUInt16LE(0)
    case VALUE_INT16: return view.readInt16LE(0)
    case VALUE_UINT32: return view.readUInt32LE(0)
    case VALUE_INT32: return view.readInt32LE(0)
    case VALUE_FLOAT32: return view.readFloatLE(0)
    case VALUE_UINT64: return Number(view.readBigUInt64LE(0))
    case VALUE_INT64: return Number(view.readBigInt64LE(0))
    case VALUE_FLOAT64: return view.readDoubleLE(0)
    default: return undefined
  }
}

/**
 * Skip one array value without materialising it.
 * @param reader - cursor positioned at the array's element type.
 * @returns false when the file ended mid-array.
 */
async function skipArray(reader: PrefixReader): Promise<boolean> {
  const elementType = await reader.uint32()
  const length = await reader.uint64()
  if (elementType === undefined || length === undefined) return false
  const width = scalarWidth(elementType)
  if (width !== undefined) {
    // Fixed-width elements: one seek-equivalent jump, never a per-element walk.
    const total = width * length
    if (total > MAX_METADATA_BYTES) throw new Error('the GGUF metadata array is implausibly large')
    const payload = await reader.bytes(total)
    return payload !== undefined
  }
  if (elementType === VALUE_STRING) {
    for (let index = 0; index < length; index += 1) {
      const elementLength = await reader.uint64()
      if (elementLength === undefined) return false
      if (await reader.bytes(elementLength) === undefined) return false
    }
    return true
  }
  if (elementType === VALUE_ARRAY) {
    for (let index = 0; index < length; index += 1) {
      if (!await skipArray(reader)) return false
    }
    return true
  }
  // An unknown element type cannot be skipped safely: stop reading metadata.
  return false
}

/**
 * Read the tokens that carry the numbers we want out of a key.
 * @param key - GGUF metadata key.
 * @returns the key's last dotted segment, lowercased.
 */
function leaf(key: string): string {
  const parts = key.split('.')
  return (parts.at(-1) ?? '').toLowerCase()
}

/**
 * Read a GGUF model's declared limits from its header.
 *
 * Reads only as far into the metadata as it must: the general keys it wants come
 * early, and it stops once architecture and a context length are both known.
 * @param path - absolute path of the `.gguf` file.
 * @returns the declared metadata; fields absent when the header does not carry
 *   them. Never throws for an unreadable or non-GGUF file — the caller is
 *   usually a completed download that must not be undone by a metadata miss.
 */
export async function readGgufMetadata(path: string): Promise<GgufMetadata> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    const reader = new PrefixReader(handle)
    const magic = await reader.uint32()
    if (magic !== GGUF_MAGIC) return EMPTY
    const version = await reader.uint32()
    if (version === undefined || version < 2 || version > 3) return EMPTY
    const tensorCount = await reader.uint64()
    const pairCount = await reader.uint64()
    if (tensorCount === undefined || pairCount === undefined) return EMPTY

    let architecture: string | undefined
    let name: string | undefined
    let contextLength: number | undefined
    let maxPositionEmbeddings: number | undefined
    let declaredMaxOutputTokens: number | undefined

    const limit = Math.min(pairCount, MAX_PAIRS)
    for (let index = 0; index < limit; index += 1) {
      const keyLength = await reader.uint64()
      if (keyLength === undefined) break
      if (keyLength > 4_096) break
      const key = await reader.string(keyLength)
      if (key === undefined) break
      const valueType = await reader.uint32()
      if (valueType === undefined) break

      const width = scalarWidth(valueType)
      let numberValue: number | undefined
      let textValue: string | undefined
      if (width !== undefined) {
        const view = await reader.bytes(width)
        if (view === undefined) break
        numberValue = scalarValue(view, valueType)
      }
      else if (valueType === VALUE_STRING) {
        const length = await reader.uint64()
        if (length === undefined) break
        if (length > MAX_METADATA_BYTES) break
        textValue = await reader.string(length)
        if (textValue === undefined) break
      }
      else if (valueType === VALUE_ARRAY) {
        if (!await skipArray(reader)) break
      }
      else break

      const token = leaf(key)
      if (key === 'general.architecture' && textValue !== undefined) architecture = textValue
      else if (key === 'general.name' && textValue !== undefined) name = textValue
      else if (token === 'context_length' && numberValue !== undefined && numberValue > 0) contextLength = numberValue
      else if (token === 'max_position_embeddings' && numberValue !== undefined && numberValue > 0) maxPositionEmbeddings = numberValue
      else if (token === 'max_output_tokens' && numberValue !== undefined && numberValue > 0) declaredMaxOutputTokens = numberValue

      // The two facts the caller needs are settled: stop before the tokenizer arrays.
      if (architecture !== undefined && (contextLength !== undefined || maxPositionEmbeddings !== undefined)
        && declaredMaxOutputTokens !== undefined) {
        break
      }
    }

    const resolvedContext = contextLength ?? maxPositionEmbeddings
    const consumedBytes = reader.consumed
    return {
      consumedBytes,
      ...architecture === undefined ? {} : { architecture },
      ...name === undefined ? {} : { name },
      ...resolvedContext === undefined ? {} : { contextLength: resolvedContext },
      ...declaredMaxOutputTokens === undefined ? {} : { declaredMaxOutputTokens },
    }
  } catch {
    return EMPTY
  } finally {
    await handle?.close().catch(() => {
      // The caller reports nothing from a close failure; the handle is released.
    })
  }
}
