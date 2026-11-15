/**
 * The desktop's local-model state documents, read from the models directory
 * the desktop app owns. The desktop (Electron main) downloads GGUF models
 * into that directory (`registry.json`), records the operator's pick and
 * server settings in `settings.json`, and publishes the bundled
 * llama-server's live state to `server-state.json` on every transition
 * (schema owned by `apps/desktop/src/llama-server-state.ts`). The Host is a
 * separate process, so these documents are its only window onto that state;
 * every read here is fail-soft, mirroring the runner's
 * `apps/redteam-runner/src/ui/local-model.ts`: a missing or unusable
 * document resolves to absence, never to a thrown error, so a machine
 * without local models simply has no local catalog entries.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
/** Environment name that overrides the local models directory. */
export const LOCAL_MODELS_DIR_ENV = 'DSH_LOCAL_MODELS_DIR';
/** File name of the downloaded-model registry inside the models directory. */
export const REGISTRY_FILENAME = 'registry.json';
/** File name of the local-model settings document inside the models directory. */
export const SETTINGS_FILENAME = 'settings.json';
/** File name of the published llama-server state document inside the models directory. */
export const SERVER_STATE_FILENAME = 'server-state.json';
/** On-disk server-state schema version the desktop publishes. */
const SERVER_STATE_VERSION = 1;
/**
 * Largest context length a set may persist, mirroring the desktop
 * settings bound `llama.ts` clamps the llama server's `-c` to
 * (`CONTEXT_LENGTH_MAX` there). A set above a model's own known
 * maximum is rejected against that maximum first; this is the ceiling
 * when no per-model maximum is known.
 */
export const LOCAL_MODEL_CONTEXT_LENGTH_MAX = 262144;
/** Smallest context length the llama server accepts (the desktop settings bound `llama.ts` clamps `-c` to). */
export const LOCAL_MODEL_CONTEXT_LENGTH_MIN_LLAMA = 1024;
const SERVER_STATUSES = ['stopped', 'starting', 'running', 'error'];
/**
 * Resolve the directory holding the desktop's downloaded models and its
 * state documents. Mirrors the desktop's `resolveModelsDirectory` and the
 * runner's `resolveLocalModelsDirectory`: an explicit override wins, then
 * `DSH_LOCAL_MODELS_DIR`, then `%LOCALAPPDATA%\SecScan Red Team\models` on
 * Windows, then `~/.secscan-redteam/models`.
 * @param environment - environment to read (defaults to `process.env`).
 * @param override - explicit directory from plugin configuration, when set.
 * @returns absolute models directory.
 */
export function resolveLocalModelsDirectory(environment = process.env, override) {
    const configured = override?.trim();
    if (configured !== undefined && configured !== '')
        return resolve(configured);
    const fromEnvironment = environment[LOCAL_MODELS_DIR_ENV]?.trim();
    if (fromEnvironment !== undefined && fromEnvironment !== '')
        return resolve(fromEnvironment);
    if (process.platform === 'win32') {
        const localAppData = environment['LOCALAPPDATA']?.trim();
        if (localAppData !== undefined && localAppData !== '') {
            return join(localAppData, 'SecScan Red Team', 'models');
        }
    }
    return join(homedir(), '.secscan-redteam', 'models');
}
/**
 * Read one JSON document, tolerating a missing or unparseable file.
 * @param path - absolute document path.
 * @returns the parsed value as a record, or undefined when unusable.
 */
function readJsonDocument(path) {
    let raw;
    try {
        raw = readFileSync(path, 'utf8');
    }
    catch {
        // A missing document is the normal no-local-models state, not a failure.
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return undefined;
        return parsed;
    }
    catch {
        // A document mid-write or corrupt reads as absent; the next read retries.
        return undefined;
    }
}
/**
 * @param value - candidate document field.
 * @returns the value when it is a non-empty string.
 */
function nonEmptyString(value) {
    return typeof value === 'string' && value !== '' ? value : undefined;
}
/**
 * Read the registry, settings, and server-state documents of one models
 * directory. Every document is optional; absence narrows the result instead
 * of failing.
 * @param directory - absolute models directory.
 * @returns the directory state the catalog and the dispatch gate consume.
 */
