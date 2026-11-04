# MCP services

The fleet reaches the outside world through four MCP connections, composed into the harness profile by the desktop bundle (`packages/redteam/desktop-bundle`). Two are operator-keyed services — **SecScan** and **Seclayer** — the third is the product's own runner, and the fourth is **AlterEgo**, the bridge to the operator's own PC. This document covers what each connection unlocks, where its key comes from, how the key is stored, and what happens when a key is missing or wrong.

Three similarly named things must not be confused:

- The **SecScan service** (secscan.us) is a hosted scanner and the product's verification authority. The **native SecScan engine** embedded in the runner is a separate, local copy of its check set — it needs no key and no network.
- The **Seclayer service** is a hosted scanner the fleet consults as a second opinion. The **Seclayer suites** embedded in the runner (and its grading engine) are local code — again, no key required.
- The **runner** is the engagement engine on the operator's own machine. Its connection is loopback and its token is generated locally.

## SecScan service — `mcp__secscan__*`

**Connection:** Streamable HTTP to `https://secscan.us/api/mcp`, authenticated with the operator's SecScan MCP token.

**The 12 tools:** `scan_url`, `get_scan_status`, `get_report`, `list_recent_scans`, `list_verified_domains`, `get_account`, `start_domain_verification`, `check_domain_verification`, `list_monitors`, `add_monitor`, `monitor_scan_now`, `dismiss_finding`.

**What it unlocks:**

- **Domain verification — the authorization backbone.** `list_verified_domains` is the list the auth gate checks before any active service scan, and the verified-domain record is what unlocks the verification-gated test tiers on an engagement. Verification itself (the DNS ownership proof) is started and checked through `start_domain_verification` / `check_domain_verification`, or directly in the operator's SecScan account.
- **The hosted scanner.** `scan_url` runs SecScan's own hosted scan of a verified domain — a different instrument from the runner's native battery, useful as a cross-check and for the service's monitoring features.
- **Monitors.** `list_monitors`, `add_monitor`, and `monitor_scan_now` manage the service's recurring checks on verified domains from inside the chat.

