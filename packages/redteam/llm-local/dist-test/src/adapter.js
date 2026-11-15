/**
 * The `local` provider adapter: the desktop's downloaded GGUF models as a
 * first-class harness provider, wired the way every other provider is wired
 * — an {@link LlmAdapter} registered with `ctx.llm`, so the Host model
 * catalog (`session/modelCatalog`) lists it and session routing dispatches
 * through it.
 *
 * Catalog membership is a fact about the registry, not about the server:
 * a downloaded model is listed whether or not llama-server is currently
 * running. Dispatch is the gated half: a chat call never starts the
 * server itself, so a call that finds the server stopped, starting, or
 * failed fails with one honest error naming the exact in-app action —
 * the Local Models panel's Start action, which this same adapter
 * implements in llama mode (see `./llama.ts`) — rather than dispatching
 * to a dead endpoint or pretending success. A call that finds the
 * server serving a different downloaded model is routed to the served
 * model instead of dying, with the routing disclosed as the turn's
 * first text block so the record never credits the wrong model.
 *
 * In Ollama serving mode (see `./ollama.ts`) the same adapter sources its
 * catalog from a host Ollama endpoint instead: the registry and the
 * server state are bypassed (not deleted), dispatch posts to Ollama's
 * OpenAI-compatible API with no server-state gate, and a dead endpoint
 * fails with an error asking whether Ollama is running on the host.
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { attributionHeaders, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, LlmAdapter, LlmError, ToolCallId, } from '@deepseek-ai/dsh-llm';
import { localModelLabel, readLocalModelsDirectory, readLocalServerState, resolveEffectiveOllamaContextLength, resolveLocalDispatch, resolveLocalModelsDirectory, } from "./state.js";
import { downloadLlamaModel, LLAMA_PROBE_TIMEOUT_MS, probeLlamaEndpoint, readGgufContextLength, removeLlamaModel, startLlamaServer, stopLlamaServer, } from "./llama.js";
import { DEFAULT_OLLAMA_BASE_URL, deleteOllamaModel, fetchOllamaCatalog, loadOllamaModel, ollamaCatalogKey, pullOllamaModel, resolveOllamaContextWindow, resolveServingMode, unloadOllamaModel, } from "./ollama.js";
/** Provider route this adapter owns in the harness LLM registry. */
export const LOCAL_PROVIDER_ID = 'local';
/** Display name of the provider group in the model catalog. */
export const LOCAL_PROVIDER_NAME = 'Local';
/** The one in-app action every stopped-server error names. */
const START_ACTION = 'open Local Models and press "Start server"';
/** Settled pull jobs retained for late polls; older ones are dropped when a new pull starts. */
const MAX_SETTLED_PULL_JOBS = 8;
/**
 * Parse one llama-mode pull target: `owner/name` downloads the
 * repository's main GGUF; `owner/name/<file>` (the file may itself
 * contain `/` segments) downloads that exact file. Anything else —
 * including a registry id, which names a model already downloaded —
 * cannot start a Hugging Face download and fails loud.
 * @param target - the pull target the panel supplied, verbatim.
 * @returns the repository, and the exact file when one was named.
 */
function parseLlamaPullTarget(target) {
    const segments = target.split('/').filter(segment => segment !== '');
    if (segments.length === 2)
        return { repo: target };
    if (segments.length > 2) {
        return { repo: `${segments[0]}/${segments[1]}`, file: segments.slice(2).join('/') };
    }
    throw new LlmError(`Cannot download "${target}": in llama mode a download names a Hugging Face repository `
        + 'as owner/name, optionally followed by /<file.gguf>.', 'LOCAL_PULL_TARGET_INVALID');
}
/** Dispatch failure text for the desktop's bundled llama-server. */
const LLAMA_DISPATCH_TEXT = {
    unreachableCode: 'LOCAL_ENDPOINT_UNREACHABLE',
    unreachableRemedy: 'The server may have stopped; check Local Models in the app.',
    overflowAdvice: 'Raise the Context length in Local Models and restart the server, or start a new session.',
};
/** Dispatch failure text for a host Ollama endpoint. */
const OLLAMA_DISPATCH_TEXT = {
    unreachableCode: 'LOCAL_OLLAMA_UNREACHABLE',
    unreachableRemedy: 'Is Ollama running on the host? Start Ollama, then resend.',
    overflowAdvice: 'Raise the Ollama context length (num_ctx) for this model, or start a new session.',
};
/**
 * Read a signal's aborted state. A function call on purpose: the state
 * changes asynchronously while a request is in flight, so a direct
 * property check after an earlier one would be narrowed to a stale value.
 * @param signal - the request's cancellation signal, when one was supplied.
 * @returns whether the signal has aborted by now.
 */
function signalAborted(signal) {
    return signal?.aborted === true;
}
/**
 * Concatenate the text an endpoint can read from one message's blocks.
 * Non-text blocks become short bracketed stand-ins: the local route
 * declares text-only input, so request admission refuses images before
 * dispatch names this route, and a stand-in is only the defensive residue.
 * @param blocks - the message's content blocks.
 * @returns the concatenated text.
 */
