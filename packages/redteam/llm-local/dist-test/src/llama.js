/**
 * Llama serving mode's working half: the model store, the Hugging Face
 * downloader, and control of the host's bundled `llama-server` — ported
 * from the desktop manager that already works (`apps/desktop/src/
 * llama-models.ts`, `llama-hf.ts`, `llama-ipc.ts`, `llama-server.ts`,
 * `llama-settings.ts`, `llama-server-state.ts`) into this package's
 * runtime style: no Electron, the models directory and the fetch
 * implementation arrive as seams, and failures are plain errors the
 * adapter wraps in typed `LlmError`s.
 *
 * One deliberate deviation from the desktop download path, a known
 * defect fixed while porting: the desktop awaits the vision-projector
 * companion fetch before it reports a download done, so a slow or hung
 * companion gates completion. Here the download is done the moment the
 * main file lands and registers; the companion fetch follows
 * best-effort in the background under a timeout and can never gate,
 * fail, or delay that done.
 */
import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { cpus } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalServerState, REGISTRY_FILENAME, SETTINGS_FILENAME, writeLocalServerState, } from "./state.js";
/** Environment name that points directly at the host's `llama-server` binary. */
export const LLAMA_SERVER_BIN_ENV = 'DSH_LLAMA_SERVER_BIN';
/** Environment name the desktop uses for its payload directory; honored here too (desktop `llama-server.ts`). */
export const LLAMA_DIRECTORY_ENV = 'DSH_DESKTOP_LLAMA_DIR';
/** File name of the server log inside the models directory. */
export const LLAMA_SERVER_LOG_FILENAME = 'llama-server.log';
/** Default budget for one llama-server load to answer its readiness probe (desktop `LLAMA_READY_TIMEOUT_MS`). */
export const LLAMA_READY_TIMEOUT_MS = 120_000;
/** Default budget for the best-effort companion fetch that follows a completed download. */
export const LLAMA_COMPANION_TIMEOUT_MS = 60_000;
/** Default budget for one endpoint probe on the status path. */
export const LLAMA_PROBE_TIMEOUT_MS = 2_000;
/** Loopback host the server is always bound to (desktop `LLAMA_SERVER_LOOPBACK`). */
const LLAMA_SERVER_LOOPBACK = '127.0.0.1';
/** Executable name of the bundled server on this platform (desktop `llamaServerExecutableName`). */
const LLAMA_SERVER_EXECUTABLE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
/** Pause between readiness probes (desktop `READY_POLL_INTERVAL_MS`). */
const READY_POLL_INTERVAL_MS = 250;
/** Minimum gap between download progress callbacks (desktop `PROGRESS_INTERVAL_MS`). */
const PROGRESS_INTERVAL_MS = 250;
/** Origin every Hub request is built from (desktop `llama-hf.ts`). */
const HUGGING_FACE_ORIGIN = 'https://huggingface.co';
/** Hub identifiers: exactly one owner segment and one repository segment (desktop `REPO_PATTERN`). */
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;
/** Vision projector prefix (desktop `llama-models.ts`): `mmproj` followed by a separator or the stem end. */
const PROJECTOR_FILE_PATTERN = /^mmproj(?:[-_.]|$)/iu;
/** On-disk registry schema version (desktop `MODEL_REGISTRY_VERSION`). */
const MODEL_REGISTRY_VERSION = 1;
/** Smallest accepted context window (desktop settings bounds). */
const CONTEXT_LENGTH_MIN = 1024;
/** Largest accepted context window (desktop settings bounds). */
const CONTEXT_LENGTH_MAX = 262144;
/** Context window used when the settings document carries no valid value. */
const DEFAULT_CONTEXT_LENGTH = 32768;
/** Logical CPU count, floored at one (desktop settings). */
const CPU_COUNT = Math.max(1, cpus().length);
/** `-ngl` value that offloads every layer: llama.cpp clamps it to the model's layer count. */
export const LLAMA_FULL_OFFLOAD_LAYERS = 999;
/**
 * @param value - candidate field.
 * @returns the value when it is a non-empty string.
 */
function nonEmptyString(value) {
    return typeof value === 'string' && value !== '' ? value : undefined;
}
/**
 * Whether a file name names a vision projector rather than a language
 * model (ported from desktop `llama-models.ts`): a companion asset of a
 * main model that no surface may register or serve alone.
 * @param file - file name or path.
 * @returns true when the base name carries the projector prefix.
 */
export function isProjectorFile(file) {
    return PROJECTOR_FILE_PATTERN.test(basename(file));
}
/**
 * @returns the file name with its final extension removed.
 */
function fileStem(file) {
    const name = basename(file);
    return name.slice(0, name.length - extname(name).length);
}
/**
 * @returns lowercase, hyphen-collapsed form of one id part.
 */
