# @secscan/redteam-llm-meta

Meta's Muse models as a first-class harness provider. The plugin registers
a `LlmAdapter` for the `meta` route with `ctx.llm` — the same mechanism
`@deepseek-ai/dsh-llm-deepseek` uses to seat its provider — so the Host
model catalog (`session/modelCatalog`) gains a **Meta** group and session
routing dispatches to it with no side channel. It is row 15 of the
`@secscan/redteam-desktop-bundle` composition. This is the desktop chat
path's Meta wire; the engagement runner's Meta provider lives in
`@secscan/redteam-llm-router` and is a separate dispatch path.

The catalog is static and unconditional: the four models declared in
`src/models.ts` (`muse-wonder-1.0`, `muse-spark-1.3`, `muse-spark-1.2`,
`muse-spark-1.1` — the ids, endpoint, and order the llm-router's Meta
provider already uses) are listed whether or not a key is seated, so the
picker offers the group before the operator seats one.

Dispatch resolves the key per request through the credentials service
under the env-ref `MODEL_API_KEY` — the same seating the runner uses — so
a key seated or rotated after the Host booted reaches the next request
without a restart. In a composition with no credentials service, the
launching environment is the credential plane. A call with no usable key
fails with `MISSING_CREDENTIAL` naming the seating, exactly as the
DeepSeek route behaves; the key is sent only as the `Authorization`
header and never appears in a log, an error, or a request field. The
endpoint is the Meta Model API (`https://api.meta.ai/v1`, overridable by
the `baseUrl` config field or `META_BASE_URL`), spoken in the
OpenAI-compatible chat-completions wire format with streaming.

## Model Experience

Selecting a Meta model adds no prompt content of its own. A dispatched
call sends the session's existing request — system text, history, and
tool schemas — to the endpoint unchanged in shape: system and developer
text collapses into one leading system message, assistant tool calls and
tool results map to their OpenAI-compatible wire forms, and reasoning
blocks stay out of the replayed history. A harness reasoning-effort
selection in the Meta scale (`low` / `medium` / `high` / `xhigh`) passes
through as `reasoning_effort`. The endpoint's streamed reasoning, text,
and tool calls map back into the harness chunk vocabulary, with usage
reported ahead of the finish.

Token and context effects: usage counts are the endpoint's own
(`prompt_tokens` / `completion_tokens`, with the cached-input split from
`prompt_tokens_details` when Meta reports it). The one context capacity
the codebase already states — `muse-spark-1.2` at 1M tokens — is declared
on that model's resolved metadata; the other models declare none rather
than an invented figure.

#### KV Cache effect

None on other providers: the `meta` route is an additional registry
entry. Within a Meta session, the request prefix is the session's own
history, resent per call exactly as the harness assembles it.

## Known Limitations and Deferred Work

- No in-call credential pooling or bench handling: the runner's
  resilience pool (dead-key marking, bench wait-out) belongs to the
  engagement path's router. On this chat route a rejected key surfaces
  as the endpoint's HTTP failure (`META_REQUEST_FAILED` with its
  status), and the remedy is the same re-seat the error names.
- No `./invariant` companion: this package owns no relation between
  independent observations that can diverge — the registry entry is the
  single fact, and the composition test observes it directly.