function blockText(blocks) {
    const parts = [];
    for (const block of blocks) {
        switch (block.type) {
            case 'text':
                parts.push(block.text);
                break;
            case 'image':
                parts.push('[image attachment — not sent: the local model route is text-only]');
                break;
            case 'file':
                parts.push('[file attachment]');
                break;
            default:
                break;
        }
    }
    return parts.join('');
}
/**
 * Translate the harness request history into OpenAI-compatible messages.
 * System and developer text collapses into one leading system message —
 * the llama chat templates accept a system turn only there — preserving
 * order; assistant tool calls become wire `tool_calls`; tool results
 * become `tool` messages keyed by their call id.
 * @param options - the fully-assembled request.
 * @returns the wire messages in request order.
 */
export function toWireMessages(options) {
    const systemTexts = [];
    if (options.system !== undefined && options.system !== '')
        systemTexts.push(options.system);
    const messages = [];
    for (const message of options.messages) {
        switch (message.role) {
            case 'system':
            case 'developer': {
                const text = blockText(message.content);
                if (text !== '')
                    systemTexts.push(text);
                break;
            }
            case 'user':
                messages.push({ role: 'user', content: blockText(message.content) });
                break;
            case 'assistant': {
                const textParts = [];
                const toolCalls = [];
                for (const block of message.content) {
                    if (block.type === 'text')
                        textParts.push(block.text);
                    else if (block.type === 'tool-call') {
                        toolCalls.push({
                            id: String(block.id),
                            type: 'function',
                            function: { name: block.name, arguments: block.arguments },
                        });
                    }
                }
                const text = textParts.join('');
                messages.push({
                    role: 'assistant',
                    content: text === '' && toolCalls.length > 0 ? null : text,
                    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
                });
                break;
            }
            case 'tool':
                messages.push({
                    role: 'tool',
                    tool_call_id: String(message.toolCallId),
                    content: blockText(message.content),
                });
                break;
        }
    }
    if (systemTexts.length > 0)
        messages.unshift({ role: 'system', content: systemTexts.join('\n\n') });
    return messages;
}
/**
 * The harness adapter for the desktop's local models. Stateless across
 * calls: every operation re-reads the models directory, so downloads,
 * selection changes, and server transitions the desktop publishes are
 * visible to the next catalog load or dispatch without a restart. In
 * Ollama serving mode every operation instead probes the Ollama
 * endpoint, so models Ollama gains, loads, or unloads are visible the
 * same way.
 */
