# @secscan/redteam-llm-local

The desktop's downloaded GGUF models as a first-class harness provider.
The plugin registers a `LlmAdapter` for the `local` route with `ctx.llm` —
the same mechanism `@deepseek-ai/dsh-llm-deepseek` uses to seat its
provider — so the Host model catalog (`session/modelCatalog`) gains a
**Local** group and session routing dispatches to it with no side channel.
It is row 14 of the `@secscan/redteam-desktop-bundle` composition.

The adapter reads the models directory the desktop app owns
(`%LOCALAPPDATA%\SecScan Red Team\models` on Windows,
`~/.secscan-redteam/models` elsewhere, or `DSH_LOCAL_MODELS_DIR` /
the `modelsDir` config field when set):

- `registry.json` — the downloaded models. A model is listed in the
  catalog because it is registered **and its GGUF is on disk** — never
  because the server happens to be running. The operator's active model
  (`settings.json` `activeModelId`) sorts first. Labels are the GGUF file
  stem plus ` · Local`.
- `server-state.json` — the endpoint state the desktop's llama service
  publishes on every transition. Dispatch reads it at call time: a
  `running` state naming the selected model routes the call to its
  `baseUrl` (`http://127.0.0.1:<port>/v1`, the bundled llama-server's
  OpenAI-compatible API). Any other state fails the call with one honest
  error naming the exact in-app action — open Local Models and press
  "Start server" — or, when the server is serving a different model, the
  model it is serving.

A watcher on the models directory emits `llm/adapters-updated` when the
registry, settings, or server state change, so a model downloaded or a
server started after the Host booted reaches an already-open picker.

**Ollama serving mode.** With `serving: 'ollama'` in the plugin config
(or `DSH_LOCAL_MODELS_SERVING=ollama` in the environment, which outranks
the config so a deployment can flip the mode without editing bundle
configuration), the same `local` provider is served by a host Ollama
endpoint instead (`ollamaBaseUrl`, default
`http://127.0.0.1:11434/v1`):

- The catalog comes from Ollama: `GET /v1/models` ids are used verbatim
  with the same `<id> · Local` labels and text-only input. Registry
  membership and the server-state gate are bypassed, not deleted; llama
  mode is unchanged when the mode is unset.
- Dispatch posts to `/v1/chat/completions` with the same wire
  translation and stream reader (which accepts both `reasoning` and
  `reasoning_content` deltas, and usage that trails the finish chunk).
  There is no serving-other refusal — Ollama loads the requested model
  itself — and no Authorization header. An id Ollama does not serve
  fails at `resolveModel` (`LOCAL_MODEL_NOT_FOUND`); a silent endpoint
  fails with `LOCAL_OLLAMA_UNREACHABLE`, naming the endpoint and asking
  whether Ollama is running on the host.
