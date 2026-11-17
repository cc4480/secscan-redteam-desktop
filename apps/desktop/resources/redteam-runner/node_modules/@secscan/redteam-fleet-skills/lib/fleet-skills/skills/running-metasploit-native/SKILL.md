---
name: running-metasploit-native
description: 'Drive the Metasploit bridge (msf_exec) for recon-safe module search/suggest and exploitation/post-exploitation actions against in-scope hosts. Use only when a confirmed finding exists or the coordinator orders an MSF action in verified engagement scope.'
domain: cybersecurity
subdomain: exploitation
tags: [metasploit, native, exploitation, windows, linux]
version: '1.1'
author: secscan
license: Apache-2.0
nist_csf: [DE.CM, RS.AN, PR.IP]
mitre_attack: [T1190, T1210, T1059, T1068]
---
# Running Metasploit Native

## When to Use
Use when the coordinator orders a Metasploit action on a verified in-scope host, or when a confirmed finding needs MSF-backed validation/exploitation in scope.
**Do not use** for out-of-scope targets or to fabricate results from unconfirmed findings. Do not assume or require `msfrpcd`/RPC or external Metasploit MCP servers; this is the local MSF bridge.

## Procedure
1. Apply standing rules:
   - Standalone/native: `msf_exec` drives a local Metasploit Framework install via `msfconsole` on the host (or `REDTEAM_MSFCONSOLE_BIN`), not `msfrpcd`/RPC. No external security-tool MCP servers are required for this tool (runner/AlterEgo hops are separate exceptions elsewhere).
   - Scope: in-scope hosts only (runner-enforced), zero packets/actions outside verified engagement scope. "Local machine" means the host the app runs on, resolved by default; never ask which machine.
   - Policy/discipline: report only what tool output proved. "no evidence / not run" is a valid result. Never upgrade an unconfirmed claim to a finding. Every action carries evidence: command/call, output excerpt, timestamp, and relevant IDs/handles.
2. Common call fields:
   - `action` (required): `search`, `suggest`, `run`, `session_command`, `credential_dump`, or `session_close`.
   - `host` (required): in-scope hostname/IP/CIDR as applicable.
   - `category` (required): `logic`, `functionality`, or `validation`.
   - `attackId`, `cve`, `targetProfile` (`windows` or `linux` — never inferred), `hypothesis`: include when known/required by context.
   - Include `batteryItem` and `variantIndex` when applicable.
3. Choose the action:
   - `search` (recon-safe): query the module database. Provide `query` as needed.
   - `suggest` (recon-safe, never fires): provide `service` and/or `version` (and `platform` if useful) to get ranked candidate modules for coordinator approval.
   - `run` (exploit phase only, after coordinator sign-off): run one exploit/auxiliary module. Provide `module` (and `moduleType` `exploit`/`auxiliary` as appropriate), `options` as string map, and `payload` only when using supported payloads. With a generic payload the runner-built canary marker is the payload action; with a supported Meterpreter session payload the session may open as mechanical follow-through and return a runner-issued `sessionHandle` if proven.
   - `session_command`: run one command through an open session using `sessionHandle` and `command`. Every command and full response is logged by the runner.
   - `credential_dump`: gather credential material through an open session using `sessionHandle` and `dumpKind` (`hashdump`, `smart_hashdump`, `cachedump`, `lsa_secrets`, `credential_collector`, `gpp`, `chrome`, `firefox`, `ssh_creds`, `linux_hashdump`, `kiwi`). Raw output is sealed to engagement evidence storage; the result carries counts/types and evidence reference only.
   - `session_close`: stop the session and forget the handle using `sessionHandle`.
4. Execute and interpret safely:
   - Use `run`/session actions only on eligible, coordinator-approved, in-scope targets with a confirmed basis when exploitation is being performed.
   - Sessions exist only from a validated `run` that opened them; there is no free-standing session open. A handle is bound to the host it was exploited on.
   - Record action, module/payload/options (as relevant), session handle, output excerpts, and timestamps. If no session/proof is returned or an action is refused/not run, record `no-evidence` or `not-run` with reason.
5. Report and chain:
   - Attribute results to Metasploit/MSF bridge output as produced by the runner/app reporting pipeline.
   - Confirmed nmap, nuclei, SecScan, and SecLayer findings can be inputs to MSF validation/exploitation when ordered.
   - Do not report success without evidence-backed output/proof. Close sessions when done or aborted.
