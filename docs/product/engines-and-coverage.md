# Engines & coverage

An engagement's firepower comes from engines embedded in the runner (`apps/redteam-runner`), not from calls to an external scanning service: the native battery runs locally, under the engagement's own scope gate, whether or not any service key is configured. This document describes what the battery contains, how external engines join it, how the result is graded, and how coverage is accounted.

## The native battery

Two engines are embedded in the runner as source, each kept as its own tree with its own manifest (`src/secscan`, `src/seclayer`):

**The SecScan engine** — the production web scanner's check set, ported natively:

- **Headers, cookies, transport:** the full security-header suite, cookie flags, cache control, CORS including origin reflection, clickjacking/X-Frame-Options, content-type and referrer policy, subresource integrity, HSTS, open redirects.
- **Sensitive-path probing:** `.env`, `.git`, backups, configuration files, admin panels, and directory listing across the engine's probed-path list.
- **DNS, email, TLS:** SPF/DMARC/DKIM/CAA records, subdomain enumeration, subdomain-takeover (dangling CNAME) checks, and TLS/certificate configuration checks.
- **Secrets in served code:** JavaScript bundle scanning against the engine's credential-pattern set — service-role JWTs and cloud secrets in client bundles are the flagship catch; public-by-design keys are left alone.
- **Framework and API probes:** Next.js internals (`__NEXT_DATA__`, source maps, build metadata), GraphQL introspection and leakage, Swagger/OpenAPI/Redoc exposure, source-map disclosure, passive JWT analysis, and active path traversal at the deep tier.
- **BaaS exposure:** backend-as-a-service misconfiguration probes — Supabase row-level-security-off, Firebase, PocketBase, Appwrite.
- **Cloud storage:** public-listing checks for S3, GCS, Azure Blob, and R2 buckets.
- **Fingerprint → CVE matching** against the engine's pattern data, plus end-of-life version detection, a crawler, and a corroboration re-probe that merges duplicates before anything is reported.

**The Seclayer suites** — the second engine, contributing the categories SecScan does not cover, across seven families: SAST (secrets and patterns in served code), SCA (library vulnerability matching), IAST (headers/cookies in depth), EASM (attack-surface mapping), DAST (parameter discovery and fuzzing, stored/DOM XSS, CSRF, auth rate-limit behavior, credential chains, price manipulation, prototype pollution, deserialization, weak tokens), **API_SEC** — the suite's strength: BOLA/IDOR two-account authorization testing, API schema fuzzing, OpenAPI discovery, webhook-signature verification — and **RED_TEAM**: SQL injection, reflected XSS, command injection, SSRF including blind SSRF proven through an out-of-band collaborator (the PROVEN receipt mechanism), and weak session tokens. The aggressive set (CRLF, host-header injection, NoSQL injection, SSTI, XXE) rides at the verification-gated tier; see the [security model](security-model.md#enforcement-points) for what unlocks it.

**The hypothesis battery** sits above both engines: 24 named attack hypotheses in three categories — logic flaws (business-logic abuse), functionality abuse, and accuracy/validation rigor — each carrying its OWASP (WSTG / API Top 10) reference and an ATT&CK technique ID where one honestly fits. The exploiter must form hypotheses spanning all three categories before the battery counts as complete; black-team mode runs the same battery stealth-weighted, low-noise variants first, with immediate backoff on any detection signal.

## External engines

The runner's toolchain resolves seven external engines through one registry — **nmap, nuclei, ffuf, gobuster, sqlmap, nikto, John the Ripper** — and a **Metasploit** RPC integration (module search and suggestion over the framework catalog, execution through a policy-gated executor) joins them in the dispatch layer. Host-family tooling (SSH, SMB including pass-the-hash, WinRM, RDP authentication checks, Active Directory enumeration and Kerberos tooling) dispatches through the same choke point, as do the PC bridge tools when the operator runs the AlterEgo bridge.

None of this is a shell-out free-for-all: external engines are invoked by the dispatch layer with the engagement's scope, tier, and rate rules applied, and their output returns as evidence in the engagement record. The desktop package **vendors a tool payload** (nmap, ffuf, gobuster, and a content-discovery wordlist) so the core set works on a clean machine with no operator installs; the remaining engines resolve from the payload or the host toolchain when present. A bundled nmap runs connect scans — raw-socket scan types need the Npcap driver, which the product does not bundle.

## Grading: one voice

Every engagement is graded by **Seclayer's anchored scoring engine, shipped under the SecScan name** (`apps/redteam-runner/src/report/grading.ts` is the seam). SecScan's original additive risk score exists inside the embedded engine and is deliberately never surfaced as a grade. The anchored math:

- A **CONFIRMED** finding deducts its full severity weight: critical 35, high 25, medium 15, low 5, info 0.
- **Heuristic** findings (medium/low confidence) are damped — ×0.5 / ×0.25 — with their aggregate deduction capped at 40, and heuristics alone can never pull a score below 60.
- The grade is **anchored** to the worst confirmed severity: one confirmed critical caps the score at 20 (grade F); one confirmed high caps it at 45. Finding count alone cannot manufacture an F, and a clean run is not diluted by noise.
- The score floors at 10 and maps to a letter grade A–F; the report shows the score, the grade, the severity breakdown, and the deductions that produced them.

## Coverage

Coverage is a first-class output, not a vibe. The runner tracks a coverage model over the engagement's surface (hosts, routes, and the battery's classes), and the report prints it: what was tested, what the run reached, and what remains pending. An engagement cannot report *complete* with battery items still pending — it reports what it covered and names the gap. Re-testing is built in: any finding can be re-verified on demand (`reverify`), and watch profiles diff repeat runs so a fixed finding shows as resolved and a regression shows as new.

## Continuous watch

Watch profiles (`apps/redteam-runner/src/continuous`) keep a per-target baseline and run drift detection between engagements: configuration and surface changes surface as drift records and can trigger a follow-up run (`watch_profiles` / `watch_trigger` on the runner's tool surface). This is the shipped monitoring core. The wider monitoring union — hourly CVE+EPSS matching, certificate-expiry alerts, and grade-following deep rescans on a schedule — is designed and in progress, not yet in this tree; the repository README's roadmap section is the authoritative list of what is not yet shipped.
