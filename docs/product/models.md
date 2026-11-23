# Models

The fleet thinks through **DeepSeek**: the DeepSeek API, authenticated with the operator's own key (`DEEPSEEK_API_KEY`). DeepSeek is the default provider for every fleet seat. The Meta Model API remains available as an explicit choice (`REDTEAM_LLM_PROVIDER=meta`, authenticated with `MODEL_API_KEY`). The routing layer is the llm-router package (`packages/redteam/llm-router`): a provider registry, a per-role seat policy, the charter/doctrine prompt composition, and a resilience wrapper around every call.

## The default seats

With no provider selected, the five fleet roles seat DeepSeek:

| Role | Model | Reasoning effort |
|---|---|---|
| coordinator | `deepseek-flash` | default |
| recon | `deepseek-flash` | low (volume work) |
| exploiter | `deepseek-v4-pro` | high (the hardest seat) |
| reporter | `deepseek-flash` | default |
| architect | `deepseek-flash` | default |

Per-role tuning rides on the seat policy: recon runs at low reasoning effort (volume work), the exploiter at high (the hardest seat), and the other roles at the default. Provider selection is by environment: `REDTEAM_LLM_PROVIDER=meta` seats the Meta models instead (see below), `REDTEAM_LLM_PROVIDER=local` routes every role to a local OpenAI-compatible endpoint with `REDTEAM_LOCAL_MODEL` naming its model, and each other registered family seats its own table. Contributor model variants are never registered as fleet seats: a provider may train on contributor traffic, and an engagement's target data is not training data.

## Meta seats (explicit selection)

`REDTEAM_LLM_PROVIDER=meta` seats Muse Spark 1.3 on every role. Muse Wonder 1.0 is registered for explicit calls, small one-off jobs, and comparison (A/B) lanes; it is not seated by default. The harness `meta` catalog (`packages/redteam/llm-meta`) lists four Muse models: Muse Spark 1.3, 1.2, and 1.1, and Muse Wonder 1.0.

## The resilience layer

Engagements are long, multi-agent runs; a single provider hiccup must not kill one. Every fleet call passes a resilience wrapper built from four converging designs (a classified-failure taxonomy, a persistent credential pool, step-boundary retries, and a unified error transport):

- **Reason-classified failover.** Failures are classified into named reasons, and each reason carries its handling hints — retry, rotate credential, fall back to another provider/model, or compress context and retry. The classification is deliberately specific: an upstream **429 means the key is healthy** (rate, not auth), so the correct response is to change model or wait out the cooldown — never to burn a different key.
- **Credential pool.** Configured credentials carry per-credential state (health, cooldown) that persists across calls, so one throttled credential rests while the pool works.
- **Reset-aware cooldowns.** Penalties are scoped to what caused them: a fallback's failure never extends the primary's cooldown.
- **Step-boundary retry.** Retries happen at durable step boundaries with the attempt logged before the backoff, so a resumed run knows exactly what was already tried.

The wrapper's promise is narrow and kept: a provider 429, a transient 5xx, or one dead credential degrades an engagement's speed, not its existence. A genuinely unconfigured provider still fails fast and honestly — the router names the missing key rather than improvising.

## Local models

The desktop app ships a **llama.cpp local-model manager** (the Models page / "Local models" menu): download GGUF models, serve them locally with `llama-server`, and seat them as a local provider. Local models serve two honest purposes — offline work, and engagements whose target data must not leave the machine. They are not the fleet's default brain: the default seats are DeepSeek, and a local seat is an operator's deliberate choice for a specific job, made with its capability limits in view.
