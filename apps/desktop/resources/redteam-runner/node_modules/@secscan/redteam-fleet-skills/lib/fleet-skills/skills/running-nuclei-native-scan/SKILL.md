---
name: running-nuclei-native-scan
description: 'Run the nuclei bridge tool nuclei_exec for template selection and template-based checks against an in-scope host. Use when discovered services or web targets need nuclei template scanning, or when the coordinator orders nuclei in verified engagement scope.'
domain: cybersecurity
subdomain: vulnerability-scanning
tags: [nuclei, native, template, vulnerability-scan]
version: '1.1'
author: secscan
license: Apache-2.0
nist_csf: [ID.RA, DE.CM, RS.AN]
mitre_attack: [T1595, T1190, T1210]
---
# Running Nuclei Native Scan

## When to Use
Use when nmap or SecScan has discovered services and the next step is template-based vulnerability scanning, or when the coordinator orders nuclei on a verified in-scope host.
**Do not use** for host discovery, as a replacement for the full SecScan suite, for exploitation, or against any target outside verified engagement scope.

## Procedure
1. Apply standing rules:
   - Standalone/native: `nuclei_exec` drives a local nuclei binary executed by the app/runner bridge and resolves templates from the operator's local nuclei template checkout at runtime (never hardcoded). No external security-tool MCP servers are required for this tool (runner/AlterEgo hops are separate exceptions elsewhere). Template updates do not run mid-engagement.
   - Scope: verified engagement scope only; zero packets outside it. `host` is scope-checked and the runner builds the target URL. "Local machine" means the host the app runs on, resolved by default; never ask which machine.
   - Policy: `dos`-tagged templates are refused. `templates` is recon-safe (select/list, touches no target); `run` executes selected templates and is for the exploit/active testing phase only after coordinator sign-off.
   - Discipline: report only what tool output proved. "no evidence / not run" is a valid result. Never upgrade an unconfirmed claim to a finding. Every action carries evidence: call, output excerpt, timestamp.
2. Select templates (recon-safe):
   - Call `nuclei_exec(action='templates', host=<in-scope-host>, category=<category>, ...)` to list/select templates by `ids`, `tags`, `severities`, and/or `cve` as needed.
   - Use service data from `running-nmap-native-scan` or SecScan output to guide selection (e.g. web tags for HTTP(S), network/CVE tags for other services). Select only relevant, allowed templates.
3. Execute templates (when ordered/approved):
   - Call `nuclei_exec(action='run', host=<in-scope-host>, scheme=<http|https>, category=<category>, ids/tags/severities/cve=<selection>, attackId=<id>, targetProfile=<windows|linux>, hypothesis=<...>)`.
   - Required common fields: `action`, `host`, `category`. Provide `scheme` when needed to target HTTP/HTTPS appropriately.
   - `attackId`: real ATT&CK ID (e.g. `T1595.002`) when known. `targetProfile` is `windows` or `linux` — never inferred.
   - Include `batteryItem` and `variantIndex` when applicable.
4. Record and interpret results:
   - Record action, host/scheme, template selection criteria, returned template IDs/matches, relevant output excerpts, timestamps, and any refusal/not-run reason.
   - Treat runner-reported findings/evidence as authoritative. Deduplicate/report as indicated by tool/runner output; do not create duplicate findings for the same match on the same target.
   - If no templates match or nothing runs, record `no-evidence` or `not-run` as a valid result.
5. Report and chain:
   - Attribute results to nuclei/native-nuclei output as produced by the runner/app reporting pipeline.
   - Confirmed findings may feed `running-metasploit-native` only if exploitation is ordered and appropriate.
   - Do not label nmap or SecScan results as nuclei. Findings overlapping a battery item are one finding with multiple evidence sources where indicated.
