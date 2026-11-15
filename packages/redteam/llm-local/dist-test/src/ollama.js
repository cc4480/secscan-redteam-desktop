/**
 * Ollama serving mode for the local provider: the catalog, context, and
 * status facts read from a host Ollama endpoint instead of the desktop's
 * state documents. Ollama serves an OpenAI-compatible API under `/v1`
 * (the adapter's wire code already speaks it) and its native API at the
 * host root (`/api/ps` for what is loaded, `/api/tags` for the library).
 * Every read here goes through the caller's fetch seam; the catalog read
 * (`/v1/models`) fails loud, while the enrichment reads (`/api/ps`,
 * `/api/tags`) fail soft to absence, because a model list without load
 * state is still a usable catalog.
 */
/** Environment name that overrides the local serving mode. */
export const LOCAL_MODELS_SERVING_ENV = 'DSH_LOCAL_MODELS_SERVING';
/** Default OpenAI-compatible base URL of a host Ollama endpoint. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
/** Default interval between Ollama catalog probes, in milliseconds. */
export const DEFAULT_OLLAMA_PROBE_INTERVAL_MS = 5000;
/**
 * Context window assumed for an Ollama model that is not loaded and has
 * no configured override: Ollama's own default allocation when it loads
 * a model. The model's maximum (what `/api/tags` and `/api/show` report)
 * is never used as the window — a request budgeted against the maximum
 * overflows the much smaller runtime allocation.
 */
export const OLLAMA_DEFAULT_CONTEXT_WINDOW = 4096;
/**
 * Resolve the serving mode: the environment override wins (deployment
 * flips the mode without editing bundle configuration), then the plugin
 * configuration, then the desktop default.
 * @param environment - environment to read (defaults to `process.env`).
 * @param configured - mode from plugin configuration, when set.
 * @returns the serving mode.
 */
export function resolveServingMode(environment = process.env, configured) {
    const fromEnvironment = environment[LOCAL_MODELS_SERVING_ENV]?.trim();
    if (fromEnvironment === 'ollama' || fromEnvironment === 'llama')
        return fromEnvironment;
    return configured ?? 'llama';
}
/**
 * Derive Ollama's native API root from its OpenAI-compatible base URL:
 * the native API lives beside `/v1`, not under it.
 * @param baseUrl - the OpenAI-compatible base URL (no trailing slash).
 * @returns the native API root, e.g. `http://127.0.0.1:11434`.
 */
export function ollamaNativeBaseUrl(baseUrl) {
    return baseUrl.replace(/\/v1$/, '');
}
/**
 * @param value - candidate document field.
 * @returns the value when it is a positive finite number, floored.
 */
function positiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
/**
 * @param value - candidate document field.
 * @returns the value when it is a non-empty string.
 */
function nonEmptyString(value) {
    return typeof value === 'string' && value !== '' ? value : undefined;
}
/**
 * Read one JSON document from the endpoint, tolerating any failure.
 * @param fetchImpl - the fetch seam.
 * @param url - the document URL.
 * @returns the parsed record, or undefined when the read failed or the body was unusable.
 */
async function readJsonSoft(fetchImpl, url) {
    try {
        const response = await fetchImpl(url);
        if (!response.ok)
            return undefined;
        const parsed = await response.json();
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return undefined;
        return parsed;
    }
    catch {
        // Enrichment reads fail soft: absence narrows the result, never fails it.
        return undefined;
    }
}
/**
 * Probe the Ollama endpoint once: the model ids it serves (`/v1/models`),
 * what is loaded (`/api/ps`), and the library facts (`/api/tags`). The
 * `/v1/models` read is the catalog itself, so its failure throws; the
 * other two reads fail soft.
 * @param fetchImpl - the fetch seam.
 * @param baseUrl - the OpenAI-compatible base URL (no trailing slash).
 * @returns the catalog snapshot.
 */
