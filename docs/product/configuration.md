# Configuration

SecScan RedTeam is configured through three channels, in a deliberate order of preference: the **app's settings/welcome flow** (which writes the encrypted credential store), **environment variables** (for headless or pre-seeded setups), and the **profile patch layer** (for structural overrides). This reference lists the operator-facing surface; service key *values* are never written to any configuration file — files carry names, values resolve at spawn time.

## Model provider

| Variable | Meaning |
|---|---|
| `MODEL_API_KEY` | The Meta Model API key. The fleet's seats apply as soon as this is set (or the key is seated in the app). |
| `META_API_KEY` | Fallback name for the same key, if `MODEL_API_KEY` is unset. |
| `META_BASE_URL` | Endpoint override. Default `https://api.meta.ai/v1`. A blank value means "use the default". |
| `REDTEAM_LLM_PROVIDER` | Explicit provider selection. `meta` routes all five roles to the Meta seat policy. |

## Connected services

| Variable | Meaning |
|---|---|
| `SECSCAN_MCP_TOKEN` | The operator's permanent SecScan MCP token (minted at secscan.us → Settings → AI editors). Unset → no `mcp__secscan__*` tools, and the auth gate has no verification source. |
| `SECSCAN_MCP_URL` | SecScan MCP endpoint override. Default `https://secscan.us/api/mcp`. |
| `SECLAYER_API_KEY` | The operator's Seclayer API key (dashboard → Developer / API Keys). Resolved by name into the spawned `@seclayer/mcp` server's environment; unset → the server exits at startup and its tools do not appear. |
| `REDTEAM_MCP_URL` | Point the harness at an operator-run runner console instead of the bundled one (e.g. `https://console.example.test/mcp`). Setting it suppresses the bundled console. |
| `REDTEAM_UI_TOKEN` | The runner console's token. The desktop supervisor generates one per install when the operator has not set one; an operator-run console needs a token at or above the strength floor. |
| `REDTEAM_LOCAL_SANDBOX` | Set to `1` in the runner's environment to enable local/lab (loopback) targets for chat-launched engagements. Off by default; the engagement still records the operator's attestation. |

## The credential store

Keys entered in the app are held in a single credential document (the MCP credential contract: `secscan`, `seclayer`, `runner`, and endpoint entries) in the app's per-user application-data directory, so builds and reinstalls never wipe it. Values are encrypted with the OS keychain via Electron `safeStorage`; on Windows the store refuses plaintext outright (an unavailable encryption backend is a loud save failure, never a silent cleartext file). Resolution order at connection time is **credential store → launch environment → inherited process environment**. Revoke at the minting service to kill a key everywhere at once.

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

## Desktop build

| Variable | Meaning |
|---|---|
| `DSH_DESKTOP_APP_ID` | The application ID baked into the desktop package (`.env.windows` / `.env.macos` in `apps/desktop`). Shipped value: `com.secscan.redteam`. |
| `DSH_TELEMETRY_DISABLED` | Set to `1` to disable product telemetry. The installer CI sets it for its own runs. |
