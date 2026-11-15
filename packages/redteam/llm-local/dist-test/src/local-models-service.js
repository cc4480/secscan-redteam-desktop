/**
 * The `localModels` Remote seat for the Local Models panel: a
 * {@link TypertRemoteService} the llm-local plugin itself provides from
 * its `apply` (see `./index.ts`), so the status read B1 landed on the
 * adapter is callable from the browser as `ctx.remote.localModels.status()`.
 *
 * The Gateway discovers this seat the way it discovers every Remote
 * service: the generated strict descriptor once the package's `./typert`
 * artifact is registered by the Typert Loader, and the live service's
 * `typertRemote` binding plus `@Remote` markers through the Gateway's
 * source-mode discovery in compositions that run from source. The
 * service owns no state of its own — the status and lifecycle calls
 * delegate to the one adapter instance the plugin registered with
 * `ctx.llm`, so the panel can never read a different adapter than the
 * one dispatching calls. Two actions are exceptions: the
 * context-window actions read and write the adapter's own
 * models-directory store directly (see
 * {@link LocalModelsService.modelContext}), because the persisted
 * setting is a store fact the adapter's Start reads from that same
 * store; and the repository-listing action calls the Hub listing in
 * `./llama.ts` directly (see {@link LocalModelsService.listRepoFiles}),
 * because a listing is a Hub fact the adapter exposes no seam for —
 * the adapter reaches the same listing only inside a download.
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { LlmError } from '@deepseek-ai/dsh-llm';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { listRepoFiles as listHubRepoFiles, readGgufContextLength, readLlamaStoreSettings } from "./llama.js";
import { LOCAL_MODEL_CONTEXT_LENGTH_MAX, LOCAL_MODEL_CONTEXT_LENGTH_MIN_LLAMA, readLocalModelsDirectory, writeLocalModelsSettings, } from "./state.js";
/**
 * Host service backing the generated `ctx.remote.localModels` namespace.
 * Constructed by the llm-local plugin's `apply` with that plugin's
 * adapter; it is not a Loader entry of its own.
 */