export async function fetchOllamaCatalog(fetchImpl, baseUrl) {
    const response = await fetchImpl(`${baseUrl}/models`);
    if (!response.ok)
        throw new Error(`Ollama answered HTTP ${response.status} for its model list`);
    const parsed = await response.json();
    const data = typeof parsed === 'object' && parsed !== null && Array.isArray(parsed['data'])
        ? parsed['data']
        : [];
    const ids = [];
    for (const item of data) {
        if (typeof item !== 'object' || item === null)
            continue;
        const id = nonEmptyString(item['id']);
        if (id !== undefined && !ids.includes(id))
            ids.push(id);
    }
    const nativeBase = ollamaNativeBaseUrl(baseUrl);
    const [ps, tags] = await Promise.all([
        readJsonSoft(fetchImpl, `${nativeBase}/api/ps`),
        readJsonSoft(fetchImpl, `${nativeBase}/api/tags`),
    ]);
    const loaded = [];
    const psModels = ps !== undefined && Array.isArray(ps['models']) ? ps['models'] : [];
    for (const item of psModels) {
        if (typeof item !== 'object' || item === null)
            continue;
        const entry = item;
        const name = nonEmptyString(entry['name']) ?? nonEmptyString(entry['model']);
        if (name === undefined)
            continue;
        const contextLength = positiveNumber(entry['context_length']);
        const sizeVram = positiveNumber(entry['size_vram']);
        loaded.push({
            name,
            ...contextLength === undefined ? {} : { contextLength },
            ...sizeVram === undefined ? {} : { sizeVram },
        });
    }
    const tagModels = [];
    const tagEntries = tags !== undefined && Array.isArray(tags['models']) ? tags['models'] : [];
    for (const item of tagEntries) {
        if (typeof item !== 'object' || item === null)
            continue;
        const entry = item;
        const id = nonEmptyString(entry['name']) ?? nonEmptyString(entry['model']);
        if (id === undefined)
            continue;
        const details = typeof entry['details'] === 'object' && entry['details'] !== null
            ? entry['details']
            : undefined;
        const maxContextLength = details === undefined ? undefined : positiveNumber(details['context_length']);
        tagModels.push({ id, ...maxContextLength === undefined ? {} : { maxContextLength } });
    }
    return { ids, loaded, tags: tagModels };
}
/**
 * Resolve one Ollama model's context window, in the order that keeps the
 * number honest: the runtime allocation `/api/ps` reports while the model
 * is loaded, then the operator's configured override, then Ollama's
 * default allocation. The model's maximum is never the window.
 * @param loaded - the model's `/api/ps` entry, when it is loaded.
 * @param configuredOverride - the plugin configuration's `contextWindow`, when set.
 * @returns the context window to resolve the model with.
 */
export function resolveOllamaContextWindow(loaded, configuredOverride) {
    if (loaded?.contextLength !== undefined)
        return loaded.contextLength;
    if (configuredOverride !== undefined)
        return configuredOverride;
    return OLLAMA_DEFAULT_CONTEXT_WINDOW;
}
/**
 * Reduce one catalog snapshot to a comparable key: the served id set plus
 * each loaded model's name and runtime context, so a model loading or
 * unloading (which changes its resolved context) also changes the key.
 * @param snapshot - the catalog snapshot.
 * @returns the snapshot key.
 */
export function ollamaCatalogKey(snapshot) {
    const loaded = snapshot.loaded
        .map(entry => `${entry.name}@${entry.contextLength ?? ''}`)
        .sort()
        .join(',');
    return `${snapshot.ids.join(',')}|${loaded}`;
}
/**
 * Poll one catalog probe and notify when its key changes, mirroring the
 * models-directory watcher's role for the llama mode: the first probe
 * sets the baseline silently, later changes (models appearing, loading,
 * or unloading) notify, and a failing probe reads as its own key so an
 * endpoint going down or coming back also notifies once.
 * @param probe - returns the current catalog key; may reject.
 * @param notify - called after the key changes from the last observed value.
 * @param options - the probe interval.
 * @returns the disposer; calling it stops the poller.
 */
