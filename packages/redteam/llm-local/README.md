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

Token and context effects: the resolved model carries the operator's own
context length from the llama settings as its context window, and the
endpoint enforces it. Usage counts are the endpoint's own
(`prompt_tokens` / `completion_tokens`), split into the harness's
uncached-input / output fields.

#### KV Cache effect

None on other providers: the `local` route is an additional registry
entry. Within a local session, the request prefix is the session's own
history, resent per call exactly as the harness assembles it.

## Known Limitations and Deferred Work

- The Host cannot start the bundled server. The llama service lives in
  the desktop's Electron main process and `apps/desktop/src/host-protocol.ts`
  carries no llama channel, so a stopped server is surfaced as the honest
  start action above rather than auto-started. Wiring a host-to-main
  start request is the deferred follow-up; the catalog, selection, and
  gate in this package are the complete behavior until then.
- One model at a time: the bundled server serves a single model, so a
  call for any other registered model while one is served fails with the
  served model named. Switching is the operator's stop/start in Local
  Models.
- Text-only: local models take no image input on this route, whatever
  the GGUF could accept through another client.