**The key:** a permanent MCP token from your SecScan account — [secscan.us](https://secscan.us) → **Settings → AI editors**. One token, seated once; the app never asks per scan, per agent, or per restart.

## Seclayer service — `mcp__seclayer__*`

**Connection:** a stdio MCP server the host spawns locally — `npx -y @seclayer/mcp@1.0.0` (version-pinned, so an upstream release can never silently change the tool surface). The key reaches the child process by name through the client's secret-resolution seam; the value never appears in any composed configuration.

**The 3 tools:** `seclayer_scan` (runs a live scan on the operator's Seclayer account — **it spends one scan credit**), `seclayer_list_scans`, `seclayer_get_report`.

**What it unlocks:** a second opinion. The fleet's doctrine for this service is explicit — *a second opinion, never the engine*: the native battery runs first and is the engagement's instrument; a Seclayer scan is an occasional cross-check whose cost (one credit) is announced in the thread before the call. Service output arrives labeled as service output and **never feeds the anchored grade, the coverage statement, or the engagement's findings count** — the grade has one voice, and it is the embedded engine's.

**The key:** an API key from the Seclayer dashboard → **Developer / API Keys**.

## The runner — `mcp__redteam__*`

**Connection:** Streamable HTTP to the bundled console's `POST /mcp` on loopback (`127.0.0.1:8787` by default), authenticated with the console token. In the desktop app the supervisor generates the token and publishes the endpoint before the profile composes; an operator running their own console sets `REDTEAM_MCP_URL` / `REDTEAM_UI_TOKEN` instead (see [Configuration](configuration.md)).

**The tools:** `start_engagement`, `get_engagement`, `get_feed`, `get_findings`, `get_proof`, `get_coverage`, `get_compliance`, `escalate`, `reverify`, `abort_engagement`, `watch_profiles`, `watch_trigger`. The chat profile additionally gets the narration-shaped trio `engagement_launch` / `engagement_status` / `engagement_report` over the same handlers. Every tool delegates to the same handler the console UI calls, so launch validation, tier rules, scope enforcement, and approval logging apply identically — the MCP row adds reach, not authority.

## AlterEgo bridge — `mcp__alterego__*`

**Connection:** Streamable HTTP to the bridge's local endpoint (`http://127.0.0.1:8765/mcp` by default; `PC_BRIDGE_URL` names the bridge's base address when it differs), authenticated with the paired bridge token. The desktop bundle composes this row as a fourth MCP client beside the three above, and the runner speaks to the same bridge inside engagements.

**What it is:** [AlterEgo](https://github.com/cc4480/alterego) is a separate open-source project (MIT) that runs on the operator's own Windows PC and offers that machine as tools — 109 tools in the bridge's live registry, spanning screen capture, keyboard and mouse input, shell, files, and browser control. The client filters nothing: tools arrive namespaced `mcp__alterego__*`, and whatever the bridge's live registry offers is what appears.

**What it unlocks:** the operator's actual desktop. During an engagement, the bridge reaches the PC the app runs on — its windows, its browser, its shell — beside the runner's own host tooling; during development, it is how the app's builders drive and inspect that same PC. The row adds reach, not authority: bridge operations carry the bridge's own gates, not the runner's.

**Security posture:** the bridge accepts only its owner's paired client. Pairing exchanges a one-time pairing code for a revocable bearer token; the token is stored in a file on the PC, and this row reads it from that file when the profile composes — the value never appears in any composed configuration. The bridge server listens on loopback, and any reach beyond the PC goes through the owner's own tunnel or tailnet. Write and destructive operations pass the bridge's approval modes, in the default posture its native consent dialog on the PC, and every tool call is recorded in the bridge's event-sourced audit journal. The bridge's own security documentation — including the findings of an audit of the bridge on 2026-11-04 and the status of their remediation in that repository — is the bridge repo's [SECURITY.md](https://github.com/cc4480/alterego/blob/main/SECURITY.md). An unpaired, stopped, or uninstalled bridge never blocks startup: the row's connect fails, the failure is logged, and the `mcp__alterego__*` tools do not appear until the bridge is live and paired.

## Seating keys

Keys are seated in exactly one place: the app's **welcome/settings MCP step**, which has a field for each service (SecScan token, Seclayer key) plus the Meta model key. Saving writes to the credential store (below). Environment variables are the supported alternative for headless or pre-seeded setups: `SECSCAN_MCP_TOKEN` and `SECLAYER_API_KEY` are read from the app's environment when the store has no value. The app's readiness checklist reports each key as a real, satisfiable item — present, absent, or rejected — never a vague warning.

## Storage

Entered keys live in the app's per-user **credential store**, in the application-data directory (so app upgrades and reinstalls do not wipe them), encrypted with the operating system's keychain via Electron `safeStorage`. On Windows, plaintext storage is refused by design: if encryption is unavailable, saving fails loudly instead of writing a readable secret. Configuration files in the profile carry key *names* only; values resolve from the store or the environment at the moment a connection spawns. Full detail in [Configuration](configuration.md#the-credential-store) and [Security model](security-model.md#secrets-handling).

## Failure shapes — honest by design

| State | Behavior |
|---|---|
| SecScan token unset | The `mcp__secscan__*` tools do not appear; the auth gate has no verification source, so active service scans cannot be authorized. The app and the native battery work normally. |
| Seclayer key unset | The spawned server exits at startup; no `mcp__seclayer__*` tools appear. Nothing hunts for the key and nothing prompts mid-session. |
| Key set but invalid/revoked | The connection's tools appear and the service answers with an authentication error, surfaced once, naming the service. No retry loop, no prompt loop. The fix is at the minting dashboard: revoke/re-mint there, then re-seat the new value. |
| Runner console unreachable | The `mcp__redteam__*` tools are unavailable; in the desktop app a bundled console that fails to start is a visible startup failure. |
| AlterEgo bridge down or unpaired | The row's connect fails and is logged; no `mcp__alterego__*` tools appear. The app, the fleet, and the other connections work normally. |

Revocation is the kill switch and it lives at the service: revoke the token in the same account settings that minted it, and every seated copy stops working at the next call.