export function watchOllamaCatalog(probe, notify, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_OLLAMA_PROBE_INTERVAL_MS;
    let lastKey;
    let closed = false;
    let probing = false;
    const runProbe = async () => {
        if (closed || probing)
            return;
        probing = true;
        try {
            const key = await probe();
            if (closed)
                return;
            if (lastKey === undefined) {
                lastKey = key;
            }
            else if (key !== lastKey) {
                lastKey = key;
                notify();
            }
        }
        catch {
            // A failed probe carries no catalog fact; the next interval retries.
        }
        finally {
            probing = false;
        }
    };
    void runProbe();
    const timer = setInterval(() => { void runProbe(); }, intervalMs);
    timer.unref?.();
    return () => {
        closed = true;
        clearInterval(timer);
    };
}
/**
 * The `keep_alive` value that holds a model in memory until it is
 * explicitly unloaded: Ollama's keep-indefinitely setting, the native
 * counterpart of the desktop's server running until it is stopped.
 */
const OLLAMA_KEEP_LOADED = -1;
/**
 * Send one JSON body to a native action endpoint, failing loud:
 * transport failures propagate and non-OK answers throw with the
 * endpoint's own detail (truncated) in the message. Action endpoints
 * never fail soft — a lifecycle action that did not happen must read
 * as a failure, never as an absence.
 * @param fetchImpl - the fetch seam.
 * @param url - the native API URL.
 * @param method - the HTTP method.
 * @param body - the JSON body to send.
 */
async function postOllamaAction(fetchImpl, url, method, body) {
    const response = await fetchImpl(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 500);
        throw new Error(`Ollama answered HTTP ${response.status} for ${method} ${url}${detail === '' ? '' : `: ${detail}`}`);
    }
}
/**
 * Read the names of the models Ollama currently has loaded, failing
 * loud: lifecycle actions verify their outcome against this read, so a
 * soft absence would let a failed load or unload report success.
 * @param fetchImpl - the fetch seam.
 * @param baseUrl - the OpenAI-compatible base URL (no trailing slash).
 * @returns the loaded model names, verbatim.
 */
export async function fetchOllamaLoadedNames(fetchImpl, baseUrl) {
    const response = await fetchImpl(`${ollamaNativeBaseUrl(baseUrl)}/api/ps`);
    if (!response.ok)
        throw new Error(`Ollama answered HTTP ${response.status} for its loaded-model list`);
    const parsed = await response.json();
    const entries = typeof parsed === 'object' && parsed !== null && Array.isArray(parsed['models'])
        ? parsed['models']
        : [];
    const names = [];
    for (const item of entries) {
        if (typeof item !== 'object' || item === null)
            continue;
        const entry = item;
        const name = nonEmptyString(entry['name']) ?? nonEmptyString(entry['model']);
        if (name !== undefined)
            names.push(name);
    }
    return names;
}
/**
 * Load one model into Ollama's memory and hold it there: a generate
 * request with no prompt loads the model without generating, and
 * `keep_alive: -1` keeps it resident until it is explicitly unloaded —
 * the desktop's start-the-server semantics in Ollama's terms.
 * @param fetchImpl - the fetch seam.
 * @param baseUrl - the OpenAI-compatible base URL (no trailing slash).
 * @param modelId - the model to load, verbatim.
 * @param contextLength - the context allocation to load the model with:
 * its own maximum, or the operator's override when one is configured.
 * Ollama's default allocation (4096) applies only when this is unknown:
 * a load that knows the model's window must say so, or the model comes
 * up capped at the default.
 * @returns whether the loaded-model list reports the model afterwards;
 * the request being accepted is not proof the model is resident, so the
 * outcome is always this verified read.
 */