function normalizeIdPart(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
/**
 * Derive the stable model id `<owner>--<name>--<stem>` (ported from
 * desktop `llama-models.ts`). Each part is lowercased, every run of
 * non-alphanumerics becomes one hyphen, and the parts keep their `--`
 * separators. Callers register by this id, so two names that normalize
 * to the same id are the same model.
 * @param input - Hugging Face repository and file name.
 * @returns the normalized id.
 */
export function deriveModelId(input) {
    const [first, ...rest] = input.repo.split('/').map(normalizeIdPart).filter(part => part !== '');
    if (first === undefined)
        throw new Error('local models: cannot derive an id from an empty repository');
    const stem = normalizeIdPart(fileStem(input.file));
    if (stem === '')
        throw new Error('local models: cannot derive an id from an empty file name');
    if (rest.length === 0)
        return `${first}--${stem}`;
    return `${first}--${rest.join('-')}--${stem}`;
}
/** Whole-token GGUF quantization labels (desktop `QUANTIZATION_TOKEN`). */
const QUANTIZATION_TOKEN = /^(?:IQ[1-4](?:_[A-Z0-9]+)+|Q[2-8](?:_[A-Z0-9]+)+|BF16|F16|F32)$/i;
/** `<number><B|M>` parameter size not glued to letters, digits or a version dot (desktop `PARAMETER_SIZE_TOKEN`). */
const PARAMETER_SIZE_TOKEN = /(?<![A-Z0-9.])(?<value>\d+(?:\.\d+)?)(?<unit>[BM])(?![A-Z0-9])/gi;
/**
 * Parse quantization and parameter size from a model file name (ported
 * from desktop `llama-models.ts`).
 * @param file - file name or path of a GGUF file.
 * @returns whichever labels the name carries, or an empty object.
 */
export function parseModelMetadata(file) {
    const name = basename(file);
    let quantization;
    for (const token of name.split(/[^A-Za-z0-9_]+/)) {
        if (QUANTIZATION_TOKEN.test(token))
            quantization = token.toUpperCase();
    }
    let parameterSize;
    for (const match of name.matchAll(PARAMETER_SIZE_TOKEN)) {
        const value = match.groups?.['value'];
        const unit = match.groups?.['unit'];
        if (value !== undefined && unit !== undefined)
            parameterSize = `${value}${unit.toUpperCase()}`;
    }
    return {
        ...quantization === undefined ? {} : { quantization },
        ...parameterSize === undefined ? {} : { parameterSize },
    };
}
/** Byte cap on the GGUF header scan: the architecture metadata block that carries the context length sits at the head of the file, far inside this cap; a file whose block runs past it reads as undeclared. */
const GGUF_SCAN_MAX_BYTES = 8 * 1024 * 1024;
/** Fixed byte sizes of the scalar GGUF metadata value types, by type id (GGUF spec: UINT8, INT8, UINT16, INT16, UINT32, INT32, FLOAT32, BOOL, STRING, ARRAY, UINT64, INT64, FLOAT64). */
const GGUF_SCALAR_SIZES = {
    0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8,
};
/** GGUF metadata value type id of a length-prefixed string. */
const GGUF_TYPE_STRING = 8;
/** GGUF metadata value type id of a typed array. */
const GGUF_TYPE_ARRAY = 9;
/**
 * Parse the context length one GGUF file declares, from the header
 * metadata bytes: the magic, the tensor and metadata counts, then the
 * key/value pairs, where the architecture block carries a
 * `<architecture>.context_length` unsigned integer. Every other value
 * is walked by its type so the scan can reach that key wherever the
 * writer ordered it. This is the model's own declared maximum — the
 * number an unset context window resolves to — and no other source in
 * the store carries it: the registry records names and sizes only, and
 * the Hub listing reports file names and sizes only.
 * @param bytes - the file's head bytes (see {@link GGUF_SCAN_MAX_BYTES}).
 * @returns the declared context length, or undefined when the bytes are
 * not a readable GGUF header or declare none within the scanned span.
 */
export function parseGgufContextLength(bytes) {
    let offset = 0;
    /**
     * @param size - bytes the cursor must have left.
     * @returns whether the read fits in the scanned span.
     */
    const fits = (size) => offset + size <= bytes.length;
    /**
     * @param size - bytes to read.
     * @returns the unsigned 32-bit value at the cursor, or undefined past the span.
     */
    const readU32 = (size) => {
        if (!fits(size))
            return undefined;
        let value = 0;
        for (let index = size - 1; index >= 0; index -= 1) {
            value = value * 256 + (bytes[offset + index] ?? 0);
        }
        offset += size;
        return value;
    };
    /**
     * @returns the unsigned 64-bit value at the cursor as a number, or undefined past the span or past the safe-integer range.
     */
    const readU64 = () => {
        const low = readU32(4);
        const high = readU32(4);
        if (low === undefined || high === undefined)
            return undefined;
        const value = high * 2 ** 32 + low;
        return Number.isSafeInteger(value) ? value : undefined;
    };
    /**
     * @returns the length-prefixed string at the cursor, or undefined past the span.
     */
    const readString = () => {
        const length = readU64();
        if (length === undefined || !fits(length))
            return undefined;
        const text = new TextDecoder().decode(bytes.subarray(offset, offset + length));
        offset += length;
        return text;
    };
    /**
     * Skip one metadata value of the given type at the cursor.
     * @param type - the GGUF metadata value type id.
     * @returns whether the value fit in the scanned span.
     */
    const skipValue = (type) => {
        if (type === GGUF_TYPE_STRING)
            return readString() !== undefined;
        if (type === GGUF_TYPE_ARRAY) {
            const elementType = readU32(4);
            const count = readU64();
            if (elementType === undefined || count === undefined)
                return false;
            for (let index = 0; index < count; index += 1) {
                if (!skipValue(elementType))
                    return false;
            }
            return true;
        }
        const size = GGUF_SCALAR_SIZES[type];
        if (size === undefined || !fits(size))
            return false;
        offset += size;
        return true;
    };
    if (bytes.length < 4 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'GGUF')
        return undefined;
    offset = 4;
    if (readU32(4) === undefined)
        return undefined; // format version
    if (readU64() === undefined)
        return undefined; // tensor count
    const pairCount = readU64();
    if (pairCount === undefined)
        return undefined;
    for (let pair = 0; pair < pairCount; pair += 1) {
        const key = readString();
        if (key === undefined)
            return undefined;
        const type = readU32(4);
        if (type === undefined)
            return undefined;
        if (key.endsWith('.context_length')) {
            const size = GGUF_SCALAR_SIZES[type];
            if (size === undefined || type === 6 || type === 12)
                return undefined;
            const value = size <= 4 ? readU32(size) : readU64();
            return value !== undefined && value > 0 ? value : undefined;
        }
        if (!skipValue(type))
            return undefined;
    }
    return undefined;
}
/**
 * Read the context length one downloaded GGUF declares, from its file
 * on disk. Fail-soft like every store read in this package: a missing,
 * unreadable, or non-GGUF file declares nothing, and a declaration
 * past the scanned head bytes reads as undeclared.
 * @param path - absolute path of the GGUF file.
 * @returns the declared context length, or undefined when none is readable.
 */
export function readGgufContextLength(path) {
    let fd;
    try {
        fd = openSync(path, 'r');
    }
    catch {
        return undefined;
    }
    try {
        const head = Buffer.alloc(GGUF_SCAN_MAX_BYTES);
        const read = readSync(fd, head, 0, GGUF_SCAN_MAX_BYTES, 0);
        return parseGgufContextLength(head.subarray(0, read));
    }
    catch {
        return undefined;
    }
    finally {
        closeSync(fd);
    }
}
/**
 * Resolve the context length one llama start serves with, in the
 * precedence the operator's shape requires: the persisted settings
 * value wins, then the model's own declared maximum (clamped to the
 * accepted range), and only when neither exists the desktop default
 * ({@link DEFAULT_CONTEXT_LENGTH}) — the named fallback for a model
 * whose declaration no source can read.
 * @param persisted - the settings document's context length, when it sets one.
 * @param declaredMaximum - the model's declared context length, when readable.
 * @returns the context length to pass as `-c`.
 */
export function resolveEffectiveLlamaContextLength(persisted, declaredMaximum) {
    if (persisted !== undefined)
        return persisted;
    if (declaredMaximum !== undefined) {
        return boundedInteger(declaredMaximum, DEFAULT_CONTEXT_LENGTH, CONTEXT_LENGTH_MIN, CONTEXT_LENGTH_MAX);
    }
    return DEFAULT_CONTEXT_LENGTH;
}
/** In-process registry mutation tails, keyed by models directory; writes are read-modify-write. */
const storeTails = new Map();
/** Distinguishes temporary registry files written by concurrent processes. */
let temporarySequence = 0;
/**
 * Run one registry mutation after every earlier mutation for the same
 * directory settled (desktop `serializeStore`).
 * @param directory - absolute models directory.
 * @param action - read-modify-write step to serialize.
 * @returns the step's result.
 */
function serializeStore(directory, action) {
    const tail = storeTails.get(directory) ?? Promise.resolve();
    const result = tail.then(action, action);
    storeTails.set(directory, result.then(() => undefined, () => undefined));
    return result;
}
/**
 * Validate one registry entry, dropping fields this build does not know
 * (desktop `registryModel`). A projector entry reads as no such model.
 * @param value - candidate entry from the registry document.
 * @returns the validated entry, or undefined when required fields are unusable.
 */
function registryEntry(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const record = value;
    const id = nonEmptyString(record['id']);
    const repo = nonEmptyString(record['repo']);
    const file = nonEmptyString(record['file']);
    const path = nonEmptyString(record['path']);
    if (id === undefined || repo === undefined || file === undefined || path === undefined)
        return undefined;
    const sizeBytes = record['sizeBytes'];
    const downloadedAt = record['downloadedAt'];
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes))
        return undefined;
    if (typeof downloadedAt !== 'number' || !Number.isFinite(downloadedAt))
        return undefined;
    if (isProjectorFile(file))
        return undefined;
    const quantization = nonEmptyString(record['quantization']);
    const parameterSize = nonEmptyString(record['parameterSize']);
    const companionPath = nonEmptyString(record['companionPath']);
    return {
        id,
        repo,
        file,
        path,
        sizeBytes,
        downloadedAt,
        ...quantization === undefined ? {} : { quantization },
        ...parameterSize === undefined ? {} : { parameterSize },
        ...companionPath === undefined ? {} : { companionPath },
    };
}
/**
 * Read the registry of one models directory, tolerating a missing or
 * corrupt document (desktop `readRegistryModels`).
 * @param directory - absolute models directory.
 * @returns every valid registry entry, including entries whose file is missing.
 */
export async function readLlamaRegistry(directory) {
    let raw;
    try {
        raw = await readFile(join(directory, REGISTRY_FILENAME), 'utf8');
    }
    catch {
        return [];
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return [];
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return [];
    const document = parsed;
    if (document['version'] !== MODEL_REGISTRY_VERSION || !Array.isArray(document['models']))
        return [];
    const entries = [];
    for (const item of document['models']) {
        const entry = registryEntry(item);
        if (entry !== undefined)
            entries.push(entry);
    }
    return entries;
}
/**
 * Replace the registry atomically with one complete model list
 * (desktop `writeRegistry`).
 * @param directory - absolute models directory.
 * @param models - complete next model list.
 */
async function writeRegistry(directory, models) {
    await mkdir(directory, { recursive: true });
    const file = join(directory, REGISTRY_FILENAME);
    temporarySequence += 1;
    const temporary = `${file}.${process.pid}.${temporarySequence}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify({ version: MODEL_REGISTRY_VERSION, models }, null, 2)}\n`, 'utf8');
        await rename(temporary, file);
    }
    catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
}
/**
 * Insert or replace one model and persist the registry atomically
 * (desktop `registerModel`).
 * @param directory - absolute models directory.
 * @param model - validated download metadata; an existing entry with the same id is replaced.
 * @returns the registered model.
 */
