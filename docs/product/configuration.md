# Configuration

SecScan RedTeam is configured through three channels, in a deliberate order of preference: the **app's settings/welcome flow** (which writes the encrypted credential store), **environment variables** (for headless or pre-seeded setups), and the **profile patch layer** (for structural overrides). This reference lists the operator-facing surface; service key *values* are never written to any configuration file — files carry names, values resolve at spawn time.

## Model provider

| Variable | Meaning |
|---|---|
| `DEEPSEEK_API_KEY` | The DeepSeek API key. The fleet's default provider: its seats apply as soon as this is set (or the key is seated in the app). |
| `MODEL_API_KEY` | The Meta Model API key. Used only when `REDTEAM_LLM_PROVIDER=meta` selects the Meta seats. |
| `META_API_KEY` | Fallback name for the same key, if `MODEL_API_KEY` is unset. |
| `META_BASE_URL` | Endpoint override. Default `https://api.meta.ai/v1`. A blank value means "use the default". |
| `REDTEAM_LLM_PROVIDER` | Explicit provider selection. Unset or `deepseek` seats DeepSeek; `meta` routes all five roles to the Meta seat policy; `local` routes them to a local OpenAI-compatible endpoint and needs no key. |

## Connected services

| Variable | Meaning |
|---|---|
| `REDTEAM_MSFCONSOLE_BIN` | Full path to the local `msfconsole` binary when it is not on PATH. The Metasploit arm runs the framework installed on this host; there is no daemon and no RPC credential variable. |
| `REDTEAM_MCP_URL` | Point the harness at an operator-run runner console instead of the bundled one (e.g. `https://console.example.test/mcp`). Setting it suppresses the bundled console. |
| `REDTEAM_UI_TOKEN` | The runner console's token. The desktop supervisor generates one per install when the operator has not set one; an operator-run console needs a token at or above the strength floor. |
| `REDTEAM_LOCAL_SANDBOX` | Set to `1` in the runner's environment to enable local/lab (loopback) targets for chat-launched engagements. Off by default; the engagement still records the operator's attestation. |

## The credential store

Keys entered in the app are held in a single credential document (the MCP credential contract: the `runner` token and endpoint entries) in the app's per-user application-data directory, so builds and reinstalls never wipe it. Values are encrypted with the OS keychain via Electron `safeStorage`; on Windows the store refuses plaintext outright (an unavailable encryption backend is a loud save failure, never a silent cleartext file). Resolution order at connection time is **credential store → launch environment → inherited process environment**. Model-provider keys are revoked at the provider that minted them.

## Fleet bounds

The fleet's shape is data in the desktop bundle's agent-team row (`packages/redteam/desktop-bundle/cordis.patch.yml`); the shipped values:

| Setting | Value | Meaning |
|---|---|---|
| `maxMembers` | 100 | Widest the roster may grow — a runaway guard, not a working limit |
| `maxMemberDepth` | 4 | Deepest delegation chain (Lead = 0) |
| `maxChildrenPerMember` | 25 | Live helpers any one member may have at once |
| `maxTasks` | 4096 | Task-board capacity for the fleet |
| `maxActiveSubagents` | 100 | Concurrently active members (subagent service row) |

Raise a bound in that row to go wider; the bounds that bite first in practice are the model provider's rate limits and the host's CPU and memory. The same values are mirrored in the experimental agent-team profile bundle — keep the two rows identical, because patch composition resolves a repeated plugin ID to the last layer that inserts it.

## Profile patch overrides

The bundle composes in a fixed order — base profiles, then the redteam bundle, then **the profile's own `cordis.patch.yml`** — so an operator can override or disable any bundle row by ID in their own patch layer (for example, disabling `mcp-seclayer`, or re-enabling the direct-subagent rows the bundle turns off). Overrides are structural only: no patch can add a verification bypass, because verification is server-authoritative and the gate consults the service, not the profile.

## Runner console

The console binds **loopback only** (`127.0.0.1`, default port `8787`); the bundled supervisor picks a free loopback port when 8787 is taken and never listens on a network interface. Treat `REDTEAM_MCP_URL` overrides with the same care as the tooling itself: the console drives live testing tools, and its token is the only thing standing between a caller and them.

## Telemetry

Session telemetry is disabled by default (`DISABLED`). When an uploading mode is explicitly enabled, the default OTLP/HTTP logs exporter URL is `http://127.0.0.1:4318/v1/logs` unless configured otherwise.

## Desktop build

| Variable | Meaning |
|---|---|
| `DSH_DESKTOP_APP_ID` | The application ID baked into the desktop package (`.env.windows` / `.env.macos` in `apps/desktop`). Shipped value: `com.secscan.redteam`. |
| `DSH_TELEMETRY_DISABLED` | Set to `1` to disable product telemetry. |
