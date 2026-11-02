# Overview

SecScan RedTeam is a desktop application that runs autonomous red-team engagements against systems the operator owns. The operator states a target and an objective in chat; a fleet of AI agents plans the engagement, reconnoiters and attacks the target, challenges its own findings, and delivers a graded report — all inside the same chat thread.

## The one-page product

Everything the operator does happens on one page: the chat. Chat is not a front-end bolted onto a separate console; it is the control surface of the engagement engine itself. Three tools connect the conversation to the runner: `engagement_launch` starts a real engagement, `engagement_status` narrates its phases as they change, and `engagement_report` delivers the finished report into the thread as designed HTML — an anchored grade dial, a severity breakdown, and findings ordered by proof strength. There are no external report links and no trip to a separate console to read results.

The app opens straight to chat. There is no account system, no login wall, and no setup wizard blocking the first session; key entry (see [MCP services](mcp-services.md)) happens in a welcome/settings flow that never interrupts a running session with a prompt.

The runner also serves a local console on loopback (`127.0.0.1:8787`). The console is a diagnostics and inspection surface — engagement records, feeds, coverage, proof bundles, the Foundry — not the product's primary face. The product is the chat.

## Design principles

Four principles govern the product, and each one is enforced in code rather than stated as policy:

- **Ownership before offense.** An engagement's active tests run only inside verified scope. For web targets, ownership verification is server-authoritative: the SecScan service's verified-domain list is the only source of truth, consulted at dispatch time. There is deliberately no local allowlist — a file on the operator's disk must never be able to assert ownership of someone else's domain. The full model is in [Security model](security-model.md).
- **Proof over claims.** Findings are graded by the receipts behind them: PROVEN (a replayable proof bundle with a passing negative control), CONFIRMED (independently observed twice, through the challenger path), DEFERRED (plausible, not yet provable in this run), RULED OUT (tested and cleared). The report prints findings in that order and never upgrades a tier silently.
- **One grading voice.** Every engagement is graded by one anchored scoring engine (Seclayer's, shipped under the SecScan name), so grades are comparable across runs and targets. The math is in [Engines & coverage](engines-and-coverage.md#grading-one-voice).
- **The arsenal travels with the app.** The check battery is embedded in the runner, and the desktop package vendors its external-tool payload, so a copy of the app installed on a clean machine still has its tools. Nothing about an engagement depends on one machine's local setup.

## Surfaces

- **Chat (the product).** Launching, narrating, and reporting engagements; asking the fleet questions; the welcome/settings key flow.
- **Runner console (diagnostics).** A loopback web console and MCP endpoint served by the bundled runner: engagement records and live feeds, findings and proof bundles, coverage, compliance packs, re-verification, watch profiles, and the Foundry surface (`#/foundry`, `#/reverify` are engagement-time views).
- **Foundry.** The self-improving loop described below, reachable from the app.
- **Local models.** A llama.cpp model manager (the Models page) that downloads and serves local GGUF models for on-device inference; see [Models](models.md#local-models).

## Two target types, never blurred

An engagement targets one of two kinds of system, and the evidence model differs by kind:

- **Web application (live).** A URL, host, or IP, tested black-box — grey-box when the engagement carries verified credentials or a second account. Evidence is request/response receipts and proof bundles.
- **Host (Windows or Linux).** A machine profile tested with the runner's host tooling (SSH/SMB/WinRM/RDP/Kerberos families) and, where the operator runs it, the PC bridge tools. Evidence is command output and session audit records.

A third input, a codebase, is assessed as source (secret scanning, dependency review, insecure-pattern review) with file/line evidence; a suspicion found in source can be carried into a live engagement for a PROVEN receipt, and a live finding can be traced back to its file and line.

## Foundry: the self-improving loop

Real engagements teach the battery. When an engagement finishes, sanitized cases (the target shape and the evidence trail, with secrets and personal data stripped) are captured into the app's Foundry store. Candidate new tests are authored from those cases and from fleet experience, then run the **Gold Loop** before they may join the battery: **Propose → Prove → Challenge → Score → Adjudicate → Decide**. A candidate is exercised against simulated and held-out targets, challenged by a second agent whose job is to break it, scored for fitness, and adjudicated; in-app cases cap at SILVER, and GOLD remains a human-adjudicated tier. Adopted tests are versioned with the battery, and a production regression auto-reverts the adoption. The loop exists so the battery grows from evidence, not from enthusiasm.

## What an engagement looks like

1. The operator names a target and objective in chat.
2. The Lead verifies authorization (domain verification for web targets; an operator attestation recorded on the engagement for local/lab targets), then plans on the shared task board.
3. Recon maps the surface; the exploiter works the battery and the plan; the architect owns review tasks that challenge findings before they count; the reporter assembles the report.
4. The report renders in the thread: anchored grade, coverage statement (what was tested, what remains pending — an engagement cannot report complete with battery items still pending), findings with impact, evidence, and one paste-ready fix each.

The mechanics behind each step are in [Architecture](architecture.md); the rules that keep step 2 and 3 honest are in [Security model](security-model.md).