export async function loadOllamaModel(fetchImpl, baseUrl, modelId, contextLength) {
    await postOllamaAction(fetchImpl, `${ollamaNativeBaseUrl(baseUrl)}/api/generate`, 'POST', {
        model: modelId,
        prompt: '',
        stream: false,
        keep_alive: OLLAMA_KEEP_LOADED,
        ...contextLength === undefined ? {} : { options: { num_ctx: contextLength } },
    });
    return (await fetchOllamaLoadedNames(fetchImpl, baseUrl)).includes(modelId);
}
/**
 * Unload one model from Ollama's memory: a generate request with
 * `keep_alive: 0` evicts it immediately.
 * @param fetchImpl - the fetch seam.
 * @param baseUrl - the OpenAI-compatible base URL (no trailing slash).
 * @param modelId - the model to unload, verbatim.
 * @returns whether the loaded-model list still reports the model
 * afterwards — the verified outcome, never an assumption.
 */
export async function unloadOllamaModel(fetchImpl, baseUrl, modelId) {
    await postOllamaAction(fetchImpl, `${ollamaNativeBaseUrl(baseUrl)}/api/generate`, 'POST', {
        model: modelId,
        keep_alive: 0,
    });
    return (await fetchOllamaLoadedNames(fetchImpl, baseUrl)).includes(modelId);
}
/**
 * Delete one model from Ollama's library. A model the library does not
 * hold answers 404, which {@link postOllamaAction} surfaces as a failure
 * naming the status — deleting what is not there is never a silent
 * success.
 * @param fetchImpl - the fetch seam.
 * @param baseUrl - the OpenAI-compatible base URL (no trailing slash).
 * @param modelId - the model to delete, verbatim.
 */
export async function deleteOllamaModel(fetchImpl, baseUrl, modelId) {
    await postOllamaAction(fetchImpl, `${ollamaNativeBaseUrl(baseUrl)}/api/delete`, 'DELETE', { model: modelId });
}
/**
 * Pull one model, consuming the endpoint's progress stream to its end
 * and reporting each line's facts. Ollama streams newline-delimited
 * JSON: phase lines, per-layer `{status, digest, total, completed}`
 * lines, and a terminal `{"status":"success"}`. A failure can arrive as
 * an `{error}` line on an otherwise OK response or as a non-OK response
 * before the stream starts; both throw, as does a stream that ends
 * without reporting success.
 * @param fetchImpl - the fetch seam.
 * @param baseUrl - the OpenAI-compatible base URL (no trailing slash).
 * @param modelId - the model to pull, verbatim.
 * @param onProgress - called with each progress line's facts.
 */
export async function pullOllamaModel(fetchImpl, baseUrl, modelId, onProgress) {
    const response = await fetchImpl(`${ollamaNativeBaseUrl(baseUrl)}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelId, stream: true }),
    });
    if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 500);
        throw new Error(`Ollama answered HTTP ${response.status} for the pull of "${modelId}"${detail === '' ? '' : `: ${detail}`}`);
    }
    if (response.body === null)
        throw new Error(`Ollama returned no pull stream for "${modelId}"`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let succeeded = false;
    /**
     * Settle one newline-delimited pull line: report its progress facts,
     * remember the success line, and throw on an `{error}` line.
     * @param line - one raw stream line.
     */
    const handleLine = (line) => {
        const trimmed = line.trim();
        if (trimmed === '')
            return;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            // A malformed line carries no progress fact; the terminal state
            // of the stream still settles the pull.
            return;
        }
        if (typeof parsed !== 'object' || parsed === null)
            return;
        const record = parsed;
        const error = nonEmptyString(record['error']);
        if (error !== undefined)
            throw new Error(`Ollama's pull of "${modelId}" failed: ${error}`);
        const status = nonEmptyString(record['status']);
        if (status === 'success')
            succeeded = true;
        const completed = positiveNumber(record['completed']);
        const total = positiveNumber(record['total']);
        onProgress({
            ...status === undefined ? {} : { status },
            ...completed === undefined ? {} : { completedBytes: completed },
            ...total === undefined ? {} : { totalBytes: total },
        });
    };
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline !== -1) {
                handleLine(buffer.slice(0, newline));
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
            }
        }
        handleLine(buffer);
    }
    finally {
        reader.releaseLock();
    }
    if (!succeeded)
        throw new Error(`Ollama's pull stream for "${modelId}" ended without reporting success`);
}
