# Architecture

SecScan RedTeam is three programs composed into one product: an **Electron desktop app** that the operator opens, an **agent harness profile** that turns a chat session into a fleet commander, and a **runner** — the engagement engine — that the desktop app bundles and supervises. This document describes how they fit together; per-package contracts live in the platform references under [`docs/`](../architecture.md).

```
Operator
   │  chat (one page)
   ▼
Desktop app (Electron) ── supervises ──► Runner console (loopback 127.0.0.1:8787)
   │  harness profile (Cordis bundle)          │  POST /mcp + web console
   ▼                                           ▼
Fleet session (Lead + teammates) ── tools ──► Engagement engine
   │  mcp__redteam__*   (runner console, documented MCP exception)
   │  mcp__alterego__*  (AlterEgo bridge, documented MCP exception)
   └─ native runner tools (SecScan/SecLayer/MSF/Nmap/Nuclei/host families)
```

## The desktop app

The desktop app (`apps/desktop`) is the installed product: product name "SecScan RedTeam", application ID `com.secscan.redteam`, installer artifact `secscan-redteam-<version>-<os>-<arch>`. On startup it launches the bundled runner with the application's own Node runtime, waits for the runner console's MCP `initialize` reply, and publishes the loopback endpoint and a generated console token into the process environment before the harness profile composes — so by the time the chat opens, the engagement engine is already addressable as tools. A runner that cannot start is a visible startup failure, never a silent degradation. The app also hosts the welcome/settings key flow, the credential store, and the llama.cpp local-model manager.

## The harness profile

The fleet exists because a Cordis bundle patch (`packages/redteam/desktop-bundle`) is composed over the base profiles. Its fleet-defining rows:

| Row | What it contributes |
|---|---|
| `secscan-redteam` | The harness plugin: the authorization gate as a `tools/pre-execute` hook and the engagement doctrine as a system-prompt section. SecScan/SecLayer engines and domain verification are native to the runner/app; this row carries no external scan-service connection. |
| `mcp-redteam-runner` | The runner console as an MCP client connection — the engagement engine's tools (a documented exception to the standalone rule; see [MCP services](mcp-services.md)) |
| `agent-team` | The roster, durable peer mailbox, and shared task board (the DAG) |
| `tool-agent-team` | The model-facing team tools: `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, `team_task_*` |
| `ui-agent-team` | The web UI for the roster and the task board |

One further row in the same patch, `mcp-alterego`, connects AlterEgo — the operator's own PC bridge — as a second MCP client: Streamable HTTP to the bridge's endpoint (`http://127.0.0.1:8765/mcp` by default; routinely a tailnet address, because the bridge runs on the operator's PC, a different machine), offering the bridge's live tool registry for that PC. AlterEgo is a separate open-source project ([cc4480/alterego](https://github.com/cc4480/alterego)); its pairing and security posture are covered in [MCP services](mcp-services.md).

The same patch disables the harness's direct-subagent and workflow delegation rows on purpose: all delegation flows through the team tools, so every worker is on the roster, on the board, and in the audit trail. A profile's own patch layer composes after the bundle, so an operator can still override or disable any row by ID.

## The fleet

An engagement is run by a fleet of roles seated by the configured model provider/policy (see [Models](models.md)):

| Role | Job |
|---|---|
| **Lead** (coordinator) | Owns the engagement: verifies authorization, plans on the task board, spawns and directs teammates, narrates progress to the operator, delivers the report |
| **Recon** | Maps the target's surface: hosts, routes, parameters, technologies, exposed files |
| **Exploiter** | Works the battery and the plan against the surface; produces findings with receipts |
| **Architect** | Owns the board's `review` tasks: challenges findings, demands the missing receipt, rules out what does not hold |
| **Reporter** | Assembles the final report from the engagement record: grade, coverage, findings, fixes |