export function registerLlamaModel(directory, model) {
    if (isProjectorFile(model.file)) {
        throw new Error('local models: a vision projector cannot be registered as a model');
    }
    return serializeStore(directory, async () => {
        const models = await readLlamaRegistry(directory);
        await writeRegistry(directory, [...models.filter(entry => entry.id !== model.id), model]);
        return model;
    });
}
/**
 * Delete a model file, its partial download sidecar, and its registry
 * entry (desktop `deleteModel`). The companion file goes with it unless
 * another entry records the same companion.
 * @param directory - absolute models directory.
 * @param id - model id to remove.
 * @returns the removed entry, or undefined when the registry holds no such id.
 */
export function removeLlamaModel(directory, id) {
    return serializeStore(directory, async () => {
        const models = await readLlamaRegistry(directory);
        const target = models.find(entry => entry.id === id);
        if (target === undefined)
            return undefined;
        await rm(target.path, { force: true });
        await rm(`${target.path}.part`, { force: true });
        const remaining = models.filter(entry => entry.id !== id);
        if (target.companionPath !== undefined
            && !remaining.some(entry => entry.companionPath === target.companionPath)) {
            await rm(target.companionPath, { force: true });
            await rm(`${target.companionPath}.part`, { force: true });
        }
        await writeRegistry(directory, remaining);
        return target;
    });
}
/**
 * Coerce a JSON value into an integer inside inclusive bounds (desktop
 * `boundedInteger`).
 * @param value - number or numeric string from the document.
 * @param fallback - value used when `value` is not finite.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @returns the clamped integer.
 */
function boundedInteger(value, fallback, min, max) {
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    if (!Number.isFinite(numeric))
        return fallback;
    return Math.min(max, Math.max(min, Math.trunc(numeric)));
}
/**
 * Read the store's settings document, tolerating any unreadable or
 * corrupt document: absent fields resolve to the desktop's defaults and
 * numeric fields clamp to the desktop's accepted ranges.
 * @param directory - absolute models directory.
 * @returns the settings the server start and the downloader consume.
 */
export function readLlamaStoreSettings(directory) {
    let source = {};
    try {
        const parsed = JSON.parse(readFileSync(join(directory, SETTINGS_FILENAME), 'utf8'));
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            source = parsed;
        }
    }
    catch {
        // A missing or corrupt document resolves to the defaults, never to a failure.
    }
    const token = typeof source['huggingFaceToken'] === 'string' ? source['huggingFaceToken'].trim() : '';
    const gpuLayers = optionalBoundedInteger(source['gpuLayers'], 0, LLAMA_FULL_OFFLOAD_LAYERS);
    const persistedContextLength = optionalBoundedInteger(source['contextLength'], CONTEXT_LENGTH_MIN, CONTEXT_LENGTH_MAX);
    return {
        contextLength: boundedInteger(source['contextLength'], DEFAULT_CONTEXT_LENGTH, CONTEXT_LENGTH_MIN, CONTEXT_LENGTH_MAX),
        ...persistedContextLength === undefined ? {} : { persistedContextLength },
        threads: boundedInteger(source['threads'], CPU_COUNT, 1, CPU_COUNT * 2),
        ...gpuLayers === undefined ? {} : { gpuLayers },
        ...token === '' ? {} : { huggingFaceToken: token },
    };
}
/**
 * Coerce a JSON value into an integer inside inclusive bounds, keeping
 * absence absent: a settings field the document does not set (or sets
 * unusably) stays `undefined` so the consumer can tell "not configured"
 * from an explicit value.
 * @param value - number or numeric string from the document.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @returns the clamped integer, or `undefined` when `value` is not finite.
 */
function optionalBoundedInteger(value, min, max) {
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    if (!Number.isFinite(numeric))
        return undefined;
    return Math.min(max, Math.max(min, Math.trunc(numeric)));
}
/** Cancellation raised when the caller's `AbortSignal` stopped a download; the part file survives. */
export class DownloadCancelledError extends Error {
    /** Builds the one cancellation error every aborted call reports. */
    constructor() {
        super('the model download was cancelled');
        this.name = 'DownloadCancelledError';
    }
}
/**
 * @param value - any decoded JSON value.
 * @returns whether the value is a plain JSON object.
 */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * @param value - a byte count read from JSON.
 * @returns the count when it is a non-negative safe integer, otherwise `undefined`.
 */
function byteCount(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
/**
 * @param value - a `Content-Length` response header.
 * @returns the declared byte count when it is a non-negative safe integer.
 */
function declaredByteCount(value) {
    if (value === null || !/^\d+$/u.test(value.trim()))
        return undefined;
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}
/**
 * @param repo - operator-supplied Hub identifier.
 * @returns the identifier when it is exactly `owner/name`.
 */
function repoIdentifier(repo) {
    if (!REPO_PATTERN.test(repo))
        throw new Error('the Hugging Face repository must be in owner/name form');
    return repo;
}
/**
 * @param file - file path inside the repository.
 * @returns the path with each segment percent-encoded and the separators kept.
 */
function repositoryFilePath(file) {
    const segments = file.split('/');
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
        throw new Error('the Hugging Face file must be a relative path inside the repository');
    }
    return segments.map(segment => encodeURIComponent(segment)).join('/');
}
/**
 * @param token - optional Hub token.
 * @returns request headers carrying the token as a Bearer credential; an empty token is omitted.
 */
function authorizationHeaders(token) {
    const headers = new Headers();
    if (token !== undefined && token !== '')
        headers.set('authorization', `Bearer ${token}`);
    return headers;
}
/**
 * Build the direct download URL of one repository file (desktop
 * `resolveFileUrl`).
 * @param options - repository and file path.
 * @returns `https://huggingface.co/<repo>/resolve/main/<file>` with encoded path segments.
 */
export function resolveFileUrl(options) {
    const repo = repoIdentifier(options.repo)
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
    return `${HUGGING_FACE_ORIGIN}/${repo}/resolve/main/${repositoryFilePath(options.file)}`;
}
/**
 * @param left - one repository file.
 * @param right - another repository file.
 * @returns an ascending-size order; entries without a known size follow, ordered by name.
 */
function compareBySize(left, right) {
    if (left.sizeBytes !== undefined && right.sizeBytes !== undefined)
        return left.sizeBytes - right.sizeBytes;
    if (left.sizeBytes !== undefined)
        return -1;
    if (right.sizeBytes !== undefined)
        return 1;
    if (left.file === right.file)
        return 0;
    return left.file < right.file ? -1 : 1;
}
/**
 * List the files a Hub repository offers (desktop `listRepoFiles`): the
 * listing comes from `GET /api/models/<repo>`; when that reply omits a
 * size, the tree API is read once, best effort. A tree failure never
 * fails the listing.
 * @param options - repository, transport, optional token and abort signal.
 * @returns every sibling, with `isGguf` set (`isProjector` on a vision
 *   projector instead) and sized entries first in ascending size order.
 */
