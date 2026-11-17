---
name: running-nmap-native-scan
description: 'Run the nmap bridge tool nmap_exec for profile-based port/service discovery against an in-scope host. Use when host discovery, service/version detection, or policy-allowed NSE scanning is needed before nuclei or SecScan checks.'
domain: cybersecurity
subdomain: network-reconnaissance
tags: [nmap, native, recon, service-discovery]
version: '1.1'
author: secscan
license: Apache-2.0
nist_csf: [ID.AM, DE.CM, ID.RA]
mitre_attack: [T1595, T1046, T1018]
---
# Running Nmap Native Scan

## When to Use
Use when the coordinator orders nmap or when host discovery, service/version detection, or policy-allowed NSE scanning is needed before nuclei or SecScan checks.
**Do not use** for direct exploitation, for template-based web vulnerability scanning when services are already known, or against any target outside verified engagement scope.

## Procedure
1. Apply standing rules:
   - Standalone/native: `nmap_exec` drives a local nmap binary executed by the app/runner bridge. No external security-tool MCP servers are required for this tool (runner/AlterEgo hops are separate exceptions elsewhere).
   - Scope: verified engagement scope only; zero packets outside it. `host` must be a scope-checked hostname, IP, or CIDR — never a URL. "Local machine" means the host the app runs on, resolved by default; never ask which machine.
   - Policy: the agent does not supply raw nmap flags/argv or arbitrary targets; the runner builds argv from the named profile and enforces policy (including allowed NSE script categories and refused intrusive/attribution-defeating options/timing as applicable). Report ports/services/versions as evidence from parsed output, not impressions.
   - Discipline: report only what tool output proved. "no evidence / not run" is a valid result. Never upgrade an unconfirmed claim to a finding. Every action carries evidence: call, output excerpt, timestamp.
2. Resolve the target:
   - Set `host` to the verified in-scope hostname/IP/CIDR.
   - If the engagement target was provided as a URL, run against the URL's hostname and let profile/policy control ports; do not scan unrelated hosts.
   - If targeting the local machine, use the app host by default.
3. Choose action and profile:
   - `action='profiles'`: list available scan profiles and confirm the binary runs. Touches no target and is safe in any phase.
   - `action='scan'`: run one named `profile` against `host` (defaults to `quick` if omitted). Use only profiles supported/returned by `nmap_exec`.
   - Optional scan inputs: `scriptCategories` (array limited to allowed categories), `skipPing` (boolean, pass `-Pn` behavior when host drops ICMP). Do not request disallowed categories.
4. Provide required context:
   - `action` and `host` and `category` are required.
   - `category`: `logic`, `functionality`, or `validation`.
   - `attackId`: a real ATT&CK ID (e.g. `T1046` for network service discovery) when known.
   - `targetProfile`: `windows` or `linux` — never inferred.
   - `hypothesis`: one-sentence statement of what is being tested.
   - Include `batteryItem` and `variantIndex` when applicable.
5. Execute and record:
   - Call `nmap_exec(...)` with only applicable fields.
   - Record: host, action/profile, script categories/skipPing used, parsed output excerpts (ports, services, versions, script results), timestamps, and any refusal/not-run reason.
   - Mark unexecuted profiles as `not-run`. If a requested scan/profile produces no usable output, record `no-evidence`.
6. Feed report and chain:
   - Attribute results to nmap/native-nmap output as produced by the runner/app reporting pipeline.
   - Confirmed open services and detected products feed `running-nuclei-native-scan` (template selection) and `running-secscan-native-scan` (URL/app checks where applicable).
   - Do not perform exploitation from nmap alone; use `running-metasploit-native` only after a confirmed vulnerability finding exists and exploitation is ordered.
