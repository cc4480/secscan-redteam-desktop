/** One pickable local model: the active GGUF while its server is serving it. */
export interface LocalModelEntry {
    readonly provider: 'local';
    /** The model id the server answers to (the registry id, its `--alias`). */
    readonly model: string;
    /** Picker label: the model's file stem plus its local marker. */
    readonly label: string;
    /** OpenAI-compatible base URL of the serving endpoint (`.../v1`). */
    readonly baseUrl: string;
}
/**
 * Ask an endpoint which models it serves. Resolves to the served model ids,
 * or null when the endpoint does not answer with a usable list. Injectable
 * so tests never open a socket.
 */
export type LocalModelProbe = (baseUrl: string) => Promise<readonly string[] | null>;
/**
 * Resolve the directory holding the desktop's downloaded models and its
 * state documents.
 * @param env - Environment to read (defaults to `process.env`).
 * @returns absolute models directory.
 */
export declare function resolveLocalModelsDirectory(env?: NodeJS.ProcessEnv): string;
/**
 * Resolve the pickable local model right now: the registry's active model,
 * while the published server state says its server is running AND the
 * endpoint itself confirms it serves that model.
 * @param env - Environment to read (defaults to `process.env`).
 * @param probe - Endpoint probe seam (tests substitute a fake).
 * @returns the catalog entry, or null when no local model is pickable.
 */
export declare function readLocalModelEntry(env?: NodeJS.ProcessEnv, probe?: LocalModelProbe): Promise<LocalModelEntry | null>;
