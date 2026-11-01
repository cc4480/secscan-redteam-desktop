# @deepseek-ai/dsh-client-ui-redteam-console

The RedTeam console surfaces inside the chat client (Q-CONSOLE-MERGE): the operator's 8787 console, merged into the chat interface as Carlos ordered on 2026-10-29 — engagements, live activity, fleet seats, tokens, and controls in the chat, with the console's own pages kept for diagnostics.

All data arrives through the host share routes of `@secscan/redteam-console-share` (same-origin `/redteam-console/...`): the browser holds neither the console's endpoint nor its token, and never speaks MCP. The console remains the single authority for every value shown; fields the console derives from artifacts are nullable exactly where the console says so, and the UI never estimates.

Phase 1 is the **Watch** right-Sidebar tab type: an engagement picker; the stat-card row and detail list carrying the *engagement's own* tokens, steps, and findings from the A4 console view (never the chat session's usage counters); the fleet roster (each seat's provider/model beside its latest feed activity); the live event feed over the proxied SSE stream; and — for a live engagement — the abort and autonomy-tier controls with the console page's exact safety semantics (audit-logged abort reason + confirm; named operator + reason for a tier change; choosing Tier 2 is the explicit production approval).

Performance contract (Carlos's guardrail, 2026-11-01): the engagement list polls every 4 s and pauses while the window is hidden; feed rows are keyed and memoized so events append instead of re-rendering the list; seats refresh on a slow multiple of the poll cadence; content surfaces are solid theme fills with no `backdrop-filter` (glass is the pane container's chrome only); the tab's code and runtime exist only while its panel is open.

Later phases of the same package add the Engagements main panel (findings + proof, coverage, compliance, per-finding reverify), the Foundry panel, the Arsenal panel, the Reports library, and the Scope & Safety overview.

## Model Experience

None. This package contributes no model-visible content: no prompts, tools, or session events. It renders operator-visible console data and forwards operator control gestures to the console's own endpoints, whose safety rules (tier rules, approval logging, audit reasons) apply unchanged.

## Invariant

No `./invariant` subpath is published: this package owns no relation that two independent observations could disagree about — the console is the single authority for the data, the store is a per-tab view of it, and every registration is disposed with the plugin fiber.

## Known Limitations and Deferred Work

- One Watch tab follows one engagement at a time (the picker switches); the feed retains the newest 200 events in the tab — the console's events.jsonl remains the complete record.
- A feed stream that breaks after a successful resume stays down until the next selection; the 4 s list poll keeps status, stats, and findings current regardless.