export function readLocalModelsDirectory(directory) {
    const registry = readJsonDocument(join(directory, REGISTRY_FILENAME));
    const models = [];
    const entries = registry && Array.isArray(registry['models']) ? registry['models'] : [];
    for (const item of entries) {
        if (typeof item !== 'object' || item === null)
            continue;
        const entry = item;
        const id = nonEmptyString(entry['id']);
        const file = nonEmptyString(entry['file']);
        const path = nonEmptyString(entry['path']);
        if (id === undefined || file === undefined || path === undefined)
            continue;
        const repo = nonEmptyString(entry['repo']);
        const companionPath = nonEmptyString(entry['companionPath']);
        models.push({
            id,
            file,
            path,
            ...repo === undefined ? {} : { repo },
            ...companionPath === undefined ? {} : { companionPath },
        });
    }
    const settingsDocument = readJsonDocument(join(directory, SETTINGS_FILENAME));
    const activeModelId = settingsDocument ? nonEmptyString(settingsDocument['activeModelId']) : undefined;
    const rawContext = settingsDocument?.['contextLength'];
    const contextLength = typeof rawContext === 'number' && Number.isFinite(rawContext) && rawContext > 0
        ? Math.floor(rawContext)
        : undefined;
    const rawThreads = settingsDocument?.['threads'];
    const threads = typeof rawThreads === 'number' && Number.isFinite(rawThreads) && rawThreads > 0
        ? Math.floor(rawThreads)
        : undefined;
    const rawByModel = settingsDocument?.['contextLengthByModel'];
    const contextLengthByModel = {};
    if (typeof rawByModel === 'object' && rawByModel !== null && !Array.isArray(rawByModel)) {
        for (const [modelId, value] of Object.entries(rawByModel)) {
            if (modelId !== '' && typeof value === 'number' && Number.isFinite(value) && value > 0) {
                contextLengthByModel[modelId] = Math.floor(value);
            }
        }
    }
    const settings = {
        ...activeModelId === undefined ? {} : { activeModelId },
        ...contextLength === undefined ? {} : { contextLength },
        ...Object.keys(contextLengthByModel).length === 0 ? {} : { contextLengthByModel },
        ...threads === undefined ? {} : { threads },
    };
    return { directory, models, settings, server: readLocalServerState(directory) };
}
/**
 * Read and validate the published server-state document of one models
 * directory, applying the desktop reader's validation: schema version,
 * known status, finite write timestamp.
 * @param directory - absolute models directory.
 * @returns the published state, or undefined when there is nothing usable.
 */
export function readLocalServerState(directory) {
    const document = readJsonDocument(join(directory, SERVER_STATE_FILENAME));
    if (document === undefined || document['version'] !== SERVER_STATE_VERSION)
        return undefined;
    const status = document['status'];
    if (typeof status !== 'string' || !SERVER_STATUSES.includes(status))
        return undefined;
    const updatedAt = document['updatedAt'];
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt))
        return undefined;
    const baseUrl = document['baseUrl'];
    const modelId = document['modelId'];
    if (baseUrl !== undefined && typeof baseUrl !== 'string')
        return undefined;
    if (modelId !== undefined && typeof modelId !== 'string')
        return undefined;
    const pid = document['pid'];
    const validPid = typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
    const rawPrevious = document['previousPids'];
    const previousPids = Array.isArray(rawPrevious)
        ? rawPrevious
            .filter((value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
        : undefined;
    return {
        status: status,
        ...baseUrl === undefined ? {} : { baseUrl },
        ...modelId === undefined ? {} : { modelId },
        ...validPid === undefined ? {} : { pid: validPid },
        ...previousPids === undefined || previousPids.length === 0 ? {} : { previousPids },
    };
}
/**
 * Publish one server state into a models directory, replacing the
 * document atomically (same-directory temporary file plus rename, the
 * desktop writer's pattern in `llama-server-state.ts`), so a reader
 * never observes a partial document. The host writes this document for
 * the servers it starts and stops; the format is the desktop's
 * (version, status, baseUrl, modelId, updatedAt) plus the host's pid
 * extension.
 * @param directory - absolute models directory.
 * @param state - the server state to publish.
 */
export function writeLocalServerState(directory, state) {
    const document = {
        version: SERVER_STATE_VERSION,
        status: state.status,
        ...state.baseUrl === undefined ? {} : { baseUrl: state.baseUrl },
        ...state.modelId === undefined ? {} : { modelId: state.modelId },
        ...state.pid === undefined ? {} : { pid: state.pid },
        ...state.previousPids === undefined || state.previousPids.length === 0
            ? {}
            : { previousPids: state.previousPids },
        updatedAt: Date.now(),
    };
    const file = join(directory, SERVER_STATE_FILENAME);
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
        writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
        renameSync(temporary, file);
    }
    catch (error) {
        try {
            rmSync(temporary, { force: true });
        }
        catch {
            // Keep the original write error; the temporary name is unique and stale.
        }
        throw error;
    }
}
/**
 * Apply one update to a models directory's `settings.json`, preserving
 * every field this package does not own (the desktop's `version`,
 * `huggingFaceToken`, and any future fields ride through untouched),
 * and publish the result atomically — the same same-directory
 * temporary file plus rename {@link writeLocalServerState} uses, so a
 * reader never observes a partial document.
 * @param directory - absolute models directory.
 * @param update - the fields to set or clear.
 */
