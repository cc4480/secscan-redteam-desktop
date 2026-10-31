# FAQ & troubleshooting

## Using the product

**Which targets may I test?**
Systems you own. For web targets, ownership is proven with the SecScan service's domain verification and checked by the product at dispatch time; for local/lab targets (a training app on loopback, a bench VM), local targets must be enabled and the engagement records your attestation. If a target fits neither basis, the product refuses — that refusal is the security model working, not a bug. See [Security model](security-model.md).

**My scan was refused as unverified. What do I do?**
Verify the domain in your SecScan account (or via `start_domain_verification` in chat), then check it appears in `list_verified_domains`. The gate consults the service's list at the moment of the call and fails closed on any error — a transient service problem also reads as a refusal, and the engagement record shows the denial.

**What is the difference between `scan_url` and an engagement?**
`scan_url` is the SecScan *service's* hosted scan of a verified domain: one instrument, one pass, the service's report. An engagement is the fleet: the runner's native battery, external engines, exploitation, challenger review, and an anchored-grade report, run locally under your scope. They cross-check each other well; they are not the same thing.

**Does the native battery need a SecScan key?**
The battery itself is embedded code and runs locally. But authorizing an active web engagement goes through the service's verified-domain list, so in practice the SecScan token is what makes web engagements possible. The Seclayer key is never required — it unlocks only the second-opinion service.

**What do PROVEN and CONFIRMED actually mean?**
PROVEN: the flaw was demonstrated end-to-end and the receipt (a replayable proof bundle) passed a negative control. CONFIRMED: independently observed a second time through the challenger path. DEFERRED is "plausible, unproven in this run" and RULED OUT is "tested, cleared". The report orders findings in that sequence and never upgrades a tier silently. Definitions: [Security model](security-model.md#the-proof-standard).

**Why is my grade capped even with few findings?**
The grade is anchored, not averaged: one confirmed critical caps the score at 20 (F) and one confirmed high at 45, regardless of how much else is clean. Conversely, heuristic (unconfirmed) findings are damped and capped, so noise alone cannot fail a target. The full math: [Engines & coverage](engines-and-coverage.md#grading-one-voice).

**Can I run it offline, or keep target data off third-party APIs?**
The battery, the console, and local models work without the services. Fleet reasoning needs a model provider: the Meta Model API by default, or a local model seated through the llama.cpp manager (Models page) for on-device inference — with the honest caveat that the roster is tuned for Muse Spark and a local seat is a deliberate trade. Domain verification inherently needs the SecScan service reachable.

**Is the runner console exposed to my network?**
No. It binds `127.0.0.1` only, requires its token, and the desktop supervisor never listens on a network interface. If you run your own console and point `REDTEAM_MCP_URL` at it, you own that exposure decision — treat the endpoint as what it is: a remote control for live testing tools.

## Keys and connections

**Where are my keys stored, and how do I revoke one?**
In the app's per-user credential store, encrypted with the OS keychain (`safeStorage`); on Windows the store refuses plaintext storage outright. Revoke at the service that minted the key (SecScan account settings, Seclayer dashboard) — revocation is the kill switch and takes effect at the next call. See [MCP services](mcp-services.md#storage).

**The Seclayer tools don't appear in my session.**
Almost always: no key seated. With `SECLAYER_API_KEY` unset, the spawned server exits at startup by design and the tools are simply absent — nothing prompts. Seat the key in the welcome/settings MCP step (or the environment) and restart the session. If the tools appear but answer with an authentication error, the key itself is invalid or revoked: re-mint it in the Seclayer dashboard and re-seat it. Check the readiness list in the app — it reports each key's state plainly.

**My SecScan token was rejected.**
The service's answer is the truth: the token is revoked, expired, or belongs to a different account than the one holding the verified domains. Re-mint at secscan.us → Settings → AI editors and re-seat. The app surfaces one error naming the service and never loops.

**A run died when the model provider hiccuped. Should it have?**
No — that is exactly what the resilience layer exists for: classified failover, credential-pool rotation, and cooldowns should degrade speed, not kill the run. If a run did die on a transient provider error, capture the engagement record and the classified reason from the feed; that is a defect report worth filing. A *missing* key, by contrast, fails fast and honestly by design.

## Running engagements

**The engagement halted mid-run. Why?**
Read the reason in the record — the status tool and the feed carry it. The designed causes are the target-distress circuit breaker (the target started erroring or slowing under load), an auth-lockout signal during credential testing, or a scope anomaly. A halted run reports as halted, with its partial coverage stated; it never dresses itself up as complete.

**The report says coverage is incomplete.**
Then it is: the engagement could not finish part of the battery (time, access, or a halt), and the report names the pending classes rather than implying a clean pass. Re-run, widen access (credentials, a second account for IDOR tiers), or re-verify specific findings with `reverify`.

## Installation

**Windows warns me the installer is unsigned.**
Expected. CI builds are unsigned by design so the pipeline needs no signing secret; the workflow documentation says so plainly. Verify the installer came from the project's GitHub release, then confirm through the prompt. Signed builds are produced on an operator's machine with the signing token.

**The app says the runner console failed to start.**
The desktop supervisor treats that as a visible startup failure rather than starting the chat without its engine. Usual causes: a stale `REDTEAM_MCP_URL`/`REDTEAM_UI_TOKEN` override pointing at nothing, or a local security product blocking the loopback listener. Clear the overrides, restart, and check the startup error the app shows.

## About the project

**Is SecScan RedTeam a DeepSeek product?**
No. The product, its engines, its grading, and its brand are SecScan's. It is built on an everything-is-a-plugin agent harness that originated in the DeepSeek Harness codebase — that provenance is stated in the README rather than hidden — and the fleet's models are Meta's Muse family, not DeepSeek's. DeepSeek remains available only as an environment-selected fallback provider in the router, which is a compatibility fact, not the product's identity.