let LocalModelsService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _status_decorators;
    let _startModel_decorators;
    let _stopModel_decorators;
    let _deleteModel_decorators;
    let _startPull_decorators;
    let _listRepoFiles_decorators;
    let _pullStatus_decorators;
    let _modelContext_decorators;
    let _setModelContext_decorators;
    let _clearModelContext_decorators;
    return class LocalModelsService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _status_decorators = [Remote];
            _startModel_decorators = [Remote];
            _stopModel_decorators = [Remote];
            _deleteModel_decorators = [Remote];
            _startPull_decorators = [Remote];
            _listRepoFiles_decorators = [Remote];
            _pullStatus_decorators = [Remote];
            _modelContext_decorators = [Remote];
            _setModelContext_decorators = [Remote];
            _clearModelContext_decorators = [Remote];
            __esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _startModel_decorators, { kind: "method", name: "startModel", static: false, private: false, access: { has: obj => "startModel" in obj, get: obj => obj.startModel }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _stopModel_decorators, { kind: "method", name: "stopModel", static: false, private: false, access: { has: obj => "stopModel" in obj, get: obj => obj.stopModel }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _deleteModel_decorators, { kind: "method", name: "deleteModel", static: false, private: false, access: { has: obj => "deleteModel" in obj, get: obj => obj.deleteModel }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _startPull_decorators, { kind: "method", name: "startPull", static: false, private: false, access: { has: obj => "startPull" in obj, get: obj => obj.startPull }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listRepoFiles_decorators, { kind: "method", name: "listRepoFiles", static: false, private: false, access: { has: obj => "listRepoFiles" in obj, get: obj => obj.listRepoFiles }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _pullStatus_decorators, { kind: "method", name: "pullStatus", static: false, private: false, access: { has: obj => "pullStatus" in obj, get: obj => obj.pullStatus }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _modelContext_decorators, { kind: "method", name: "modelContext", static: false, private: false, access: { has: obj => "modelContext" in obj, get: obj => obj.modelContext }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setModelContext_decorators, { kind: "method", name: "setModelContext", static: false, private: false, access: { has: obj => "setModelContext" in obj, get: obj => obj.setModelContext }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _clearModelContext_decorators, { kind: "method", name: "clearModelContext", static: false, private: false, access: { has: obj => "clearModelContext" in obj, get: obj => obj.clearModelContext }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        adapter = __runInitializers(this, _instanceExtraInitializers);
        /**
         * @param ctx - the llm-local plugin's context, which owns this service's lifetime.
         * @param adapter - the adapter the plugin registered for the `local` route.
         */
        constructor(ctx, adapter) {
            super(ctx, 'localModels');
            this.adapter = adapter;
        }
        /**
         * Read the Local Models panel's status: endpoint reachability, the
         * served models with load state and both context numbers, and the
         * registry GGUFs present on disk.
         * @returns the panel status, exactly as the adapter reports it.
         */
        status() {
            return this.adapter.localModelsStatus();
        }
        /**
         * Load one served model and hold it there (the panel's Start action),
         * verified afterwards: against Ollama's loaded list in Ollama mode,
         * or by the llama-server's own readiness probe in llama mode, where
         * the host starts its bundled server for the model.
         * @param modelId - the model to load, verbatim.
         * @returns the verified action outcome.
         */
        startModel(modelId) {
            return this.adapter.startLocalModel(modelId);
        }
        /**
         * Unload one served model (the panel's Stop action), verified
         * afterwards: against Ollama's loaded list in Ollama mode, or by the
         * recorded llama-server's verified exit in llama mode.
         * @param modelId - the model to unload, verbatim.
         * @returns the verified action outcome.
         */
        stopModel(modelId) {
            return this.adapter.stopLocalModel(modelId);
        }
        /**
         * Delete one model (the panel's Delete action), verified afterwards:
         * against Ollama's served list in Ollama mode, or against the store's
         * registry and disk in llama mode, where deleting the currently
         * served model is refused.
         * @param modelId - the model to delete, verbatim.
         * @returns the verified action outcome.
         */
        deleteModel(modelId) {
            return this.adapter.deleteLocalModel(modelId);
        }
        /**
         * Start pulling one model (the panel's Download action). The pull
         * runs as a host-side job because it outlasts a single request; poll
         * {@link pullStatus} for its progress. Starting a pull for a model
         * already being pulled returns the running job's handle.
         *
         * In Ollama mode the target is an Ollama model id pulled from
         * Ollama's registry. In llama mode the target names a Hugging Face
         * download — `owner/name` for the repository's main GGUF, or
         * `owner/name/<file>` for one exact file — and the settled job
         * reports the registered registry id as its model id.
         * @param modelId - the model to pull, verbatim.
         * @returns the pull job's handle.
         */
        startPull(modelId) {
            return this.adapter.startLocalModelPull(modelId);
        }
        /**
         * List the files one Hugging Face repository offers (the panel's
         * List action): the operator names a repository, sees its files
         * with their sizes, and picks one to download — no step requires
         * typing an exact file name. The listing delegates to the Hub
         * listing in `./llama.ts` (the same listing the download path
         * resolves a repository's main GGUF from), with the store's
         * configured Hub token forwarded exactly as the downloader
         * forwards it. Listing a repository is a llama-mode concept — an
         * Ollama pull names a model its registry already knows — so in
         * Ollama mode the action fails loud, and a Hub failure keeps the
         * listing's own diagnosis under the action's code.
         * @param repo - the repository to list, in `owner/name` form, verbatim.
         * @returns every file the repository offers, sized entries first in ascending size order.
         */
        async listRepoFiles(repo) {
            if (this.adapter.servingMode() !== 'llama') {
                throw new LlmError(`Cannot list the files of "${repo}": Hugging Face downloads are a llama-mode action; `
                    + 'in Ollama mode a download names a model the Ollama registry already knows.', 'LOCAL_REPO_LIST_FAILED');
            }
            const token = readLlamaStoreSettings(this.adapter.modelsDirectory()).huggingFaceToken;
            try {
                return await listHubRepoFiles({
                    repo,
                    fetchImpl: fetch,
                    ...token === undefined ? {} : { token },
                });
            }
            catch (error) {
                if (error instanceof LlmError)
                    throw error;
                throw new LlmError(error instanceof Error ? error.message : String(error), 'LOCAL_REPO_LIST_FAILED');
            }
        }
        /**
         * Read one pull job's progress: the endpoint's own phase text and
         * layer byte counts while it runs, or its settled outcome. An
         * unknown job id fails loud.
         * @param jobId - the job handle {@link startPull} returned.
         * @returns the pull's current status.
         */
        pullStatus(jobId) {
            return Promise.resolve(this.adapter.localModelPullStatus(jobId));
        }
        /**
         * Read one model's persisted context-window setting: the value a
         * Start will honor, or absence when unset (an unset model starts
         * at its own maximum in both modes: the catalog maximum in Ollama
         * mode, the GGUF-declared maximum in llama mode), plus the model's
         * known maximum when the host knows one. The context actions own the store directly (through
         * `./state.ts`) rather than delegating to the adapter, because the
         * persisted setting is a store fact, not an endpoint fact — the
         * adapter reads the same store when Start runs.
         * @param modelId - the model whose setting to read, verbatim.
         * @returns the persisted setting and the known maximum.
         */
        async modelContext(modelId) {
            const { persisted, maximum } = await this.contextFacts(modelId);
            return {
                modelId,
                ...persisted === undefined ? {} : { contextLength: persisted },
                ...maximum === undefined ? {} : { maxContextLength: maximum },
            };
        }
        /**
         * Persist one model's context window (the panel's context control):
         * in Ollama mode the value lands in the store's per-model record for
         * this model only; in llama mode it lands in the store's global
         * `contextLength` — the exact field `llama.ts` reads into the
         * server's `-c` argv. Validation fails loud, following the lifecycle
         * actions' convention (a typed refusal, never a silent clamp): the
         * value must be a positive integer, at least the llama server's
         * minimum in llama mode, and no larger than the model's known
         * maximum when one is known (the Ollama catalog maximum, or the
         * GGUF-declared maximum in llama mode; the store's hard ceiling
         * stands in when no maximum is known).
         * @param modelId - the model the setting belongs to, verbatim.
         * @param contextLength - the context window to persist.
         * @returns the persisted setting, read back from the store.
         */
        async setModelContext(modelId, contextLength) {
            const { maximum } = await this.contextFacts(modelId);
            if (!Number.isSafeInteger(contextLength) || contextLength <= 0) {
                throw new LlmError(`Cannot set the context window for "${modelId}" to ${String(contextLength)}: it must be a positive integer.`, 'LOCAL_CONTEXT_LENGTH_INVALID');
            }
            if (this.adapter.servingMode() === 'llama' && contextLength < LOCAL_MODEL_CONTEXT_LENGTH_MIN_LLAMA) {
                throw new LlmError(`Cannot set the context window for "${modelId}" to ${String(contextLength)}: `
                    + `the llama server's minimum is ${String(LOCAL_MODEL_CONTEXT_LENGTH_MIN_LLAMA)}.`, 'LOCAL_CONTEXT_LENGTH_INVALID');
            }
            const ceiling = maximum ?? LOCAL_MODEL_CONTEXT_LENGTH_MAX;
            if (contextLength > ceiling) {
                throw new LlmError(`Cannot set the context window for "${modelId}" to ${String(contextLength)}: `
                    + `it exceeds the model's maximum of ${String(ceiling)}.`, 'LOCAL_CONTEXT_LENGTH_TOO_LARGE');
            }
            const directory = this.adapter.modelsDirectory();
            if (this.adapter.servingMode() === 'llama') {
                writeLocalModelsSettings(directory, { contextLength });
            }
            else {
                writeLocalModelsSettings(directory, { contextLengthByModel: { [modelId]: contextLength } });
            }
            return this.modelContext(modelId);
        }
        /**
         * Clear one model's persisted context window, returning it to the
         * unset default: the model's own maximum in both modes (the
         * catalog maximum in Ollama mode, the GGUF-declared maximum in
         * llama mode).
         * @param modelId - the model whose setting to clear, verbatim.
         * @returns the setting after clearing, read back from the store.
         */
        async clearModelContext(modelId) {
            const directory = this.adapter.modelsDirectory();
            if (this.adapter.servingMode() === 'llama') {
                writeLocalModelsSettings(directory, { contextLength: null });
            }
            else {
                writeLocalModelsSettings(directory, { contextLengthByModel: { [modelId]: null } });
            }
            return this.modelContext(modelId);
        }
        /**
         * The facts one context read or set needs: the persisted value from
         * the store (the per-model record in Ollama mode, the global field
         * in llama mode) and the model's known maximum (the Ollama catalog
         * maximum from the status read; in llama mode the context length
         * the model's own GGUF declares, read from its file on disk and
         * clamped to the store's hard ceiling — the ceiling stands in only
         * when the file declares nothing readable). In Ollama
         * mode a status read that lists the endpoint up but not this model
         * fails loud — setting a window for a model the endpoint does not
         * serve would persist a value nothing can ever start.
         * @param modelId - the model to read facts for, verbatim.
         * @returns the persisted value and the known maximum, either possibly absent.
         */
        async contextFacts(modelId) {
            const store = readLocalModelsDirectory(this.adapter.modelsDirectory());
            const settings = store.settings;
            if (this.adapter.servingMode() === 'llama') {
                const entry = store.models.find(model => model.id === modelId);
                const declared = entry === undefined ? undefined : readGgufContextLength(entry.path);
                return {
                    persisted: settings.contextLength,
                    maximum: declared === undefined
                        ? LOCAL_MODEL_CONTEXT_LENGTH_MAX
                        : Math.min(declared, LOCAL_MODEL_CONTEXT_LENGTH_MAX),
                };
            }
            const status = await this.adapter.localModelsStatus();
            const entry = status.models.find(model => model.id === modelId);
            if (status.endpoint.up && entry === undefined) {
                throw new LlmError(`Cannot read or set the context window for "${modelId}": Ollama does not serve it.`, 'LOCAL_MODEL_NOT_FOUND');
            }
            return {
                persisted: settings.contextLengthByModel?.[modelId],
                maximum: entry?.maxContextLength,
            };
        }
    };
})();
export { LocalModelsService };