export class LocalLlamaAdapter extends LlmAdapter {
    directory;
    environment;
    fetchImpl;
    fileExists;
    serving;
    ollamaBaseUrl;
    contextWindowOverride;
    llamaServerBin;
    spawnImpl;
    llamaReadyTimeoutMs;
    companionTimeoutMs;
    probeTimeoutMs;
    /** Pull jobs by id, in start order; settled jobs are retained for polling until the retention cap trims them. */
    pullJobs = new Map();
    /**
     * @param deps - injectable directory, environment, fetch, and
     * file-existence seams; production passes nothing.
     */
    constructor(deps = {}) {
        super();
        this.environment = deps.environment ?? process.env;
        this.directory = resolveLocalModelsDirectory(this.environment, deps.modelsDir);
        this.fetchImpl = deps.fetchImpl ?? fetch;
        this.fileExists = deps.fileExists ?? existsSync;
        this.serving = resolveServingMode(this.environment, deps.serving);
        this.ollamaBaseUrl = (deps.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '');
        this.contextWindowOverride = deps.contextWindow;
        this.llamaServerBin = deps.llamaServerBin;
        this.spawnImpl = deps.spawnImpl;
        this.llamaReadyTimeoutMs = deps.llamaReadyTimeoutMs;
        this.companionTimeoutMs = deps.companionTimeoutMs;
        this.probeTimeoutMs = deps.probeTimeoutMs ?? LLAMA_PROBE_TIMEOUT_MS;
    }
    /**
     * Assemble the llama host seams the store, download, and server
     * operations in `./llama.ts` consume.
     * @returns the host deps for this adapter's directory and seams.
     */
    llamaDeps() {
        return {
            directory: this.directory,
            fetchImpl: this.fetchImpl,
            environment: this.environment,
            probeTimeoutMs: this.probeTimeoutMs,
            ...this.llamaServerBin === undefined ? {} : { binary: this.llamaServerBin },
            ...this.spawnImpl === undefined ? {} : { spawnImpl: this.spawnImpl },
            ...this.llamaReadyTimeoutMs === undefined ? {} : { readyTimeoutMs: this.llamaReadyTimeoutMs },
            ...this.companionTimeoutMs === undefined ? {} : { companionTimeoutMs: this.companionTimeoutMs },
        };
    }
    /** @returns the models directory this adapter reads. */
    modelsDirectory() {
        return this.directory;
    }
    /** @returns how the `local` provider is served for this adapter. */
    servingMode() {
        return this.serving;
    }
    /** @returns the OpenAI-compatible base URL of the host Ollama endpoint, in Ollama mode. */
    ollamaEndpoint() {
        return this.ollamaBaseUrl;
    }
    /**
     * The one honest failure for a silent Ollama endpoint, shared by the
     * catalog, resolution, and dispatch paths: it names the endpoint and
     * asks whether Ollama is running on the host, never the desktop's
     * "Start server" action, which does not exist in this mode.
     * @param error - the fetch or HTTP failure the endpoint produced.
     * @returns the error to throw.
     */
    ollamaUnreachable(error) {
        return new LlmError(`The local model endpoint at ${this.ollamaBaseUrl} did not answer: `
            + `${error instanceof Error ? error.message : String(error)}. `
            + 'Is Ollama running on the host? Start Ollama, then resend.', 'LOCAL_OLLAMA_UNREACHABLE');
    }
    /**
     * Probe the Ollama endpoint once, wrapping any failure in the honest
     * unreachable error.
     * @returns the catalog snapshot.
     */
    async ollamaCatalog() {
        try {
            return await fetchOllamaCatalog(this.fetchImpl, this.ollamaBaseUrl);
        }
        catch (error) {
            throw this.ollamaUnreachable(error);
        }
    }
    /**
     * The current Ollama catalog key for the plugin's poller: the served
     * ids plus the loaded set, or a fixed key while the endpoint is down,
     * so a down/up transition also reads as a change.
     * @returns the catalog key.
     */
    async ollamaCatalogKey() {
        try {
            return ollamaCatalogKey(await fetchOllamaCatalog(this.fetchImpl, this.ollamaBaseUrl));
        }
        catch {
            return 'unreachable';
        }
    }
    /**
     * Read the current directory state, narrowing the registry to models
     * whose GGUF is actually on disk.
     * @returns the directory state with downloadable-absent entries removed.
     */
    snapshot() {
        const state = readLocalModelsDirectory(this.directory);
        return { ...state, models: state.models.filter(model => this.fileExists(model.path)) };
    }
    /**
     * Describe the `local` route.
     * @param provider - the registered route.
     * @returns the provider's display metadata.
     */
    providerInfo(provider) {
        return { id: provider, name: LOCAL_PROVIDER_NAME };
    }
    /**
     * List the registry's downloaded models, the operator's active model
     * first. Presence is a registry fact: the server's state is never
     * consulted here, so a stopped server cannot hide a downloaded model.
     * @param provider - the registered route.
     * @returns the pickable local models in display order.
     */
    async listModels(provider) {
        if (this.serving === 'ollama') {
            // Ollama mode: the endpoint is the catalog source. Ids are used
            // verbatim; presence is what the endpoint reports, never whether a
            // model is loaded. A silent endpoint fails loud here, and the Host
            // catalog builder isolates that failure to this provider group.
            const catalog = await this.ollamaCatalog();
            return catalog.ids.map(id => ({
                provider,
                id,
                name: `${id} · Local`,
                inputModalities: ['text'],
            }));
        }
        const { models, settings } = this.snapshot();
        const ordered = [...models].sort((left, right) => {
            if (left.id === settings.activeModelId)
                return -1;
            if (right.id === settings.activeModelId)
                return 1;
            return 0;
        });
        return ordered.map(model => ({
            provider,
            id: model.id,
            name: localModelLabel(model),
            inputModalities: ['text'],
        }));
    }
    /**
     * Resolve one local model's metadata: its picker label and the context
     * capacity from the operator's own llama settings.
     * @param provider - the registered route.
     * @param model - the registry id.
     * @returns the resolved model metadata.
     */
    async resolveModel(provider, model) {
        if (this.serving === 'ollama') {
            // The Ollama catalog is endpoint-authoritative, unlike the llama
            // mode's advisory registry: an id the endpoint does not serve
            // cannot answer, so resolution fails loud instead of resolving a
            // model that would only fail at dispatch.
            const catalog = await this.ollamaCatalog();
            if (!catalog.ids.includes(model)) {
                throw new LlmError(`Ollama at ${this.ollamaBaseUrl} does not serve "${model}". `
                    + 'Pick a model Ollama lists, then resend.', 'LOCAL_MODEL_NOT_FOUND');
            }
            const loaded = catalog.loaded.find(candidate => candidate.name === model);
            const persisted = readLocalModelsDirectory(this.directory).settings.contextLengthByModel?.[model];
            return {
                provider,
                id: model,
                name: `${model} · Local`,
                inputModalities: ['text'],
                context: { contextWindow: resolveOllamaContextWindow(loaded, persisted ?? this.contextWindowOverride) },
            };
        }
        const { models, settings } = this.snapshot();
        const entry = models.find(candidate => candidate.id === model);
        return {
            provider,
            id: model,
            name: entry === undefined ? model : localModelLabel(entry),
            inputModalities: ['text'],
            ...settings.contextLength === undefined ? {} : { context: { contextWindow: settings.contextLength } },
        };
    }
    /**
     * Read the status the Local Models panel renders: endpoint
     * reachability, the served models with load state and both context
     * numbers (runtime allocation and model maximum, kept distinct), and
     * the registry GGUFs present on disk listed separately — on disk is
     * not served. This is the plugin's status surface for a Remote caller:
     * `LocalModelsService` (see `./local-models-service.ts`), the
     * `TypertRemoteService` the plugin provides over this adapter, seats
     * it as `ctx.remote.localModels.status()`.
     * @returns the panel status.
     */
    async localModelsStatus() {
        const { models, settings, server } = this.snapshot();
        const folderModels = models.map(model => ({ id: model.id, path: model.path }));
        if (this.serving === 'ollama') {
            let catalog;
            try {
                catalog = await fetchOllamaCatalog(this.fetchImpl, this.ollamaBaseUrl);
            }
            catch {
                return {
                    serving: this.serving,
                    endpoint: { up: false, baseUrl: this.ollamaBaseUrl },
                    models: [],
                    folderModels,
                };
            }
            return {
                serving: this.serving,
                endpoint: { up: true, baseUrl: this.ollamaBaseUrl },
                models: catalog.ids.map(id => {
                    const loaded = catalog.loaded.find(candidate => candidate.name === id);
                    const tag = catalog.tags.find(candidate => candidate.id === id);
                    return {
                        id,
                        loaded: loaded !== undefined,
                        ...loaded?.contextLength === undefined ? {} : { contextLength: loaded.contextLength },
                        ...tag?.maxContextLength === undefined ? {} : { maxContextLength: tag.maxContextLength },
                        ...loaded?.sizeVram === undefined ? {} : { sizeVram: loaded.sizeVram },
                    };
                }),
                folderModels,
            };
        }
        // Llama mode: the published document alone is not proof — the
        // desktop (or a previous host) may have died since it wrote
        // server-state.json — so the endpoint itself must confirm it is up
        // and name what it serves (the runner's probe pattern). A document
        // claiming `running` whose endpoint does not answer reads as down,
        // and the registry files are listed either way.
        const servedIds = server?.status === 'running' && server.baseUrl !== undefined && server.baseUrl !== ''
            ? await probeLlamaEndpoint(this.fetchImpl, server.baseUrl, this.probeTimeoutMs)
            : null;
        const endpointUp = servedIds !== null;
        return {
            serving: this.serving,
            endpoint: { up: endpointUp, baseUrl: server?.baseUrl ?? '' },
            models: models.map(model => {
                const declared = readGgufContextLength(model.path);
                return {
                    id: model.id,
                    loaded: endpointUp && servedIds !== null
                        && (servedIds.includes(model.id) || (servedIds.length === 0 && server?.modelId === model.id)),
                    ...settings.contextLength === undefined ? {} : { contextLength: settings.contextLength },
                    ...declared === undefined ? {} : { maxContextLength: declared },
                };
            }),
            folderModels,
        };
    }
    /**
     * Wrap one llama-mode action failure in the action's typed code: the
     * mechanics in `./llama.ts` phrase the failure (a missing binary, an
     * unmanaged server, a wedged load), and that text is the operator's
     * diagnosis, so it is kept verbatim under the action's code.
     * @param code - the failure code for the action.
     * @param error - the failure the action produced.
     * @returns the error to throw.
     */
    llamaActionError(code, error) {
        if (error instanceof LlmError)
            return error;
        return new LlmError(error instanceof Error ? error.message : String(error), code);
    }
    /**
     * Wrap one Ollama action failure: the action mechanics in
     * `./ollama.ts` phrase endpoint answers as errors starting with
     * "Ollama", which keep their text under one request-failed code;
     * anything else is a transport failure and reads as unreachable.
     * @param error - the failure the action produced.
     * @returns the error to throw.
     */
    ollamaActionError(error) {
        if (error instanceof Error && error.message.startsWith('Ollama')) {
            return new LlmError(error.message, 'LOCAL_OLLAMA_REQUEST_FAILED');
        }
        return this.ollamaUnreachable(error);
    }
    /**
     * Load one served model and hold it there (the panel's Start action).
     * In Ollama mode the result is the endpoint's verified loaded state
     * afterwards: a load the endpoint does not confirm fails. In llama
     * mode the host's llama-server is started for the model (see
     * `./llama.ts`), and the start resolves only after the server's own
     * readiness probe answers, so a returned success is a serving server.
     * @param modelId - the model to load, verbatim.
     * @returns the verified action outcome.
     */
    async startLocalModel(modelId) {
        if (this.serving === 'llama') {
            const entry = this.snapshot().models.find(model => model.id === modelId);
            if (entry === undefined) {
                throw new LlmError(`Cannot start "${modelId}": it is not a downloaded local model in ${this.directory}. `
                    + 'Download it first, then start it.', 'LOCAL_MODEL_NOT_FOUND');
            }
            try {
                await startLlamaServer(this.llamaDeps(), entry);
            }
            catch (error) {
                throw this.llamaActionError('LOCAL_SERVER_START_FAILED', error);
            }
            return { modelId, loaded: true };
        }
        let loaded;
        try {
            const catalog = await this.ollamaCatalog();
            const tag = catalog.tags.find(candidate => candidate.id === modelId);
            const persisted = readLocalModelsDirectory(this.directory).settings.contextLengthByModel?.[modelId];
            const contextLength = resolveEffectiveOllamaContextLength(persisted, this.contextWindowOverride, tag?.maxContextLength);
            loaded = await loadOllamaModel(this.fetchImpl, this.ollamaBaseUrl, modelId, contextLength);
        }
        catch (error) {
            throw this.ollamaActionError(error);
        }
        if (!loaded) {
            throw new LlmError(`Ollama accepted the request to load "${modelId}" but does not report it loaded.`, 'LOCAL_MODEL_LOAD_FAILED');
        }
        return { modelId, loaded: true };
    }
    /**
     * Unload one served model (the panel's Stop action). In Ollama mode
     * the outcome is verified against the endpoint's loaded list
     * afterwards. In llama mode the recorded llama-server is stopped and
     * its exit verified (see `./llama.ts`): the server serves one model
     * at a time, so stopping it unloads the named model.
     * @param modelId - the model to unload, verbatim.
     * @returns the verified action outcome.
     */
    async stopLocalModel(modelId) {
        if (this.serving === 'llama') {
            try {
                await stopLlamaServer(this.llamaDeps());
            }
            catch (error) {
                throw this.llamaActionError('LOCAL_SERVER_STOP_FAILED', error);
            }
            return { modelId, loaded: false };
        }
        let stillLoaded;
        try {
            stillLoaded = await unloadOllamaModel(this.fetchImpl, this.ollamaBaseUrl, modelId);
        }
        catch (error) {
            throw this.ollamaActionError(error);
        }
        if (stillLoaded) {
            throw new LlmError(`Ollama still reports "${modelId}" loaded after the unload request.`, 'LOCAL_MODEL_UNLOAD_FAILED');
        }
        return { modelId, loaded: false };
    }
    /**
     * Delete one model (the panel's Delete action). In Ollama mode the
     * outcome is verified against the endpoint's served list afterwards.
     * In llama mode the model's GGUF and registry entry are removed from
     * the store and the removal is read back; deleting the model the
     * recorded server is serving is refused — stop the server first.
     * @param modelId - the model to delete, verbatim.
     * @returns the verified action outcome.
     */
    async deleteLocalModel(modelId) {
        if (this.serving === 'llama') {
            const server = readLocalServerState(this.directory);
            if (server?.status === 'running' && server.modelId === modelId) {
                throw new LlmError(`Cannot delete "${modelId}": the local model server is serving it. Stop the server first, then delete it.`, 'LOCAL_MODEL_CURRENTLY_SERVED');
            }
            let removed;
            try {
                removed = await removeLlamaModel(this.directory, modelId);
            }
            catch (error) {
                throw this.llamaActionError('LOCAL_MODEL_DELETE_FAILED', error);
            }
            if (removed === undefined) {
                throw new LlmError(`Cannot delete "${modelId}": it is not a downloaded local model in ${this.directory}.`, 'LOCAL_MODEL_NOT_FOUND');
            }
            const remaining = this.snapshot().models;
            if (remaining.some(model => model.id === modelId) || this.fileExists(removed.path)) {
                throw new LlmError(`Deleting "${modelId}" did not remove it from the local models store.`, 'LOCAL_MODEL_DELETE_FAILED');
            }
            return { modelId, deleted: true };
        }
        try {
            await deleteOllamaModel(this.fetchImpl, this.ollamaBaseUrl, modelId);
        }
        catch (error) {
            throw this.ollamaActionError(error);
        }
        const catalog = await this.ollamaCatalog();
        if (catalog.ids.includes(modelId)) {
            throw new LlmError(`Ollama accepted the request to delete "${modelId}" but still lists it.`, 'LOCAL_MODEL_DELETE_FAILED');
        }
        return { modelId, deleted: true };
    }
    /**
     * Start pulling one model (the panel's Download action) and return
     * its job handle: the pull itself runs in the background, because a
     * model pull outlasts any single request. Starting a pull for a model
     * already being pulled returns the running job's handle instead of
     * pulling twice.
     *
     * In Ollama mode the target is an Ollama model id and the pull
     * consumes Ollama's progress stream. In llama mode the target names a
     * Hugging Face download: `owner/name` for the repository's main GGUF,
     * or `owner/name/<file>` for one exact file inside the repository;
     * the file lands in the models store and registers under its derived
     * registry id, which the settled job then reports as its model id.
     * @param modelId - the model to pull, verbatim.
     * @returns the pull job's handle.
     */
    async startLocalModelPull(modelId) {
        if (this.serving === 'llama') {
            const target = parseLlamaPullTarget(modelId);
            for (const job of this.pullJobs.values()) {
                if (job.modelId === modelId && job.state === 'running')
                    return { jobId: job.jobId };
            }
            const jobId = randomUUID();
            this.pullJobs.set(jobId, { jobId, modelId, state: 'running' });
            this.trimPullJobs();
            void this.runLlamaPull(jobId, target);
            return { jobId };
        }
        for (const job of this.pullJobs.values()) {
            if (job.modelId === modelId && job.state === 'running')
                return { jobId: job.jobId };
        }
        const jobId = randomUUID();
        this.pullJobs.set(jobId, { jobId, modelId, state: 'running' });
        this.trimPullJobs();
        void this.runOllamaPull(jobId, modelId);
        return { jobId };
    }
    /**
     * Read one pull job's progress, exactly as the job record holds it:
     * the endpoint's own phase text and layer byte counts, or the failure
     * the pull settled with. An unknown id fails loud.
     * @param jobId - the job handle {@link startLocalModelPull} returned.
     * @returns the pull's current status.
     */
    localModelPullStatus(jobId) {
        const job = this.pullJobs.get(jobId);
        if (job === undefined) {
            throw new LlmError(`No local model pull is known under id "${jobId}".`, 'LOCAL_PULL_NOT_FOUND');
        }
        return job;
    }
    /**
     * Drive one llama-mode pull job to its settlement: the Hugging Face
     * download's byte progress folds into the job record, and the job
     * settles done the moment the main file has landed and registered —
     * {@link downloadLlamaModel} resolves at exactly that point, with the
     * companion fetch still running best-effort behind it. The settled
     * record names the registered registry id. Failure-isolated: nothing
     * here throws into the caller that started the job.
     * @param jobId - the job's id.
     * @param target - the parsed Hugging Face target.
     */
    async runLlamaPull(jobId, target) {
        try {
            const model = await downloadLlamaModel(this.llamaDeps(), target, (progress) => {
                const current = this.pullJobs.get(jobId);
                if (current === undefined || current.state !== 'running')
                    return;
                this.pullJobs.set(jobId, {
                    ...current,
                    status: 'downloading',
                    completedBytes: progress.receivedBytes,
                    ...progress.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes },
                });
            });
            const current = this.pullJobs.get(jobId);
            if (current !== undefined) {
                this.pullJobs.set(jobId, {
                    ...current,
                    state: 'done',
                    status: 'done',
                    modelId: model.id,
                    completedBytes: model.sizeBytes,
                    totalBytes: model.sizeBytes,
                });
            }
        }
        catch (error) {
            const current = this.pullJobs.get(jobId);
            if (current !== undefined) {
                this.pullJobs.set(jobId, {
                    ...current,
                    state: 'failed',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
    /**
     * Drive one Ollama pull job to its settlement, folding each progress line
     * into the job record and settling done or failed. Failure-isolated:
     * nothing here throws into the caller that started the job.
     * @param jobId - the job's id.
     * @param modelId - the model being pulled.
     */
    async runOllamaPull(jobId, modelId) {
        try {
            await pullOllamaModel(this.fetchImpl, this.ollamaBaseUrl, modelId, (progress) => {
                const current = this.pullJobs.get(jobId);
                if (current === undefined || current.state !== 'running')
                    return;
                this.pullJobs.set(jobId, {
                    ...current,
                    ...progress.status === undefined ? {} : { status: progress.status },
                    ...progress.completedBytes === undefined ? {} : { completedBytes: progress.completedBytes },
                    ...progress.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes },
                });
            });
            const current = this.pullJobs.get(jobId);
            if (current !== undefined)
                this.pullJobs.set(jobId, { ...current, state: 'done' });
        }
        catch (error) {
            const current = this.pullJobs.get(jobId);
            if (current !== undefined) {
                this.pullJobs.set(jobId, { ...current, state: 'failed', error: this.ollamaActionError(error).failure.message });
            }
        }
    }
    /** Drop the oldest settled pull jobs beyond the retention cap; running jobs are never trimmed. */
    trimPullJobs() {
        const settled = [...this.pullJobs.values()].filter(job => job.state !== 'running');
        for (const job of settled.slice(0, Math.max(0, settled.length - MAX_SETTLED_PULL_JOBS))) {
            this.pullJobs.delete(job.jobId);
        }
    }
    /**
     * Stream one call to the serving endpoint. In llama mode the dispatch
     * gate runs first: unless the published server state says the selected
     * model is the one being served, the call fails with the honest start
     * action instead of touching the endpoint. In Ollama mode there is no
     * gate: the call posts straight to the Ollama endpoint.
     * @param options - the fully-assembled request.
     * @returns the raw chunk stream.
     */
    async *stream(options) {
        if (this.serving === 'ollama') {
            // Ollama mode: no server-state gate and no serving-other refusal —
            // Ollama loads the requested model itself. An id the endpoint does
            // not serve already failed loud in resolveModel; a silent endpoint
            // fails in dispatch with the Ollama remedy.
            yield* this.dispatch(this.ollamaBaseUrl, options, OLLAMA_DISPATCH_TEXT);
            return;
        }
        const { server } = this.snapshot();
        const dispatch = resolveLocalDispatch(server, options.model);
        switch (dispatch.kind) {
            case 'stopped':
                throw new LlmError(`The local model server is stopped, so "${options.model}" cannot answer. `
                    + `To use it, ${START_ACTION} in the app, then resend.`, 'LOCAL_SERVER_STOPPED');
            case 'starting':
                throw new LlmError(`The local model server is still loading "${options.model}". `
                    + 'Wait for it to finish starting in Local Models, then resend.', 'LOCAL_SERVER_STARTING');
            case 'error':
                throw new LlmError('The local model server is in an error state. '
                    + `To recover, ${START_ACTION} in the app, then resend.`, 'LOCAL_SERVER_ERROR');
            case 'serving-other': {
                // The server serves exactly one model; a turn addressed to another
                // downloaded model is routed to the served one instead of dying,
                // and the routing is disclosed as the turn's first text block so
                // the record never credits the wrong model with the answer.
                const note = `Note: the local server is serving "${dispatch.servingModelId}", not "${options.model}". This turn was routed to "${dispatch.servingModelId}".\n\n`;
                yield { type: 'block-start', index: 0, blockType: 'text' };
                yield { type: 'text-delta', index: 0, text: note };
                yield { type: 'block-end', index: 0, block: { type: 'text', text: note } };
                yield* this.dispatch(dispatch.baseUrl, {
                    ...options,
                    model: dispatch.servingModelId,
                }, LLAMA_DISPATCH_TEXT, 1);
                return;
            }
            case 'ready':
                break;
        }
        yield* this.dispatch(dispatch.baseUrl, options, LLAMA_DISPATCH_TEXT);
    }
    /**
     * Post one assembled request to an OpenAI-compatible endpoint and
     * translate its stream. Shared by both serving modes; the modes differ
     * only in the gate that runs before it (llama mode, in `stream`) and in
     * the failure text the operator reads.
     * @param baseUrl - the endpoint's OpenAI-compatible base URL.
     * @param options - the fully-assembled request.
     * @param text - the endpoint-specific failure text.
     * @returns the raw chunk stream.
     */
    async *dispatch(baseUrl, options, text, firstIndex = 0) {
        if (options.signal?.aborted === true) {
            yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the local model request was aborted before dispatch', code: 'ABORTED' } } };
            return;
        }
        let response;
        try {
            response = await this.fetchImpl(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...attributionHeaders() },
                body: JSON.stringify({
                    model: options.model,
                    messages: toWireMessages(options),
                    stream: true,
                    stream_options: { include_usage: true },
                    ...options.tools !== undefined && options.tools.length > 0
                        ? {
                            tools: options.tools.map(tool => ({
                                type: 'function',
                                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
                            })),
                        }
                        : {},
                    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
                    ...options.temperature === undefined ? {} : { temperature: options.temperature },
                    ...options.stop === undefined ? {} : { stop: options.stop },
                }),
                signal: options.signal,
            });
        }
        catch (error) {
            if (signalAborted(options.signal)) {
                yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the local model request was aborted', code: 'ABORTED' } } };
                return;
            }
            throw new LlmError(`The local model endpoint at ${baseUrl} did not answer: `
                + `${error instanceof Error ? error.message : String(error)}. `
                + text.unreachableRemedy, text.unreachableCode);
        }
        if (!response.ok) {
            const detail = (await response.text().catch(() => '')).slice(0, 500);
            // llama-server refuses an oversized prompt before it streams anything, so
            // this response is the only place a local context overflow can enter the
            // harness. Classifying it as the canonical overflow failure lets compaction
            // recover the turn instead of aborting it on a raw HTTP status.
            if (isContextWindowExceededError(detail)) {
                throw new LlmError(`The local model's context window is full${detail === '' ? '' : `: ${detail}`} `
                    + text.overflowAdvice, CONTEXT_WINDOW_EXCEEDED_CODE, { status: response.status });
            }
            throw new LlmError(`The local model endpoint answered HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`, 'LOCAL_REQUEST_FAILED', { status: response.status });
        }
        if (response.body === null) {
            throw new LlmError('The local model endpoint returned no stream body.', 'LOCAL_REQUEST_FAILED');
        }
        yield* this.readStream(response.body, options.signal, firstIndex);
    }
    /**
     * Translate the endpoint's SSE stream into the harness chunk vocabulary:
     * reasoning and text deltas, tool-call deltas keyed by the wire tool
     * index, usage ahead of the terminal finish. An abort mid-stream closes
     * the blocks assembled so far and finishes as aborted.
     * @param body - the response body stream.
     * @param signal - the request's cancellation signal.
     * @returns the translated chunk stream.
     */
    async *readStream(body, signal, firstIndex = 0) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let nextIndex = firstIndex;
        let open;
        let currentText;
        let currentReasoning;
        const toolBlocks = new Map();
        let usage;
        let finishReason = null;
        let aborted = false;
        /**
         * Close the open block, if any.
         * @returns the block-end chunk to emit, or an empty list when nothing is open.
         */
        const endBlock = () => {
            if (open === undefined)
                return [];
            const block = open;
            open = undefined;
            // A kind that resumes after another kind intervened opens a fresh
            // block: retire this block's delta routing before closing it.
            if (currentReasoning === block)
                currentReasoning = undefined;
            if (currentText === block)
                currentText = undefined;
            if (block.wireIndex !== undefined)
                toolBlocks.delete(block.wireIndex);
            if (block.kind === 'tool-call') {
                return [{
                        type: 'block-end',
                        index: block.index,
                        block: {
                            type: 'tool-call',
                            id: ToolCallId(block.toolId === '' ? `call_${block.index}` : block.toolId),
                            name: block.toolName,
                            arguments: block.toolArguments,
                        },
                    }];
            }
            return [{
                    type: 'block-end',
                    index: block.index,
                    block: { type: block.kind, text: block.text },
                }];
        };
        /**
         * Open the next block of one kind, closing the currently open one.
         * @param kind - the block kind to open.
         * @returns the new block and the chunks to emit (the previous block's end, then this start).
         */
        const beginBlock = (kind) => {
            const chunks = endBlock();
            const block = { index: nextIndex, kind, text: '', toolId: '', toolName: '', toolArguments: '' };
            nextIndex += 1;
            open = block;
            chunks.push({ type: 'block-start', index: block.index, blockType: kind });
            return { block, chunks };
        };
        try {
            let buffer = '';
            let done = false;
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                if (readerDone)
                    break;
                buffer += decoder.decode(value, { stream: true });
                let newline = buffer.indexOf('\n');
                while (newline !== -1) {
                    const line = buffer.slice(0, newline).trim();
                    buffer = buffer.slice(newline + 1);
                    newline = buffer.indexOf('\n');
                    if (!line.startsWith('data:'))
                        continue;
                    const payload = line.slice('data:'.length).trim();
                    if (payload === '[DONE]') {
                        done = true;
                        break;
                    }
                    let chunk;
                    try {
                        chunk = JSON.parse(payload);
                    }
                    catch {
                        // A malformed SSE line carries no model output; the stream
                        // continues and the terminal state still settles the call.
                        continue;
                    }
                    if (typeof chunk !== 'object' || chunk === null)
                        continue;
                    const record = chunk;
                    const rawUsage = record['usage'];
                    if (typeof rawUsage === 'object' && rawUsage !== null) {
                        const counts = rawUsage;
                        const prompt = counts['prompt_tokens'];
                        const completion = counts['completion_tokens'];
                        const total = counts['total_tokens'];
                        if (typeof prompt === 'number' && typeof completion === 'number') {
                            usage = {
                                inputTokens: prompt,
                                outputTokens: completion,
                                ...typeof total === 'number' ? { totalTokens: total } : {},
                            };
                        }
                    }
                    const choices = record['choices'];
                    if (!Array.isArray(choices) || choices.length === 0)
                        continue;
                    const first = choices[0];
                    const delta = typeof first['delta'] === 'object' && first['delta'] !== null
                        ? first['delta']
                        : {};
                    const reason = first['finish_reason'];
                    if (typeof reason === 'string')
                        finishReason = reason;
                    // llama-server streams reasoning as `reasoning_content`; Ollama
                    // streams it as `reasoning` (verified live against Ollama's
                    // /v1 API). Accept either field so both endpoints' reasoning
                    // reaches the harness.
                    const reasoningField = delta['reasoning_content'];
                    const reasoning = typeof reasoningField === 'string' ? reasoningField : delta['reasoning'];
                    if (typeof reasoning === 'string' && reasoning !== '') {
                        if (currentReasoning === undefined) {
                            const begun = beginBlock('reasoning');
                            yield* begun.chunks;
                            currentReasoning = begun.block;
                        }
                        currentReasoning.text += reasoning;
                        yield { type: 'reasoning-delta', index: currentReasoning.index, text: reasoning };
                    }
                    const content = delta['content'];
                    if (typeof content === 'string' && content !== '') {
                        if (currentText === undefined) {
                            const begun = beginBlock('text');
                            yield* begun.chunks;
                            currentText = begun.block;
                        }
                        currentText.text += content;
                        yield { type: 'text-delta', index: currentText.index, text: content };
                    }
                    const toolCalls = delta['tool_calls'];
                    if (Array.isArray(toolCalls)) {
                        for (const rawCall of toolCalls) {
                            if (typeof rawCall !== 'object' || rawCall === null)
                                continue;
                            const call = rawCall;
                            const wireIndex = typeof call['index'] === 'number' ? call['index'] : toolBlocks.size;
                            let block = toolBlocks.get(wireIndex);
                            if (block === undefined) {
                                const begun = beginBlock('tool-call');
                                yield* begun.chunks;
                                block = begun.block;
                                block.wireIndex = wireIndex;
                                toolBlocks.set(wireIndex, block);
                            }
                            const id = call['id'];
                            if (typeof id === 'string' && id !== '')
                                block.toolId = id;
                            const fn = typeof call['function'] === 'object' && call['function'] !== null
                                ? call['function']
                                : {};
                            const name = fn['name'];
                            if (typeof name === 'string' && name !== '')
                                block.toolName = name;
                            const args = fn['arguments'];
                            const argsDelta = typeof args === 'string' ? args : '';
                            block.toolArguments += argsDelta;
                            yield {
                                type: 'tool-call-delta',
                                index: block.index,
                                id: ToolCallId(block.toolId === '' ? `call_${wireIndex}` : block.toolId),
                                ...block.toolName === '' ? {} : { name: block.toolName },
                                argumentsDelta: argsDelta,
                            };
                        }
                    }
                }
            }
        }
        catch (error) {
            if (signalAborted(signal)) {
                aborted = true;
            }
            else {
                throw new LlmError(`The local model stream failed: ${error instanceof Error ? error.message : String(error)}`, 'LOCAL_STREAM_FAILED');
            }
        }
        finally {
            reader.releaseLock();
        }
        yield* endBlock();
        if (usage !== undefined)
            yield { type: 'usage', usage };
        if (aborted) {
            yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the local model request was aborted', code: 'ABORTED' } } };
            return;
        }
        switch (finishReason) {
            case 'tool_calls':
                yield { type: 'finish', reason: { kind: 'tool-calls' } };
                break;
            case 'length':
                yield { type: 'finish', reason: { kind: 'max-tokens' } };
                break;
            default:
                yield { type: 'finish', reason: { kind: 'stop' } };
                break;
        }
    }
}
