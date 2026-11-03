# Device Templates

Every scan runs against exactly one **device class**. The class decides which
battery a scan selects, which tools the plan may use, and what counts as proof.
The templates live in code — `apps/redteam-runner/src/device-templates/catalog.ts`
— and are enforced by `test/device-templates.test.ts`: a tool that no template
claims, a device missing a phase, or an unknown tool name fails the build.

**Every device runs the same three phases in order: `recon` → `exploit` → `report`.**

## The five device classes

| Device | Battery | Surface |
|---|---|---|
| `webapp` | WA-* (opt-in) | A client web application over HTTP(S) |
| `secscan` | SS-* | The SecScan product: API, auth, billing, tenants |
| `seclayer` | SL-* | The Seclayer service: jobs, webhooks, quota, reports |
| `windows` | WS-* | Windows host: SMB/RPC/RDP/WinRM, services, tasks, AD, credential stores |
| `linux` | LX-* | Linux host: SSH, services, permissions, SUID, NFS, containers |

## Toolset per device

All five devices carry the **engagement** tools (start/launch/status/report/
get_*/record_*/reverify/escalate/update_target_map/variant_list/watch_*) and the
**research** tools (`query_registry`, `arsenal_search`, `arsenal_browse`,
`arsenal_recommend`), plus `burst_probe`.

| Tool | webapp | secscan | seclayer | windows | linux |
|---|:--:|:--:|:--:|:--:|:--:|
| `http_probe` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ffuf_exec` | ✓ | ✓ | ✓ | | |
| `gobuster_exec` | ✓ | ✓ | ✓ | | |
| `nikto_exec` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `nuclei_exec` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sqlmap_exec` | ✓ | ✓ | ✓ | | |
| `nmap_exec` | ✓ | | | ✓ | ✓ |
| `msf_exec` | | | | ✓ | ✓ |
| `smb_exec` | | | | ✓ | |
| `smb_pth` | | | | ✓ | |
| `winrm_exec` | | | | ✓ | |
| `winrm_probe` | | | | ✓ | |
| `rdp_auth` | | | | ✓ | |
| `rdp_shadow_prep` | | | | ✓ | |
| `ad_enum` | | | | ✓ | |
| `krb_ptt` | | | | ✓ | |
| `ssh_exec` | | | | | ✓ |
| `ssh_agent_audit` | | | | | ✓ |
| `nfs_enum` | | | | | ✓ |
| `john_exec` | | | | ✓ | ✓ |

The host families deliberately do **not** inherit each other's tools: a Linux
device never gets WinRM/SMB/RDP/AD, and a Windows device never gets
`ssh_exec`/`ssh_agent_audit`/`nfs_enum`. A test pins that separation.

## Evidence bar per device

A finding is not a finding until it clears the device's evidence bar.

- **webapp** — exact request and exact response bytes with the identity used; a
  sibling path or unauthorized identity that does *not* show the defect; the
  response must show execution or exposure, never a status code alone.
- **secscan** — request/response with the account and tenant named; cross-tenant
  proof must show a value unique to the other tenant; rate-limit findings must
  show the absence of any throttle across the batch.
- **seclayer** — job id and scan id carried through request and response; webhook
  signature verified against the delivered body; cross-account reads must show
  data belonging to the other account.
- **windows** — command output captured verbatim with the account context;
  registry/service/ACL values quoted with their exact path; a negative control
  run as an identity without the right.
- **linux** — command output captured verbatim with the account context;
  SUID/ACL/mount evidence with exact paths and modes; a negative control as an
  unprivileged identity.

## Prerequisites (gated, never failed)

An item whose prerequisite is absent is recorded **blocked with its reason** —
never failed, never silently dropped.

- **webapp** — test accounts for authenticated/cross-tenant items; operator
  callback/DNS for out-of-band items.
- **secscan** — two accounts on different tenants; an API key per account.
- **seclayer** — a second account with its own API key; a webhook receiver.
- **windows** — test-account credentials (WinRM/SMB/RDP); Kerberos ticket
  material; a human operator for shadowing.
- **linux** — test-account SSH credentials; a privileged test client for NFS.

## What an agent does, and when

1. **At plan time** — resolve the device class from the target and the operator's
   declaration. Read that device's template. The plan may only schedule tools the
   template lists; a tool outside the template is a plan defect.
2. **In recon** — use the template's discovery tools first (`nmap_exec` for
   hosts, the web toolset for HTTP targets). Record what each returns in the
   target map.
3. **In exploit** — work the battery items, and for each item use the tool the
   template assigns to that surface. If the tool the item needs is not in the
   template, the item is mis-assigned: fix the plan, do not improvise a tool.
4. **Before recording** — check the finding against that device's evidence bar.
   Short of the bar it is a lead or `record_killed`, never a finding.
5. **At close** — an item blocked by a prerequisite is recorded blocked with the
   prerequisite named; the report lists them under Honest limits.

## Change control

Editing a template means editing `catalog.ts` only. The test then either passes
(no orphaned tools, every device complete) or names exactly what broke. Never
add a tool to a template to make a test pass; a tool in the catalogue that no
device uses is a product decision, not a test failure to silence.