The roster is not capped at five. Any member may spawn helpers for its own slice inside fleet bounds that are configuration, not folklore: **100 members maximum, delegation depth 4, at most 25 live helpers per member, 4,096 tasks on the board**, with at most 100 members active concurrently. Teammates spawn *fresh* by default; the Lead may *fork* when a specialist needs its context. The roster, mailbox, and board persist in the session store, so the team survives a crash or restart mid-engagement.

## The engagement lifecycle

The status tool narrates four phases — **authorize → recon → exploit → report** — over a work graph (Flow → Task → Subtask, with dependencies, priority, deadline, cost, and idempotency keys) that the Lead plans and re-plans on signal, not on a timer:

1. **Authorize.** The engagement record is created with its target, objective, and authorization basis (verified domain, or the operator's recorded attestation for a local/lab target). Nothing active runs before this record exists.
2. **Recon.** Surface mapping: native recon probes, crawling, fingerprinting, and local engines, all through the dispatch choke point.
3. **Exploit.** The battery and plan-driven attacks run through the same choke point; candidate findings go to review tasks, where challenges and the challenger path decide what counts. A successful exploit opens a session immediately, mechanically, as an audit-log step — the session is evidence plumbing, not proof.
4. **Report.** The reporter phase assembles the record — live findings, coverage, proof bundles — grades it with the anchored engine, and renders the HTML report that the chat delivers in-thread.

Every tool call in phases 2–3 passes one choke point (`dispatchTool` in the runner's dispatch layer), where the scope gate, tier gate, duplicate guard, and rate limiter all sit. Recon calls batch in parallel; exploit calls serialize where state demands it. If the target shows distress, the circuit breaker and auto-halt stop the run and the record says why.

## The runner

The runner (`apps/redteam-runner`) is the engagement engine and the console in one process. It serves a web console and a `POST /mcp` endpoint on loopback (default `127.0.0.1:8787`), guarded by a per-install token. Its MCP tool surface mirrors the console handlers exactly — `start_engagement`, `get_engagement`, `get_feed`, `get_findings`, `get_proof`, `get_coverage`, `get_compliance`, `escalate`, `reverify`, `abort_engagement`, `watch_profiles`, `watch_trigger` — so anything the console can do, the fleet can do, under the same launch validation, tier rules, and approval logging. This row adds reach, not authority: the safety core applies identically to both callers. The chat-facing trio (`engagement_launch` / `engagement_status` / `engagement_report`) is a narration-shaped layer over the same handlers.

Inside the runner sit the native battery and engines ([Engines & coverage](engines-and-coverage.md)), the dispatch and safety layers ([Security model](security-model.md)), the proof and report pipeline, the continuous-watch machinery, the Foundry store and loop, and the harness2 experience/trajectory store: every engagement emits a byte-exact trajectory record, and failures are kept as first-class training fuel for the Foundry rather than discarded.

## The model layer

Fleet model calls route through the llm-router package (`packages/redteam/llm-router`): a provider registry, a per-role seat policy, and a resilience wrapper that classifies failures and decides — per reason — whether to retry, rotate credentials, fall back, or compress context. The served system prompt is composed in layers: the fleet's engagement doctrine (the harness plugin's prompt section), the charter (conduct and refusal handling), the SOUL layer (the fleet's operating character inside verified engagements), and the spawning role's brief. The composition is deliberate and ordered; the doctrine section closes every chartered assembly.

## Storage

- **Credential store** — operator keys/tokens, in the desktop app's per-user data, encrypted at rest ([Configuration](configuration.md#the-credential-store)).
- **Profile data** — harness sessions, the roster/mailbox/board, and settings, in the profile home.
- **Engagement records** — the runner's store: the event feed (steps journal), findings, proof bundles, coverage, and rendered reports; the audit trail an acceptance review reads.
- **Foundry store** — sanitized cases, candidate tests, loop state, and fitness records, in the app data; the frozen starter snapshot ships read-only with the app.