export function writeLocalModelsSettings(directory, update) {
    const document = { ...readJsonDocument(join(directory, SETTINGS_FILENAME)) ?? {} };
    if (update.contextLength !== undefined) {
        if (update.contextLength === null)
            delete document['contextLength'];
        else
            document['contextLength'] = update.contextLength;
    }
    if (update.contextLengthByModel !== undefined) {
        const existing = document['contextLengthByModel'];
        const byModel = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
            ? { ...existing }
            : {};
        for (const [modelId, value] of Object.entries(update.contextLengthByModel)) {
            if (value === null)
                delete byModel[modelId];
            else
                byModel[modelId] = value;
        }
        if (Object.keys(byModel).length === 0)
            delete document['contextLengthByModel'];
        else
            document['contextLengthByModel'] = byModel;
    }
    const file = join(directory, SETTINGS_FILENAME);
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
        writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
        renameSync(temporary, file);
    }
    catch (error) {
        try {
            rmSync(temporary, { force: true });
        }
        catch {
            // Keep the original write error; the temporary name is unique and stale.
        }
        throw error;
    }
}
/**
 * The persisted context length one model starts with in Ollama mode,
 * in the precedence Start must honor: the operator's persisted
 * per-model value wins, then the adapter's construction (plugin
 * configuration) override, then the model's catalog maximum — the
 * default an unset model loads at.
 * @param persisted - the store's per-model value for the model, when set.
 * @param constructionOverride - the adapter construction override, when set.
 * @param catalogMaximum - the model's catalog maximum, when known.
 * @returns the context length to load with, or undefined when no source names one.
 */
export function resolveEffectiveOllamaContextLength(persisted, constructionOverride, catalogMaximum) {
    return persisted ?? constructionOverride ?? catalogMaximum;
}
/**
 * Decide whether a call for one model may dispatch to the bundled server.
 * The server serves one model at a time: a running state naming a different
 * model is a refusal with the served model named, not a dispatch the
 * endpoint would misroute.
 * @param server - the published server state, or undefined when absent.
 * @param modelId - the registry id the caller selected.
 * @returns the dispatch decision.
 */
export function resolveLocalDispatch(server, modelId) {
    if (server === undefined)
        return { kind: 'stopped' };
    switch (server.status) {
        case 'stopped':
            return { kind: 'stopped' };
        case 'starting':
            return { kind: 'starting' };
        case 'error':
            return { kind: 'error' };
        case 'running': {
            if (server.baseUrl === undefined || server.baseUrl === '')
                return { kind: 'error' };
            if (server.modelId !== undefined && server.modelId !== modelId) {
                return { kind: 'serving-other', servingModelId: server.modelId, baseUrl: server.baseUrl };
            }
            return { kind: 'ready', baseUrl: server.baseUrl };
        }
    }
}
/**
 * Picker label for one registry model: the GGUF file stem plus the local
 * marker, the same label the runner console's catalog builds.
 * @param model - the registry entry.
 * @returns the display name, e.g. `Qwen3.6-35B · Local`.
 */
export function localModelLabel(model) {
    return `${basename(model.file).replace(/\.gguf$/i, '')} · Local`;
}
/** The state documents whose changes can change the catalog or the gate. */
const WATCHED_FILENAMES = new Set([REGISTRY_FILENAME, SETTINGS_FILENAME, SERVER_STATE_FILENAME]);
/**
 * Watch the models directory and notify after its state documents change,
 * so a model downloaded or a server started after the Host booted still
 * reaches the catalog. Watches the directory itself when it exists and its
 * parent otherwise, re-arming when the target changes; notifications are
 * debounced and the watcher never throws into the caller.
 * @param directory - absolute models directory.
 * @param notify - called after a debounced change to a state document.
 * @param options - debounce and watcher seams.
 * @returns the disposer; calling it closes the watcher and cancels any pending notification.
 */
export function watchLocalModelsDirectory(directory, notify, options = {}) {
    const debounceMs = options.debounceMs ?? 300;
    const watchImpl = options.watchImpl ?? ((path) => watch(path));
    let watcher;
    let watchedPath;
    let timer;
    let closed = false;
    const schedule = () => {
        if (timer !== undefined)
            clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            if (!closed)
                notify();
        }, debounceMs);
    };
    const arm = () => {
        const target = existsSync(directory) ? directory : dirname(directory);
        if (watcher !== undefined && watchedPath === target)
            return;
        watcher?.close();
        watcher = undefined;
        watchedPath = undefined;
        try {
            watcher = watchImpl(target);
            watchedPath = target;
            watcher.on('change', (_event, filename) => {
                if (closed)
                    return;
                const name = typeof filename === 'string' ? filename : filename.toString();
                if (watchedPath === directory && name !== '' && !WATCHED_FILENAMES.has(name))
                    return;
                schedule();
                arm();
            });
            watcher.on('error', () => { });
        }
        catch {
            // Watching is a refresh convenience: an unwatcheable directory still
            // reads correctly on every catalog load, so absence stays silent.
            watcher = undefined;
            watchedPath = undefined;
        }
    };
    arm();
    return () => {
        closed = true;
        if (timer !== undefined)
            clearTimeout(timer);
        watcher?.close();
        watcher = undefined;
    };
}