- The resolved context window is the runtime allocation `/api/ps`
  reports while the model is loaded, then the `contextWindow` config
  override, then 4096 (Ollama's default allocation). The model's
  maximum context is never used as the window.
- A poller (`ollamaProbeIntervalMs`, default 5000) compares the served
  id set and loaded set against the last probe; a change re-announces
  the registration, so open pickers refresh — including the context
  change when a model loads or unloads.
- The adapter's `localModelsStatus()` read returns what a Local Models
  panel renders: endpoint `{up, baseUrl}`, models with `loaded`,
  runtime `contextLength`, maximum `maxContextLength` (from
  `/api/tags`), and `sizeVram`, plus `folderModels` — registry GGUFs on
  disk, listed separately because on disk is not served. The plugin
  seats the read behind the `localModels` Remote namespace
  (`LocalModelsService`, a `TypertRemoteService` the plugin provides
  over its adapter), so the web panel calls it as
  `ctx.remote.localModels.status()`; in llama mode the same read
  takes the endpoint from the published server state and then
  probe-verifies it — `GET {baseUrl}/models` must answer and name the
  served model before `up` or `loaded` is reported, because the
  document alone is not proof (its writer may have died since writing
  it) — and reports the settings context length in place of the Ollama
  runtime numbers. The registry files are listed whether or not the
  endpoint answers. The status payload also names the serving mode
  (`serving`), so the panel offers lifecycle actions only where they
  exist.

**Ollama-mode lifecycle actions.** In Ollama mode the same Remote
namespace carries the per-model actions, each verified against the
endpoint before it reports success: `startModel` loads a model through
the native `POST /api/generate` with `keep_alive: -1` and confirms the
model in `GET /api/ps`; `stopModel` unloads with `keep_alive: 0` and
confirms its absence; `deleteModel` issues `DELETE /api/delete` and
confirms the model has left the catalog; `startPull` runs
`POST /api/pull` as a host-side job whose record `pullStatus` serves —
the endpoint's own phase text and per-layer byte counts, settling
`done` only when the stream reports success and `failed` with the
endpoint's error text otherwise. Failures surface as typed `LlmError`s
(`LOCAL_OLLAMA_UNREACHABLE`, `LOCAL_OLLAMA_REQUEST_FAILED`,
`LOCAL_MODEL_LOAD_FAILED`, `LOCAL_MODEL_UNLOAD_FAILED`,
`LOCAL_MODEL_DELETE_FAILED`, `LOCAL_PULL_NOT_FOUND`), never as silent
success. Ollama's native API has no repository-file listing, so there
is no `listRepoFiles` equivalent in this mode: the honest action set is
start, stop, pull, and delete.

**Llama-mode lifecycle actions.** In llama mode the same Remote
namespace carries the same four actions against the host itself,
ported from the desktop manager (`apps/desktop/src/llama-*.ts`) into
`src/llama.ts`: `startModel` spawns the host's bundled `llama-server`
binary (plugin `llamaServerBin`, else `DSH_LLAMA_SERVER_BIN`, else
`apps/desktop/resources/llama/` in the app tree) detached for the
registry model — reusing the recorded port, stopping a host-started
server for a different model first — and resolves only once the
server's readiness probe answers; `stopModel` terminates the recorded
server (server-state.json carries the host-started server's pid) and
verifies its exit; `deleteModel` removes the model's GGUF and registry
entry and reads the removal back, refusing the currently served model;
`startPull` downloads from Hugging Face under the single-string
contract — `owner/name` for the repository's main GGUF (never its
mmproj projector), `owner/name/<file>` for one exact file — streaming
to a `.part` file in the store with byte progress, and the job settles
`done` the moment the main file lands and registers, with the
projector companion fetch following best-effort under a timeout so it
can never gate done. server-state.json is kept current through every
transition. Failures surface as typed `LlmError`s
(`LOCAL_MODEL_NOT_FOUND`, `LOCAL_SERVER_START_FAILED`,
`LOCAL_SERVER_STOP_FAILED`, `LOCAL_MODEL_DELETE_FAILED`,
`LOCAL_MODEL_CURRENTLY_SERVED`, `LOCAL_PULL_TARGET_INVALID`,
`LOCAL_PULL_NOT_FOUND`), never as silent success.

## Model Experience

Selecting a local model adds no prompt content of its own. A dispatched
call sends the session's existing request — system text, history, and
tool schemas — to the loopback endpoint unchanged in shape: system and
developer text collapses into one leading system message (the llama chat
templates accept a system turn only there), assistant tool calls and tool
results map to their OpenAI-compatible wire forms, and reasoning blocks
stay out of the replayed history. The route declares text-only input, so
request admission refuses image input before this adapter is called; the
endpoint's streamed reasoning, text, and tool calls map back into the
harness chunk vocabulary, with usage reported ahead of the finish.

Token and context effects: in llama mode the resolved model carries the operator's own
context length from the llama settings as its context window; in Ollama
mode it carries the runtime allocation, override, or default described
above. The
endpoint enforces it — a request llama-server rejects for outgrowing that
window is classified as the harness's canonical context-window failure
rather than a raw HTTP 400, so the turn recovers by compaction and the
error names raising the Context length in Local Models as the operator's
fix. Usage counts are the endpoint's own
(`prompt_tokens` / `completion_tokens`), split into the harness's
uncached-input / output fields.

#### KV Cache effect

None on other providers: the `local` route is an additional registry
entry. Within a local session, the request prefix is the session's own
history, resent per call exactly as the harness assembles it.

## Known Limitations and Deferred Work

- Chat dispatch never starts the server itself: a call that finds the
  llama-server stopped fails with the honest start action named, and
  the operator (or the panel) starts it through `startModel`. The
  desktop's own Electron llama service is a separate supervisor; this
  host neither starts nor stops servers it did not start — a live
  server whose server-state.json records no pid (a desktop-started
  server) reads correctly in status and dispatch, but `startModel` for
  a different model and `stopModel` fail honestly naming that, because
  the host cannot stop what it does not own.
- Status has no endpoint discovery: without a server-state.json naming
  a baseUrl there is nothing to probe, so a server started entirely
  outside both supervisors reads as down until a state document exists.
- One model at a time: the bundled server serves a single model, so a
  call for any other registered model while one is served fails with the
  served model named. Switching is the operator's stop/start in Local
  Models.
- Text-only: local models take no image input on this route, whatever
  the GGUF could accept through another client.
- In Ollama mode, `resolveModel` trusts the endpoint's catalog: an id
  removed from Ollama between catalog load and selection fails loud at
  resolution rather than resolving.
