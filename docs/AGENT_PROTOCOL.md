# Agent protocol — autonomous engagements

Every agent and subagent in SecScan RedTeam follows this protocol. It is encoded in
`src/workflows/protocol.ts` (roles, phases, rules, report contract) and enforced mechanically where
possible: the auth gate, the phase sign-offs, the battery ledger and the report renderer.

## Commands (operator → run)

| Command | What it does | Tier | Approval |
|---|---|---|---|
| `/pcscan [quick\|full]` | **Full audit of this workstation**: inventory, misconfigurations, missing patches, exposed services, then the HTML report | 1 | no |
| `/scan <target> [family]` | Fast authorized scan: recon + validation battery, no exploitation | 1 | no |
| `/deepscan <target> [family,…]` | Full battery across families with proof discipline | 1 | **yes** (before exploit) |
| `/nmap <host> [profile]` | Port/service discovery only (quick/service/full/udp/os) | 0 | no |
| `/nuclei <host> [tags,…]` | Template checks (templates → run) | 1 | no |
| `/metasploit <host> [cve]` | CVE validation via the Metasploit bridge (canary payload only) | 2 | **yes** |
| `/report [id]` | Regenerate `report.html` + `report.md` | 0 | no |

Commands are parsed by `parseCommand()`, expanded into an ordered phase plan by `planCommand()`, and
executed by the engagement engine. The command owns *what* and *when to stop*; the agents own *how*.

## The five phases

1. **authorize** — ownership verified by the SecScan server, ROE parsed. No packet before this passes; the gate fails closed.
2. **plan** — one operation plan, every step carrying an ATT&CK id and the expected observation. *Coordinator sign-off.*
3. **recon** — map the surface without touching it; every discovery goes into the shared target map in the same turn. *Sign-off before exploitation.*
4. **exploit** — one tool call per turn; two independent observations per finding; killed hypotheses recorded with the killing observation.
5. **report** — written from the ledger only; `report.html` and `report.md`; honest limits included.

## Roles

| Role | Mandate | May | Never |
|---|---|---|---|
| **coordinator** | Own the operation | decompose, spawn specialists, re-task, abort | probe, write the report, bypass the gate |
| **recon** | Map without touching | scanners, GET/HEAD probes, target map | craft payloads, exploit, confirm by touching |
| **exploiter** | Prove or kill hypotheses | probes, sqlmap/ffuf/gobuster/nikto, nuclei run, msf run | repeat a payload verbatim, one-observation findings |
| **reporter** | Write from the ledger | order by severity, state limits, render | invent, soften, drop a killed hypothesis silently |

## Ten rules

1. Authorize first; the gate fails closed.
2. One tool call per turn, then observe.
3. Two independent observations before "confirmed".
4. A killed hypothesis is a result — record it.
5. Never repeat a failed payload verbatim.
6. Write every discovery to the shared target map immediately.
7. Stay in scope; out-of-scope is refused before the packet.
8. Honest limits beat fake coverage — reason codes, never silence.
9. The report contains only what was observed.
10. Stop conditions are absolute: gate attempt, ROE breach, production impact, kill switch.

## Report contract (professional HTML)

Required sections: operation narrative · executive summary · authorization statement · scope and
excluded techniques · methodology with ATT&CK timeline · findings (severity-ordered, evidence, fix,
retest) · honest limits · coverage appendix. Optional: detection gaps · compliance mapping
(PCI DSS 4.0.1 §11.4, SOC 2, ISO 27001). Formats: self-contained `report.html` (the human-facing
deliverable) plus `report.md`.

## `/pcscan` — the full-PC audit flow

1. **Inventory** via `pc_observe` + `pc_run`: OS build, installed software and versions, running
   services, listening ports, hotfix level, AV/EDR state, startup entries, SMB shares, local admins,
   firewall profile, BitLocker state, RDP/WinRM exposure.
2. **Misconfiguration checks** against the Windows battery (WS-*) plus local hardening rules:
   SMB signing, LLMNR/NBT-NS, WinRM plaintext, weak local policy, unquoted service paths,
   world-writable paths, stale admin sessions, credential exposure in scripts/config.
3. **Vulnerability checks**: `nmap_exec` (service/version) → `nuclei_exec` (tags/cve) → CVE
   validation through `msf_exec` only with approval (tier 2).
4. **Evidence**: every hit gets two observations (command output + a second independent check) and a
   receipt; nothing is reported from a single probe.
5. **Report**: `report.html` with the full contract; `honest-limits` lists everything the PC audit
   cannot see without elevation or a test account.

Non-destructive by default: read-only enumeration first, canary writes only with explicit approval,
and `pc_run` tier 2 stays gated behind `REDTEAM_PC_AGENT_ALLOW_DESTRUCTIVE=1`.
