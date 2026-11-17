---
name: running-secscan-native-scan
description: 'Run the embedded in-process SecScan scan engine against an in-scope URL via secscan_exec. Use when the coordinator orders SecScan scanning or when confirmed service/application enumeration from nmap or nuclei indicates SecScan checks should run against a URL in verified engagement scope.'
domain: cybersecurity
subdomain: vulnerability-scanning
tags: [secscan, native, vulnerability-check, scanner]
version: '1.1'
author: secscan
license: Apache-2.0
nist_csf: [ID.RA, DE.CM, RS.AN]
mitre_attack: [T1595, T1190, T1210]
---
# Running SecScan Native Scan

## When to Use
Use when the coordinator orders SecScan scanning or when nmap or nuclei output has confirmed services/applications and the next step is SecScan checks in verified scope.
**Do not use** for initial host discovery, for template-based web vulnerability scanning when nmap or nuclei should run first, or against any target outside verified engagement scope.

## Procedure
1. Apply standing rules:
   - Standalone/native: the SecScan engine is embedded in the app and runs in-process via `secscan_exec`. No external security-tool MCP servers are required for this tool (runner/AlterEgo hops are separate exceptions elsewhere). Absence of other scanners/connectivity does not block `secscan_exec`.
   - Scope: verified engagement scope only; zero packets outside it. For this tool, `url` must be one in-scope URL. "Local machine" means the host the app runs on, resolved by default; never ask which machine.
   - TLS grading: SecScan performs local TLS grading in-app (no SSL Labs dependency).
   - Discipline: report only what tool output proved. "no evidence / not run" is a valid result. Never upgrade an unconfirmed claim to a finding. Every finding carries evidence: command/call, output excerpt, timestamp.
2. Set target and scan depth:
   - Set `url` to the verified in-scope URL exactly as provided.
   - Set `depth` to `passive` (default) or `deep`.
     - `passive`: runs the passive suite on engagement scope alone (e.g. headers/cookies, TLS configuration, DNS/email auth, exposed sensitive paths, source maps, BaaS exposure, JWT analysis, GraphQL/API-doc exposure, technology/CVE fingerprinting).
     - `deep`: adds verification-gated active web app tests (e.g. active path traversal, JavaScript secret scanning, deep crawl). `deep` requires owner verification on the engagement record; the runner refuses `depth=deep` without it. Obtain/confirm verification before requesting `deep`.
3. Provide required context for the call:
   - `category` (required): `logic`, `functionality`, or `validation`.
   - `attackId`: a real ATT&CK ID (e.g. `T1190`) when known.
   - `targetProfile`: `secscan` for the SecScan battery, `webapp` for a client web application, or another applicable profile (`seclayer`, `windows`, `linux`) as appropriate.
   - `hypothesis`: one-sentence statement of what is being tested.
   - Include `batteryItem` when tracking against a battery item, and `variantIndex` when running a variant payload from `variant_list`.
4. Execute the scan:
   - Call `secscan_exec(url=<url>, depth=<passive|deep>, attackId=<id>, category=<category>, targetProfile=<profile>, hypothesis=<hypothesis>)` with only applicable optional fields.
   - Each call scans one URL. The runner records engine findings to shared state/registry and applies scope, autonomy-tier, rate limiting, and duplicate guards at dispatch.
5. Record and grade results:
   - Record for the call: URL, depth, ATT&CK/category/profile/hypothesis context, relevant output excerpts, timestamps, and any refusal reason (e.g. `deep` refused without verification).
   - Treat engine-reported findings and evidence as authoritative. If no finding is produced or a test cannot run, record `no-evidence` or `not-run` with reason. Never upgrade an unconfirmed claim.
6. Feed the report and chain:
   - Results belong under the SecScan/native scan source in reporting as produced by the runner/app reporting pipeline.
   - If host discovery or service/version data is missing, run `running-nmap-native-scan`.
   - If discovered web services need template checks, run `running-nuclei-native-scan`.
   - If deeper in-process web/app testing is needed and verification is in place, run `running-seclayer-native-tests`.
   - If a confirmed finding exists and exploitation is ordered, run `running-metasploit-native`.
   - Do not label nmap or nuclei results as SecScan.