export async function listRepoFiles(options) {
    const repo = repoIdentifier(options.repo);
    const fetchImpl = options.fetchImpl;
    let response;
    try {
        response = await fetchImpl(`${HUGGING_FACE_ORIGIN}/api/models/${repo}`, {
            headers: authorizationHeaders(options.token),
            ...options.signal === undefined ? {} : { signal: options.signal },
        });
    }
    catch {
        throw new Error('the Hugging Face repository listing could not be read');
    }
    if (response.status === 401 || response.status === 403) {
        throw new Error(`Hugging Face could not read this repository (HTTP ${String(response.status)}): check the owner/name spelling (a repo is "owner/name", never a file name); set a Hugging Face token in Local Models settings only if the repo is gated`);
    }
    if (response.status === 404)
        throw new Error('Hugging Face repo not found');
    if (!response.ok)
        throw new Error(`Hugging Face repository listing failed (HTTP ${String(response.status)})`);
    let listing;
    try {
        listing = await response.json();
    }
    catch {
        throw new Error('Hugging Face returned an unreadable repository listing');
    }
    if (!isRecord(listing) || !Array.isArray(listing.siblings)) {
        throw new Error('Hugging Face returned an unexpected repository listing');
    }
    let files = [];
    for (const entry of listing.siblings) {
        if (!isRecord(entry) || typeof entry.rfilename !== 'string' || entry.rfilename === '') {
            throw new Error('Hugging Face returned an unexpected repository listing');
        }
        const size = byteCount(entry.size);
        const projector = isProjectorFile(entry.rfilename);
        files.push({
            file: entry.rfilename,
            isGguf: /\.gguf$/iu.test(entry.rfilename) && !projector,
            ...projector ? { isProjector: true } : {},
            ...size === undefined ? {} : { sizeBytes: size },
        });
    }
    if (files.some(file => file.sizeBytes === undefined)) {
        const sizes = await repositoryTreeSizes(fetchImpl, repo, options.token, options.signal);
        if (sizes !== undefined) {
            files = files.map((file) => {
                if (file.sizeBytes !== undefined)
                    return file;
                const size = sizes.get(file.file);
                return size === undefined ? file : { ...file, sizeBytes: size };
            });
        }
    }
    return files.sort(compareBySize);
}
/**
 * Read byte sizes from the repository tree API, best effort (desktop
 * `repositoryTreeSizes`).
 * @param fetchImpl - transport.
 * @param repo - validated repository identifier.
 * @param token - optional Hub token.
 * @param signal - optional abort signal.
 * @returns path-to-size entries, or `undefined` when the tree could not be read.
 */
async function repositoryTreeSizes(fetchImpl, repo, token, signal) {
    try {
        const response = await fetchImpl(`${HUGGING_FACE_ORIGIN}/api/models/${repo}/tree/main`, {
            headers: authorizationHeaders(token),
            ...signal === undefined ? {} : { signal },
        });
        if (!response.ok)
            return undefined;
        const parsed = await response.json();
        if (!Array.isArray(parsed))
            return undefined;
        const sizes = new Map();
        for (const entry of parsed) {
            if (!isRecord(entry))
                continue;
            const size = byteCount(entry.size);
            if (typeof entry.path === 'string' && size !== undefined)
                sizes.set(entry.path, size);
        }
        return sizes;
    }
    catch {
        return undefined;
    }
}
/**
 * @param header - `Content-Range` response header.
 * @param expectedStart - byte offset the requested range had to start at.
 * @returns the parsed range when it matches the requested resume point.
 */
function partialRange(header, expectedStart) {
    if (header === null)
        return undefined;
    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(header.trim());
    if (match === null)
        return undefined;
    const start = Number(match[1]);
    const end = Number(match[2]);
    const totalText = match[3];
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start !== expectedStart || end < start) {
        return undefined;
    }
    if (totalText === undefined || totalText === '*')
        return { start, end };
    const total = Number(totalText);
    if (!Number.isSafeInteger(total) || total <= end)
        return undefined;
    return { start, end, total };
}
/**
 * @param partPath - retained part file.
 * @returns the bytes already landed, or zero when there is nothing to resume.
 */
async function retainedBytes(partPath) {
    try {
        const retained = await stat(partPath);
        return retained.isFile() ? retained.size : 0;
    }
    catch {
        return 0;
    }
}
/**
 * @param partPath - retained part file.
 * @returns after the part file is gone; removal is best effort.
 */
async function discardPart(partPath) {
    try {
        await rm(partPath, { force: true });
    }
    catch {
        // The part file was already gone, or removal failed; the caller reports the real failure.
    }
}
/**
 * @param handle - part file handle the download may still hold.
 * @returns after the handle is closed; an already-closed handle is tolerated.
 */
async function closeQuietly(handle) {
    try {
        await handle.close();
    }
    catch {
        // Closing an already-closed or broken handle changes nothing for the caller.
    }
}
/**
 * Download one Hub file to `destination`, resuming a retained
 * `<destination>.part` (desktop `downloadFile`). Bytes stream into
 * `destination.part`; the file is synced and renamed into place only
 * after the size verifies. Cancellation through `signal` keeps the part
 * file so a later call resumes; every other failure removes it.
 * @param options - URL, destination, transport, optional token, progress listener and signal.
 * @returns the number of bytes now in `destination`.
 */
export async function downloadFile(options) {
    const fetchImpl = options.fetchImpl;
    const partPath = `${options.destination}.part`;
    await mkdir(dirname(options.destination), { recursive: true });
    const retained = await retainedBytes(partPath);
    const headers = authorizationHeaders(options.token);
    if (retained > 0)
        headers.set('range', `bytes=${String(retained)}-`);
    let response;
    try {
        response = await fetchImpl(options.url, {
            headers,
            ...options.signal === undefined ? {} : { signal: options.signal },
        });
    }
    catch {
        if (options.signal?.aborted === true)
            throw new DownloadCancelledError();
        await discardPart(partPath);
        throw new Error('the Hugging Face download could not be started');
    }
    const status = response.status;
    if (status !== 200 && status !== 206) {
        await discardPart(partPath);
        if (status === 401 || status === 403) {
            throw new Error(`Hugging Face could not download this file (HTTP ${String(status)}): check the repository spelling and public access; set a Hugging Face token in Local Models settings only if the repo is gated`);
        }
        if (status === 404)
            throw new Error('Hugging Face file not found');
        throw new Error(`Hugging Face download failed (HTTP ${String(status)})`);
    }
    const range = status === 206 ? partialRange(response.headers.get('content-range'), retained) : undefined;
    if (status === 206 && range === undefined) {
        await discardPart(partPath);
        throw new Error('Hugging Face returned a partial download this client cannot resume');
    }
    const startOffset = range === undefined ? 0 : range.start;
    const totalBytes = range === undefined
        ? declaredByteCount(response.headers.get('content-length'))
        : range.total ?? range.end + 1;
    const body = response.body;
    if (body === null) {
        await discardPart(partPath);
        throw new Error('the Hugging Face download returned no content');
    }
    const handle = await open(partPath, startOffset > 0 ? 'a' : 'w');
    let receivedBytes = startOffset;
    let emittedAt = 0;
    const emit = () => {
        emittedAt = Date.now();
        options.onProgress?.({
            receivedBytes,
            ...totalBytes === undefined ? {} : { totalBytes },
        });
    };
    const reader = body.getReader();
    try {
        emit();
        for (;;) {
            if (options.signal?.aborted === true)
                throw new DownloadCancelledError();
            const { done, value } = await reader.read();
            if (done)
                break;
            receivedBytes += value.byteLength;
            await handle.write(value);
            if (Date.now() - emittedAt >= PROGRESS_INTERVAL_MS)
                emit();
        }
        if (totalBytes !== undefined && receivedBytes !== totalBytes) {
            throw new Error(`the Hugging Face download is incomplete: expected ${String(totalBytes)} bytes, received ${String(receivedBytes)}`);
        }
        emit();
        await handle.sync();
        await handle.close();
        await rename(partPath, options.destination);
        return { sizeBytes: receivedBytes };
    }
    catch (error) {
        await closeQuietly(handle);
        await reader.cancel().catch(() => {
            // The stream is already drained, cancelled or aborted; cleanup is best effort.
        });
        if (error instanceof DownloadCancelledError || options.signal?.aborted === true) {
            throw new DownloadCancelledError();
        }
        await discardPart(partPath);
        throw error instanceof Error ? error : new Error('the Hugging Face download failed');
    }
}
// ---------------------------------------------------------------------------
// Download orchestration (ported from desktop llama-ipc.ts, with the finalize fix)
// ---------------------------------------------------------------------------
/**
 * Pick the main model file of one repository listing: a file whose stem
 * matches the repository name wins; otherwise the largest GGUF, because
 * a repository's main model is its largest language-model file. A
 * projector is never a candidate (`isGguf` already excludes it).
 * @param files - the repository listing.
 * @param repo - the repository identifier.
 * @returns the chosen file's path inside the repository.
 */
function pickMainFile(files, repo) {
    const candidates = files.filter(file => file.isGguf);
    if (candidates.length === 0) {
        throw new Error(`Hugging Face repository "${repo}" offers no GGUF model file to download`);
    }
    const repoName = normalizeIdPart(repo.split('/')[1] ?? '');
    const named = candidates.find(file => normalizeIdPart(fileStem(file.file)) === repoName);
    if (named !== undefined)
        return named.file;
    const largest = [...candidates].sort((left, right) => (right.sizeBytes ?? -1) - (left.sizeBytes ?? -1))[0];
    return (largest ?? candidates[0]).file;
}
/**
 * Fetch the vision projector companion a downloaded model's repository
 * ships (desktop `fetchCompanion`), under a timeout: the companion
 * lands under its own derived id, so every model of the repository
 * shares one copy, and the model entry is re-registered with the
 * companion path recorded. A repository without a projector and any
 * companion failure both leave the model exactly as registered.
 * @param deps - host seams.
 * @param model - the registered model the companion belongs to.
 * @param token - the configured Hub token, forwarded to both Hub calls.
 */
