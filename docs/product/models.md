# Models

The fleet thinks through the **Meta Model API**: an OpenAI-compatible Chat Completions endpoint at `https://api.meta.ai/v1`, authenticated with the operator's own key (`MODEL_API_KEY`; `META_API_KEY` is accepted as a fallback name, and `META_BASE_URL` overrides the endpoint). The routing layer is the llm-router package (`packages/redteam/llm-router`): a provider registry, a per-role seat policy, the charter/doctrine prompt composition, and a resilience wrapper around every call.

## The registry and the seats

The model registry in this tree seats two Meta models:

| Registry entry | Model | Seat |
|---|---|---|
| `spark` | `muse-spark-1.3` | **The fleet's engine.** All five roles — coordinator, recon, exploiter, architect, reporter |
| `wonder` | `muse-wonder-1.0` | The frontier tier: registered for explicit calls, small one-off jobs, and comparison (A/B) lanes; **not seated by default** |

Per-role tuning rides on the seat policy: recon runs at low reasoning effort (volume work), the exploiter at high (the hardest seat), the coordinator, architect, and reporter at the default. Provider selection is by environment — `REDTEAM_LLM_PROVIDER=meta` routes every role to Meta explicitly, and when no provider is selected the Meta seat policy applies as soon as a Meta key is configured. Contributor model variants are never registered as fleet seats: Meta may train on contributor traffic, and an engagement's target data is not training data.

Muse Spark 1.2 and 1.1 are not in this tree's registry yet — registering them is tracked work (1.2 is evidenced on Meta's public model surface; 1.1's API availability is key-gated and gets settled by a live probe with the operator's key before it is registered). The README's roadmap section carries the current list.

## The resilience layer

Engagements are long, multi-agent runs; a single provider hiccup must not kill one. Every fleet call passes a resilience wrapper built from four converging designs (a classified-failure taxonomy, a persistent credential pool, step-boundary retries, and a unified error transport):

- **Reason-classified failover.** Failures are classified into named reasons, and each reason carries its handling hints — retry, rotate credential, fall back to another provider/model, or compress context and retry. The classification is deliberately specific: an upstream **429 means the key is healthy** (rate, not auth), so the correct response is to change model or wait out the cooldown — never to burn a different key.
- **Credential pool.** Configured credentials carry per-credential state (health, cooldown) that persists across calls, so one throttled credential rests while the pool works.
- **Reset-aware cooldowns.** Penalties are scoped to what caused them: a fallback's failure never extends the primary's cooldown.
- **Step-boundary retry.** Retries happen at durable step boundaries with the attempt logged before the backoff, so a resumed run knows exactly what was already tried.

The wrapper's promise is narrow and kept: a provider 429, a transient 5xx, or one dead credential degrades an engagement's speed, not its existence. A genuinely unconfigured provider still fails fast and honestly — the router names the missing key rather than improvising.

## Local models

The desktop app ships a **llama.cpp local-model manager** (the Models page / "Local models" menu): download GGUF models, serve them locally with `llama-server`, and seat them as a local provider. Local models serve two honest purposes — offline work, and engagements whose target data must not leave the machine. They are not the fleet's default brain: the roster's seats are tuned for Muse Spark, and a local seat is an operator's deliberate choice for a specific job, made with its capability limits in view.
