/**
 * The local-model plugin: seats the desktop's downloaded GGUF models in
 * the harness LLM registry as the `local` provider, the way
 * `@deepseek-ai/dsh-llm-deepseek` seats its provider — construct an
 * adapter, register it with `ctx.llm`, and let the Host model catalog and
 * session routing treat it like every other provider.
 *
 * The catalog half needs no server state: a registry model is listed
 * because it exists on disk. The dispatch half is gated by the published
 * server state inside the adapter (see `./adapter.ts`), because the
 * bundled llama-server is owned by the desktop's llama service and the
 * Host cannot start it; a stopped server surfaces one honest start
 * action, never a silent dead route.
 *
 * A watcher on the models directory re-announces the registration when
 * the registry, settings, or server state change (an adapter `replace`
 * publishes `llm/adapters-updated`), so a model downloaded or a server
 * started after the Host booted appears in an already-open picker (the
 * model-selection directory refreshes on that event).
 *
 * In Ollama serving mode (`serving: 'ollama'`, or the
 * `DSH_LOCAL_MODELS_SERVING` environment override) the adapter sources
 * the catalog from a host Ollama endpoint, and a poller on the probe
 * interval plays the watcher's role for it: when Ollama's model set or
 * loaded set changes, the same registration `replace` re-announces the
 * catalog. With the mode unset, behavior is the desktop default above.
 *
 * The plugin also provides the `localModels` Remote service (see
 * `./local-models-service.ts`) over the same adapter, so the web Local
 * Models panel reads its status through `ctx.remote.localModels.status()`
 * and runs the lifecycle actions (start, stop, delete, pull) through
 * the same namespace — against the host Ollama in Ollama mode, and
 * against the store, the Hugging Face downloader, and the host's
 * llama-server in llama mode.
 */
import z from '@deepseek-ai/schemastery';
import { LocalLlamaAdapter, LOCAL_PROVIDER_ID } from "./adapter.js";
import { LocalModelsService } from "./local-models-service.js";
import { watchLocalModelsDirectory } from "./state.js";
import { DEFAULT_OLLAMA_PROBE_INTERVAL_MS, watchOllamaCatalog, } from "./ollama.js";
export * from "./adapter.js";
export * from "./state.js";
export * from "./ollama.js";
export * from "./llama.js";
export * from "./local-models-service.js";
/** Desugared plugin name. */
export const name = 'llm-local';
/** Services this plugin depends on. */
export const inject = ['llm'];
/** Local-model plugin configuration schema. */
export const Config = z.object({
    modelsDir: z.string(),
    serving: z.union(['llama', 'ollama']),
    ollamaBaseUrl: z.string(),
    ollamaProbeIntervalMs: z.number().step(1).min(1),
    contextWindow: z.number().step(1).min(1),
    llamaServerBin: z.string(),
});
/**
 * Apply the local-model plugin: register the adapter for the `local`
 * route and watch the models directory for catalog-affecting changes.
 * Disposing the plugin disposes both.
 * @param ctx - the composition context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx, config) {
    const adapter = new LocalLlamaAdapter({
        ...config.modelsDir === undefined ? {} : { modelsDir: config.modelsDir },
        ...config.serving === undefined ? {} : { serving: config.serving },
        ...config.ollamaBaseUrl === undefined ? {} : { ollamaBaseUrl: config.ollamaBaseUrl },
        ...config.contextWindow === undefined ? {} : { contextWindow: config.contextWindow },
        ...config.llamaServerBin === undefined ? {} : { llamaServerBin: config.llamaServerBin },
    });
    const registration = ctx.llm.registerAdapter([LOCAL_PROVIDER_ID], adapter);
    // Seat the adapter's status read behind the `localModels` Remote
    // namespace for the web Local Models panel. The service registers
    // itself on this plugin's context and is removed with the fiber.
    new LocalModelsService(ctx, adapter);
    // Replacing the registration's routes with the same set re-announces
    // the topology through the runtime's own contained emitter; the client
    // directory refreshes from that event.
    const announce = () => {
        try {
            registration.replace([LOCAL_PROVIDER_ID]);
        }
        catch {
            // A watcher or poller can fire while the fiber is disposing, after
            // the registration has been released; there is nothing left to refresh.
        }
    };
    ctx.effect(function* () {
        const disposeWatch = watchLocalModelsDirectory(adapter.modelsDirectory(), announce);
        yield () => {
            disposeWatch();
        };
    }, 'llm-local:watch-models-directory');
    if (adapter.servingMode() === 'ollama') {
        ctx.effect(function* () {
            // The directory watcher cannot see Ollama's model set change, so
            // the poller plays its role for the endpoint: a changed served or
            // loaded set (a load also changes the resolved context) re-announces
            // the registration on the probe interval.
            const disposePoll = watchOllamaCatalog(() => adapter.ollamaCatalogKey(), announce, { intervalMs: config.ollamaProbeIntervalMs ?? DEFAULT_OLLAMA_PROBE_INTERVAL_MS });
            yield () => {
                disposePoll();
            };
        }, 'llm-local:poll-ollama-catalog');
    }
}