async function fetchCompanion(deps, model, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, deps.companionTimeoutMs ?? LLAMA_COMPANION_TIMEOUT_MS);
    timer.unref?.();
    try {
        const files = await listRepoFiles({
            repo: model.repo,
            fetchImpl: deps.fetchImpl,
            signal: controller.signal,
            ...token === undefined ? {} : { token },
        });
        const projector = files
            .filter(file => file.isProjector === true || isProjectorFile(file.file))
            .sort((left, right) => left.file.localeCompare(right.file))[0];
        if (projector === undefined)
            return;
        const companionId = deriveModelId({ repo: model.repo, file: projector.file });
        const extension = extname(projector.file) || '.gguf';
        const companionPath = join(deps.directory, `${companionId}${extension}`);
        const present = await stat(companionPath).catch(() => undefined);
        if (present === undefined || !present.isFile()) {
            await downloadFile({
                url: resolveFileUrl({ repo: model.repo, file: projector.file }),
                destination: companionPath,
                fetchImpl: deps.fetchImpl,
                signal: controller.signal,
                ...token === undefined ? {} : { token },
            });
        }
        await registerLlamaModel(deps.directory, { ...model, companionPath });
    }
    catch {
        // Best effort by design: the model already landed and registered, so
        // a companion failure leaves it serving text-only and is never the
        // download's failure.
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Download one model from Hugging Face into the store and register it
 * (desktop `downloadModel`): resolve the requested file (or the
 * repository's main GGUF), stream it into the store under its derived
 * id, and register the landed file. The returned promise resolves the
 * moment the main file has landed and registered — that is the
 * download's DONE. The companion fetch is started only after that, in
 * the background under its own timeout (see {@link fetchCompanion});
 * it is never awaited here, so it can never gate done.
 * @param deps - host seams.
 * @param input - repository, and optionally the exact file inside it.
 * @param onProgress - called with byte counts as they land.
 * @returns the registered model.
 */
export async function downloadLlamaModel(deps, input, onProgress) {
    const token = readLlamaStoreSettings(deps.directory).huggingFaceToken;
    let file = input.file;
    if (file === undefined) {
        const files = await listRepoFiles({
            repo: input.repo,
            fetchImpl: deps.fetchImpl,
            ...token === undefined ? {} : { token },
        });
        file = pickMainFile(files, input.repo);
    }
    if (isProjectorFile(file)) {
        throw new Error(`${file} is a vision projector, not a model; it cannot be downloaded or served `
            + 'on its own, and it is fetched automatically with a model from the same repository');
    }
    const id = deriveModelId({ repo: input.repo, file });
    // The id is an identifier-safe stem, and the destination repeats it so
    // two repositories shipping a file with the same name cannot overwrite
    // each other (desktop downloadModel).
    const extension = extname(file) || '.gguf';
    const destination = join(deps.directory, `${id}${extension}`);
    const result = await downloadFile({
        url: resolveFileUrl({ repo: input.repo, file }),
        destination,
        fetchImpl: deps.fetchImpl,
        ...onProgress === undefined ? {} : { onProgress },
        ...token === undefined ? {} : { token },
    });
    const metadata = parseModelMetadata(file);
    const registered = await registerLlamaModel(deps.directory, {
        id,
        repo: input.repo,
        file,
        path: destination,
        sizeBytes: result.sizeBytes,
        downloadedAt: (deps.now ?? Date.now)(),
        ...metadata.quantization === undefined ? {} : { quantization: metadata.quantization },
        ...metadata.parameterSize === undefined ? {} : { parameterSize: metadata.parameterSize },
    });
    // DONE is here: the main file has landed and registered. The companion
    // fetch follows best-effort in the background and is deliberately not
    // awaited — the finalize fix this port exists to carry.
    void fetchCompanion(deps, registered, token);
    return registered;
}
// ---------------------------------------------------------------------------
// Endpoint probe (the runner's pattern: apps/redteam-runner/src/ui/local-model.ts)
// ---------------------------------------------------------------------------
/**
 * Probe one llama endpoint: `GET {baseUrl}/models` against the
 * OpenAI-compatible surface. The document alone is not proof — the
 * desktop may have died since it wrote server-state — so the endpoint
 * itself must answer. llama.cpp answers with the loaded model's id (the
 * registry id, published through `--alias`) in the `data` list; some
 * builds also carry a `models` list — both are read.
 * @param fetchImpl - the fetch seam.
 * @param baseUrl - the published endpoint root (`.../v1`).
 * @param timeoutMs - budget for the probe.
 * @returns the served model ids (possibly an empty list when the
 *   endpoint answers but names none), or null when it does not answer.
 */
export async function probeLlamaEndpoint(fetchImpl, baseUrl, timeoutMs = LLAMA_PROBE_TIMEOUT_MS) {
    let response;
    try {
        response = await fetchImpl(`${baseUrl}/models`, { signal: AbortSignal.timeout(timeoutMs) });
    }
    catch {
        return null;
    }
    if (!response.ok)
        return null;
    let data;
    try {
        data = await response.json();
    }
    catch {
        // The endpoint answered; only its model list is unreadable.
        return [];
    }
    if (!isRecord(data))
        return [];
    const ids = [];
    for (const key of ['data', 'models']) {
        const list = data[key];
        if (!Array.isArray(list))
            continue;
        for (const item of list) {
            if (!isRecord(item))
                continue;
            const id = nonEmptyString(item['id']) ?? nonEmptyString(item['name']);
            if (id !== undefined && !ids.includes(id))
                ids.push(id);
        }
    }
    return ids;
}
// ---------------------------------------------------------------------------
// GPU offload (the desktop original ran on a GPU-less host and pinned
// `-ngl 0`; hosts with an NVIDIA GPU get their layers offloaded instead)
// ---------------------------------------------------------------------------
/** Free VRAM headroom an automatic full offload requires beyond the model file's size. */
const GPU_OFFLOAD_HEADROOM = 1.3;
/**
 * Query every NVIDIA GPU's free VRAM through `nvidia-smi`
 * (`index,memory.free` in MiB). A host without the tool or the driver
 * answers with an empty list, which the offload policy reads as no GPU.
 * @returns one entry per GPU, in `nvidia-smi` order.
 */
export async function queryNvidiaGpus() {
    let stdout;
    try {
        stdout = await new Promise((resolveQuery, rejectQuery) => {
            execFile('nvidia-smi', ['--query-gpu=index,memory.free', '--format=csv,noheader,nounits'], { timeout: 5_000 }, (error, output) => { if (error === null)
                resolveQuery(output);
            else
                rejectQuery(error); });
        });
    }
    catch {
        return [];
    }
    const gpus = [];
    for (const line of stdout.split('\n')) {
        const [indexText, freeText] = line.split(',').map(part => part.trim());
        const index = Number(indexText);
        const freeMiB = Number(freeText);
        if (Number.isSafeInteger(index) && index >= 0 && Number.isFinite(freeMiB) && freeMiB >= 0) {
            gpus.push({ index, freeBytes: Math.trunc(freeMiB * 1024 * 1024) });
        }
    }
    return gpus;
}
/**
 * Resolve one start's GPU offload. An operator-set `gpuLayers` from the
 * store settings is honored verbatim and pins no device. Otherwise the
 * freest GPU earns a full offload ({@link LLAMA_FULL_OFFLOAD_LAYERS})
 * only when its free VRAM fits the model file plus
 * {@link GPU_OFFLOAD_HEADROOM} headroom; every other case is the CPU.
 * @param input - the settings value when set, the model file's size, and the GPUs found.
 * @returns the `-ngl` value, and the GPU index on the automatic path.
 */
export function resolveGpuOffload(input) {
    if (input.settingsGpuLayers !== undefined)
        return { gpuLayers: input.settingsGpuLayers };
    let freest;
    for (const gpu of input.gpus) {
        if (freest === undefined || gpu.freeBytes > freest.freeBytes)
            freest = gpu;
    }
    if (freest !== undefined && freest.freeBytes > 0 && freest.freeBytes >= input.modelSizeBytes * GPU_OFFLOAD_HEADROOM) {
        return { gpuLayers: LLAMA_FULL_OFFLOAD_LAYERS, gpuIndex: freest.index };
    }
    return { gpuLayers: 0 };
}
/** Server-log text classes that mark a GPU memory failure (llama.cpp / ggml CUDA allocation paths). */
const GPU_OOM_LOG_PATTERN = /out of memory|failed to allocate|ggml_cuda|cuda error|cudamalloc/iu;
/**
 * Read the server log written since one spawn and test it for a GPU
 * memory failure. Only the new text counts: the log is append-only
 * across starts, so an older failure must not condemn a later start.
 * @param logPath - the server log inside the models directory.
 * @param offset - byte length of the log before this spawn.
 * @returns whether the new log text carries an OOM-class failure.
 */
function serverLogShowsGpuOom(logPath, offset) {
    try {
        return GPU_OOM_LOG_PATTERN.test(readFileSync(logPath, 'utf8').slice(offset));
    }
    catch {
        return false;
    }
}
// ---------------------------------------------------------------------------
// Server control (ported from desktop llama-server.ts)
// ---------------------------------------------------------------------------
/**
 * Resolve the host's `llama-server` binary: an explicit path wins, then
 * the `DSH_LLAMA_SERVER_BIN` environment override, then the desktop's
 * payload-directory override, then `apps/desktop/resources/llama/`
 * relative to the app tree this host runs from — found by walking up
 * from this module (which lives inside that tree in both source and
 * built layouts) — and finally that same relative path under the
 * process working directory.
 * @param environment - environment to read (defaults to `process.env`).
 * @param explicit - explicit binary path from plugin configuration, when set.
 * @returns the resolved binary path (which may not exist; the start path reports that honestly).
 */
export function resolveLlamaServerBinary(environment = process.env, explicit) {
    const configured = explicit?.trim() ?? '';
    if (configured !== '')
        return configured;
    const fromEnv = environment[LLAMA_SERVER_BIN_ENV]?.trim() ?? '';
    if (fromEnv !== '')
        return fromEnv;
    const payloadDir = environment[LLAMA_DIRECTORY_ENV]?.trim() ?? '';
    if (payloadDir !== '')
        return join(payloadDir, LLAMA_SERVER_EXECUTABLE);
    let cursor = dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth += 1) {
        const candidate = join(cursor, 'apps', 'desktop', 'resources', 'llama', LLAMA_SERVER_EXECUTABLE);
        if (existsSync(candidate))
            return candidate;
        const parent = dirname(cursor);
        if (parent === cursor)
            break;
        cursor = parent;
    }
    return join(process.cwd(), 'apps', 'desktop', 'resources', 'llama', LLAMA_SERVER_EXECUTABLE);
}
/**
 * Build the exact argv one start spawns with (ported from desktop
 * `llamaServerArgs`): `-c` is the operator's context window, `-t`/`-tb`
 * share one thread count, `-b 2048`/`-ub 512` are the batch sizes the
 * CPU build is qualified with, `--alias` publishes the model id,
 * `--jinja` enables the GGUF's chat template, and `-ngl` is the
 * resolved GPU offload (see {@link resolveGpuOffload}; the desktop
 * original hardcoded `0` for its GPU-less host). A model with a vision
 * projector companion adds `--mmproj` right after `-m`.
 * @param input - model, limits, the loopback port, and the resolved GPU layer count.
 * @returns the argv, in the fixed desktop order.
 */
export function llamaServerArgs(input) {
    return [
        '-m', input.modelPath,
        ...input.mmprojPath === undefined ? [] : ['--mmproj', input.mmprojPath],
        '--alias', input.modelId,
        '-c', String(input.contextLength),
        '-t', String(input.threads),
        '-tb', String(input.threads),
        '-b', '2048',
        '-ub', '512',
        '--host', LLAMA_SERVER_LOOPBACK,
        '--port', String(input.port),
        '--jinja',
        '-ngl', String(input.gpuLayers ?? 0),
    ];
}
/**
 * @param baseUrl - an OpenAI-compatible base URL.
 * @returns the loopback port it names, or undefined when it carries none.
 */
function portOfBaseUrl(baseUrl) {
    if (baseUrl === undefined)
        return undefined;
    try {
        const port = Number(new URL(baseUrl).port);
        return Number.isSafeInteger(port) && port > 0 ? port : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * @returns a free loopback port, allocated by binding port 0 and closing.
 */
function allocateFreePort() {
    return new Promise((resolvePort, rejectPort) => {
        const server = createServer();
        server.once('error', rejectPort);
        server.listen(0, LLAMA_SERVER_LOOPBACK, () => {
            const address = server.address();
            const port = typeof address === 'object' && address !== null ? address.port : 0;
            server.close(() => { resolvePort(port); });
        });
    });
}
/**
 * Per-directory serialization queue. Every mutating operation on
 * `server-state.json` (start, stop, and the pid reconciliation they do)
 * runs under the mutex keyed by the models directory, so two
 * concurrent start/stop calls for the same directory cannot interleave
 * their reads-then-writes and orphan each other's spawned child.
 * Directory-keyed because different models directories are genuinely
 * independent hosts.
 */
const directoryQueues = new Map();
/**
 * Run `operation` while holding the mutex for `directory`. Cancellation
 * of the operation does not release the mutex until the operation
 * settles (dispose must reach quiescence, not just request it).
 * @param directory - the models directory whose record is being mutated.
 * @param operation - the mutation to serialize.
 * @returns the operation's outcome.
 */
async function withDirectoryMutex(directory, operation) {
    const previous = directoryQueues.get(directory) ?? Promise.resolve();
    let release;
    const gate = new Promise(resolveGate => { release = resolveGate; });
    // Chain the new work after whatever is already queued; store a
    // promise that settles when both this operation and the gate do, so
    // the next caller awaits this one's completion.
    const next = previous.then(() => gate);
    directoryQueues.set(directory, next);
    // Wait our turn; previous rejections must not skip subsequent callers.
    await previous.catch(() => undefined);
    try {
        return await operation();
    }
    finally {
        release();
        // Trim the map: if nothing got queued behind us, drop the entry.
        if (directoryQueues.get(directory) === next)
            directoryQueues.delete(directory);
    }
}
/**
 * Collect every pid a state record lists (primary `pid` then any
 * `previousPids`) without duplicates, in termination order.
 * @param state - the published server state to read pids from.
 * @returns the recorded pids, primary first.
 */
function recordedStatePids(state) {
    if (state === undefined)
        return [];
    const pids = [];
    if (state.pid !== undefined)
        pids.push(state.pid);
    if (state.previousPids !== undefined) {
        for (const pid of state.previousPids) {
            if (!pids.includes(pid))
                pids.push(pid);
        }
    }
    return pids;
}
/**
 * Terminate every pid a state record lists (primary `pid` then any
 * `previousPids`), awaiting each exit. A pid that already does not
 * exist is skipped by {@link terminateProcess} itself.
 * @param pids - the pids to terminate, in termination order.
 */
async function terminateRecordedPids(pids) {
    for (const pid of pids)
        await terminateProcess(pid);
}
/**
 * Terminate every recorded pid in `state` that this host can account
 * for, awaiting each exit. Used to drain orphan bookkeeping before a
 * state transition replaces the record.
 * @param state - the published server state whose pids should be drained.
 */
async function drainRecordedStatePids(state) {
    const pids = recordedStatePids(state);
    if (pids.length === 0)
        return;
    await terminateRecordedPids(pids.filter(pid => processExists(pid)));
}
/**
 * @param pid - the process id to test.
 * @returns whether a process with that pid currently exists.
 */
function processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        // ESRCH is absence; EPERM still proves the process exists.
        return error.code === 'EPERM';
    }
}
/**
 * Pause for one readiness or exit poll interval.
 * @param ms - the pause, in milliseconds.
 * @returns after the pause.
 */
function sleep(ms) {
    return new Promise(resolveSleep => { setTimeout(resolveSleep, ms); });
}
/**
 * Terminate one recorded server process: `SIGTERM` first, `SIGKILL`
 * after the exit deadline (desktop `LLAMA_EXIT_TIMEOUT_MS` per signal),
 * always resolving unless the process survives both.
 * @param pid - the server process to terminate.
 */
async function terminateProcess(pid) {
    if (!processExists(pid))
        return;
    process.kill(pid, 'SIGTERM');
    const termDeadline = Date.now() + 5_000;
    while (processExists(pid) && Date.now() < termDeadline)
        await sleep(50);
    if (!processExists(pid))
        return;
    process.kill(pid, 'SIGKILL');
    const killDeadline = Date.now() + 5_000;
    while (processExists(pid) && Date.now() < killDeadline)
        await sleep(50);
    if (processExists(pid))
        throw new Error(`llama-server process ${String(pid)} did not exit after SIGKILL`);
}
/**
 * Ask the server whether it finished loading its model (desktop
 * readiness): `/health` on the origin answers 503 while the weights
 * load, so a non-OK health response falls through to the models route;
 * either route answering OK means the server is serving.
 * @param deps - host seams.
 * @param baseUrl - the server's OpenAI-compatible base URL.
 * @returns whether a readiness route answered successfully.
 */
async function probeReady(deps, baseUrl) {
    const origin = baseUrl.replace(/\/v1$/, '');
    const timeoutMs = deps.probeTimeoutMs ?? LLAMA_PROBE_TIMEOUT_MS;
    for (const url of [`${origin}/health`, `${baseUrl}/models`]) {
        try {
            const response = await deps.fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
            if (response.ok)
                return true;
        }
        catch {
            // The server has not bound its port yet; the readiness deadline decides when to give up.
        }
    }
    return false;
}
/**
 * Start the host's llama-server serving one registry model, ported from
 * the desktop supervisor's start: when the published state already
 * names a live server for this model (confirmed by probing it), that
 * server is the result and nothing is spawned; a live server for a
 * different model that this host started is stopped first, and one it
 * did not start is an honest failure. Otherwise the binary is spawned
 * detached with its output in the store's log file, server-state.json
 * tracks `starting` → `running` (or `error`), and the start resolves
 * only once a readiness probe answers. The spawn's GPU offload comes
 * from {@link resolveGpuOffload}; a GPU spawn that dies inside the
 * readiness window with a GPU memory failure in its log is retried
 * once on the CPU, and the result then reports `fellBackToCpu`.
 * @param deps - host seams.
 * @param model - the registry model to serve (id, GGUF path, companion).
 * @returns the running server's endpoint and the offload it serves with.
 */
export async function startLlamaServer(deps, model) {
    return withDirectoryMutex(deps.directory, () => startLlamaServerLocked(deps, model));
}
/**
 * The serialized body of {@link startLlamaServer}; sees the directory
 * mutex as held for the whole read-decide-spawn-publish sequence.
 * @param deps - host seams.
 * @param model - the registry model to serve.
 * @returns the running server's endpoint and the offload it serves with.
 */
async function startLlamaServerLocked(deps, model) {
    const environment = deps.environment ?? process.env;
    const current = readLocalServerState(deps.directory);
    let recordedPort = portOfBaseUrl(current?.baseUrl);
    if (current?.status === 'running' && current.baseUrl !== undefined && current.baseUrl !== '') {
        const served = await probeLlamaEndpoint(deps.fetchImpl, current.baseUrl, deps.probeTimeoutMs ?? LLAMA_PROBE_TIMEOUT_MS);
        if (served !== null) {
            if (current.modelId === model.id || served.includes(model.id)) {
                // Reconcile any orphan pids the record still carries before
                // returning the already-serving endpoint as the result: the
                // caller must not believe "unloaded" about a child that is
                // still alive.
                if (current.previousPids !== undefined) {
                    const stale = current.previousPids.filter(pid => processExists(pid));
                    await terminateRecordedPids(stale);
                    writeLocalServerState(deps.directory, {
                        status: 'running',
                        baseUrl: current.baseUrl,
                        ...current.modelId === undefined ? {} : { modelId: current.modelId },
                        ...current.pid === undefined ? {} : { pid: current.pid },
                    });
                }
                return { baseUrl: current.baseUrl, ...current.pid === undefined ? {} : { pid: current.pid } };
            }
            if (current.pid === undefined) {
                throw new Error(`the local model server is already serving "${current.modelId ?? 'another model'}", and it was not started by this host `
                    + `(no pid is recorded in ${join(deps.directory, 'server-state.json')}), so this host cannot stop it; `
                    + `stop it where it was started, then start "${model.id}"`);
            }
            await stopLlamaServerLocked(deps);
        }
        else if (current.pid !== undefined && processExists(current.pid)) {
            // Our recorded server is alive but its endpoint does not answer:
            // it is wedged, so stop it and drain every recorded pid before
            // starting a replacement. Carrying previousPids forward here would
            // orphan them across the switch.
            await drainRecordedStatePids(current);
            writeLocalServerState(deps.directory, {
                status: 'stopped',
                ...current.modelId === undefined ? {} : { modelId: current.modelId },
            });
        }
        else if (current.previousPids !== undefined) {
            // The recorded endpoint is not answering and the primary pid is
            // absent or dead, but the state still carries previous pids.
            // Drain them before spawning a replacement so the bookkeeping does
            // not leak across this transition.
            await drainRecordedStatePids({ status: current.status, previousPids: current.previousPids });
            writeLocalServerState(deps.directory, {
                status: 'stopped',
                ...current.modelId === undefined ? {} : { modelId: current.modelId },
            });
        }
    }
    else if (current !== undefined && current.status === 'starting' && current.pid === undefined) {
        // A pid-less 'starting' record means an in-flight spawn's pid has
        // not been published and this host cannot safely identify or stop
        // it. Refusing here preserves honest ownership and avoids orphaning
        // that child by racing a second spawn over the same directory.
        throw new Error('the local model server is starting and its pid has not been published '
            + `(server-state.json in ${deps.directory} has no pid); wait for the start to settle, then start it again`);
    }
    else if (current !== undefined && current.status !== 'starting' && current.previousPids !== undefined) {
        // Non-running (stopped/error) records may still carry orphan
        // previousPids; drain them before a new start reuses this directory.
        await drainRecordedStatePids({ status: current.status, previousPids: current.previousPids });
        writeLocalServerState(deps.directory, {
            status: current.status,
            ...current.baseUrl === undefined ? {} : { baseUrl: current.baseUrl },
            ...current.modelId === undefined ? {} : { modelId: current.modelId },
            ...current.pid === undefined ? {} : { pid: current.pid },
        });
    }
    else if (current?.status === 'starting' && current.pid !== undefined) {
        // A starting record with a pid: this host owns the in-flight start;
        // drain all recorded pids before replacing it with a new spawn.
        await drainRecordedStatePids(current);
        writeLocalServerState(deps.directory, {
            status: 'stopped',
            ...current.modelId === undefined ? {} : { modelId: current.modelId },
        });
    }
    const binary = resolveLlamaServerBinary(environment, deps.binary);
    if (!existsSync(binary)) {
        const recorded = readLocalServerState(deps.directory);
        if (recorded?.previousPids !== undefined) {
            await drainRecordedStatePids({ status: recorded.status, previousPids: recorded.previousPids });
            writeLocalServerState(deps.directory, {
                status: recorded.status,
                ...recorded.baseUrl === undefined ? {} : { baseUrl: recorded.baseUrl },
                ...recorded.modelId === undefined ? {} : { modelId: recorded.modelId },
                ...recorded.pid === undefined ? {} : { pid: recorded.pid },
            });
        }
        throw new Error(`llama-server binary not found at ${binary}; set ${LLAMA_SERVER_BIN_ENV} to the bundled server, `
            + 'or run this host from the app tree that carries apps/desktop/resources/llama');
    }
    const port = recordedPort ?? await allocateFreePort();
    recordedPort = port;
    const baseUrl = `http://${LLAMA_SERVER_LOOPBACK}:${String(port)}/v1`;
    const settings = readLlamaStoreSettings(deps.directory);
    const contextLength = resolveEffectiveLlamaContextLength(settings.persistedContextLength, readGgufContextLength(model.path));
    const logPath = join(deps.directory, LLAMA_SERVER_LOG_FILENAME);
    let offload;
    if (settings.gpuLayers !== undefined) {
        offload = resolveGpuOffload({ settingsGpuLayers: settings.gpuLayers, modelSizeBytes: 0, gpus: [] });
    }
    else {
        const modelSizeBytes = await stat(model.path).then(fileStat => fileStat.size).catch(() => 0);
        const gpus = await (deps.gpuQueryImpl ?? queryNvidiaGpus)();
        offload = resolveGpuOffload({ modelSizeBytes, gpus });
    }
    /**
     * Spawn the server once with one resolved offload and wait out its
     * readiness window.
     * @param plan - the offload this attempt spawns with.
     * @returns the attempt's outcome: readiness, liveness, and spawn failure.
     */
    const attempt = async (plan) => {
        const args = llamaServerArgs({
            modelPath: model.path,
            ...model.companionPath === undefined ? {} : { mmprojPath: model.companionPath },
            modelId: model.id,
            contextLength,
            threads: settings.threads,
            port,
            gpuLayers: plan.gpuLayers,
        });
        const logOffset = await stat(logPath).then(fileStat => fileStat.size).catch(() => 0);
        const logFd = openSync(logPath, 'a');
        let child;
        try {
            child = (deps.spawnImpl ?? spawn)(binary, args, {
                cwd: dirname(binary),
                detached: true,
                stdio: ['ignore', logFd, logFd],
                ...plan.gpuIndex === undefined
                    ? {}
                    : { env: { ...environment, CUDA_VISIBLE_DEVICES: String(plan.gpuIndex) } },
            });
        }
        catch (error) {
            const recorded = readLocalServerState(deps.directory);
            await drainRecordedStatePids({ status: 'error', previousPids: recorded?.previousPids });
            writeLocalServerState(deps.directory, { status: 'error', modelId: model.id });
            throw new Error(`llama-server could not be spawned: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            closeSync(logFd);
        }
        const pid = child.pid;
        let exited = false;
        let spawnError;
        child.once('exit', () => { exited = true; });
        child.on('error', (error) => { spawnError = error; exited = true; });
        // Publish the spawned pid ATOMICALLY with the 'starting' status and
        // BEFORE any readiness polling, so no concurrent reader ever sees
        // 'starting' with no pid for a server that has actually been
        // spawned. That is the window the leak trace exploited: the pid-less
        // 'starting' record made the switch's stop fall through to a
        // 'stopped' write and orphan the child.
        writeLocalServerState(deps.directory, {
            status: 'starting',
            baseUrl,
            modelId: model.id,
            ...pid === undefined ? {} : { pid },
        });
        const deadline = Date.now() + (deps.readyTimeoutMs ?? LLAMA_READY_TIMEOUT_MS);
        let ready = false;
        while (Date.now() < deadline) {
            if (exited)
                break;
            if (await probeReady(deps, baseUrl)) {
                ready = true;
                break;
            }
            await sleep(READY_POLL_INTERVAL_MS);
        }
        if (!ready && pid !== undefined && processExists(pid)) {
            await terminateProcess(pid).catch(() => undefined);
        }
        if (ready)
            child.unref();
        return {
            ready,
            exited,
            ...pid === undefined ? {} : { pid },
            ...spawnError === undefined ? {} : { spawnError },
            logOffset,
        };
    };
    let outcome = await attempt(offload);
    let fellBackToCpu = false;
    if (!outcome.ready && outcome.exited && offload.gpuLayers !== 0
        && serverLogShowsGpuOom(logPath, outcome.logOffset)) {
        // The GPU spawn died on GPU memory inside its readiness window:
        // retry exactly once on the CPU, and say so in the result.
        offload = { gpuLayers: 0 };
        outcome = await attempt(offload);
        fellBackToCpu = outcome.ready;
    }
    if (!outcome.ready) {
        const recorded = readLocalServerState(deps.directory);
        await drainRecordedStatePids({ status: 'error', previousPids: recorded?.previousPids });
        writeLocalServerState(deps.directory, { status: 'error', modelId: model.id });
        throw new Error(outcome.spawnError !== undefined
            ? `llama-server could not be started: ${outcome.spawnError.message}`
            : outcome.exited
                ? `llama-server exited before it became ready (log: ${logPath})`
                : `llama-server was still loading after ${String(deps.readyTimeoutMs ?? LLAMA_READY_TIMEOUT_MS)}ms (log: ${logPath})`);
    }
    const running = {
        status: 'running',
        baseUrl,
        modelId: model.id,
        ...outcome.pid === undefined ? {} : { pid: outcome.pid },
    };
    writeLocalServerState(deps.directory, running);
    return {
        baseUrl,
        ...outcome.pid === undefined ? {} : { pid: outcome.pid },
        gpuLayers: offload.gpuLayers,
        ...offload.gpuIndex === undefined ? {} : { gpuIndex: offload.gpuIndex },
        ...fellBackToCpu ? { fellBackToCpu: true } : {},
    };
}
/**
 * Stop the server server-state.json records: a server this host started
 * (a pid is recorded) is terminated and its exit verified; a recorded
 * server whose endpoint no longer answers is already stopped, and the
 * document is corrected to say so; a live server this host did not
 * start is an honest failure, because this host cannot stop what it
 * does not own. The document ends at `stopped` on every success.
 * @param deps - host seams.
 */
export async function stopLlamaServer(deps) {
    return withDirectoryMutex(deps.directory, () => stopLlamaServerLocked(deps));
}
/**
 * Serialized body of {@link stopLlamaServer}; sees the directory mutex
 * as held. Terminates every pid the record lists, awaits each exit,
 * and only then publishes 'stopped'. A record with no pid AND a live
 * endpoint remains an honest failure; a record in 'starting' whose
 * spawned child is not yet recorded is re-read after the ready poll
 * settles (the mutex guarantees no other start is between).
 * @param deps - host seams.
 */
async function stopLlamaServerLocked(deps) {
    const current = readLocalServerState(deps.directory);
    if (current === undefined)
        return;
    if (current.status === 'stopped') {
        // Even a stopped record may carry orphan previousPids: drain them
        // and clear the bookkeeping so the state reflects that nothing is
        // left to terminate.
        if (current.previousPids !== undefined) {
            await drainRecordedStatePids({ status: 'stopped', previousPids: current.previousPids });
            writeLocalServerState(deps.directory, {
                status: 'stopped',
                ...current.modelId === undefined ? {} : { modelId: current.modelId },
            });
        }
        return;
    }
    // A 'starting' record may name a pid that was published before
    // readiness, or a pid-less document from an in-flight spawn that has
    // not been published yet. The directory mutex means no other start
    // is inside startLlamaServerLocked right now, so a brief re-read
    // after termination of any pids will see the settled document.
    if (current.pid !== undefined) {
        await drainRecordedStatePids(current);
        writeLocalServerState(deps.directory, {
            status: 'stopped',
            ...current.modelId === undefined ? {} : { modelId: current.modelId },
        });
        return;
    }
    if (current.status === 'running' && current.baseUrl !== undefined && current.baseUrl !== '') {
        const served = await probeLlamaEndpoint(deps.fetchImpl, current.baseUrl, deps.probeTimeoutMs ?? LLAMA_PROBE_TIMEOUT_MS);
        if (served !== null) {
            throw new Error('the local model server is running but was not started by this host '
                + `(no pid is recorded in ${join(deps.directory, 'server-state.json')}), so this host cannot stop it; `
                + 'stop it where it was started');
        }
    }
    // A pid-less record that is 'starting' or 'error' with no answering
    // endpoint: this is the window in which the previous spawn's pid was
    // lost mid-write. Do NOT publish 'stopped': a future start would then
    // spawn a second server while the lost child is (or was) alive. Instead
    // fail honestly so the caller knows the record is inconsistent.
    if (current.status === 'starting') {
        throw new Error('the local model server is starting and its pid has not been published '
            + `(server-state.json in ${deps.directory} has no pid); wait for the start to settle, then stop it`);
    }
    // A pid-less non-starting record (e.g. error or a dead running record)
    // may still carry recorded orphan previousPids that this host started.
    // Drain them and clear the bookkeeping before publishing stopped.
    if (current.previousPids !== undefined) {
        await drainRecordedStatePids({ status: current.status, previousPids: current.previousPids });
    }
    writeLocalServerState(deps.directory, {
        status: 'stopped',
        ...current.modelId === undefined ? {} : { modelId: current.modelId },
    });
}
