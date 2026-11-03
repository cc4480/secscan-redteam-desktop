/**
 * Device templates — one explicit template per device class.
 *
 * Every scan runs against a device class, and the class decides three things:
 * which battery a scan selects, which tools the plan may use, and what counts
 * as proof. Those were previously implicit (scattered across target profiles
 * and dispatch handlers); this module makes them explicit and checkable.
 *
 * The catalogue below is the authority for "all of the toolset". A tool that
 * appears in no template is an orphan and `validate.ts` fails on it — that is
 * how "use every tool the device supports" stays true instead of aspirational.
 */

export type DeviceId = 'webapp' | 'secscan' | 'seclayer' | 'windows' | 'linux'

export type ToolGroup =
  | 'engagement'
  | 'research'
  | 'web'
  | 'host'
  | 'identity'
  | 'credential'
  | 'resilience'
  | 'boundary'

export interface ToolSpec {
  name: string
  group: ToolGroup
  /** One line: what this tool answers for the device. */
  purpose: string
}

export type ScanPhase = 'recon' | 'exploit' | 'report'

export interface DeviceTemplate {
  id: DeviceId
  /** Human label for the report and the plan prompt. */
  label: string
  /** One line: what this device class is. */
  summary: string
  /** Phases in order, every template runs all three. */
  phases: readonly ScanPhase[]
  /** Every tool this device class is expected to exercise. */
  tools: readonly string[]
  /** What counts as proof on this device — the evidence bar. */
  evidence: readonly string[]
  /** Items gated behind an operator-provided prerequisite. */
  prerequisites: readonly string[]
}

// ---------------------------------------------------------------------------
// The catalogue: every tool the runner exposes, grouped and explained.
// ---------------------------------------------------------------------------

export const TOOL_CATALOGUE: readonly ToolSpec[] = [
  // Engagement control — every device.
  { name: 'start_engagement', group: 'engagement', purpose: 'Open an engagement with an objective and a scope.' },
  { name: 'engagement_launch', group: 'engagement', purpose: 'Launch a URL/host target through the full pipeline.' },
  { name: 'engagement_launch_local', group: 'engagement', purpose: 'Assess the machine this product runs on.' },
  { name: 'engagement_status', group: 'engagement', purpose: 'Phase, live-ness, and the stop reason if any.' },
  { name: 'engagement_report', group: 'engagement', purpose: 'The finished report and its artifact paths.' },
  { name: 'engagement_regenerate_report', group: 'engagement', purpose: 'Reassemble a missing deliverable set.' },
  { name: 'get_engagement', group: 'engagement', purpose: 'Recorded state and which artifacts exist.' },
  { name: 'get_feed', group: 'engagement', purpose: 'Audit events by sequence.' },
  { name: 'get_findings', group: 'engagement', purpose: 'Validated findings with their evidence.' },
  { name: 'get_proof', group: 'engagement', purpose: 'The proof bundle behind one finding.' },
  { name: 'get_coverage', group: 'engagement', purpose: 'Battery reconciliation per cell and item.' },
  { name: 'get_compliance', group: 'engagement', purpose: 'The compliance pack mapping.' },
  { name: 'list_engagements', group: 'engagement', purpose: 'Every engagement this console knows.' },
  { name: 'list_live_engagements', group: 'engagement', purpose: 'Engagements running in this process.' },
  { name: 'record_finding', group: 'engagement', purpose: 'Record a confirmed finding with its receipt.' },
  { name: 'record_killed', group: 'engagement', purpose: 'Record a hypothesis as dead, with the killing observation.' },
  { name: 'record_item_verdict', group: 'engagement', purpose: 'Declare a battery item not applicable, with evidence.' },
  { name: 'reverify', group: 'engagement', purpose: 'Replay a proof bundle with a fresh canary.' },
  { name: 'escalate', group: 'engagement', purpose: 'Change the autonomy tier on the record.' },
  { name: 'update_target_map', group: 'engagement', purpose: 'Write the shared target map and fingerprint.' },
  { name: 'variant_list', group: 'engagement', purpose: 'Curated payload variants for a battery item.' },
  { name: 'watch_profiles', group: 'engagement', purpose: 'Available continuous-testing profiles.' },
  { name: 'watch_trigger', group: 'engagement', purpose: 'Fire a watch profile with drift classification.' },

  // Research — every device.
  { name: 'query_registry', group: 'research', purpose: 'What worked and died against similar targets.' },
  { name: 'arsenal_search', group: 'research', purpose: 'Free-text search of the curated security index.' },
  { name: 'arsenal_browse', group: 'research', purpose: 'The Arsenal topic census and collections.' },
  { name: 'arsenal_recommend', group: 'research', purpose: 'Task-shaped retrieval ranked by facet fit.' },

  // Web / API surface.
  { name: 'http_probe', group: 'web', purpose: 'One crafted request to test one hypothesis.' },
  { name: 'ffuf_exec', group: 'web', purpose: 'Content and virtual-host discovery.' },
  { name: 'gobuster_exec', group: 'web', purpose: 'Directory, DNS and vhost discovery.' },
  { name: 'nikto_exec', group: 'web', purpose: 'Web-server misconfiguration scanning.' },
  { name: 'nuclei_exec', group: 'web', purpose: 'Template-based checks from the local checkout.' },
  { name: 'sqlmap_exec', group: 'web', purpose: 'SQL injection detection and confirmation.' },

  // Host surface.
  { name: 'nmap_exec', group: 'host', purpose: 'Port and service discovery on a host.' },
  { name: 'msf_exec', group: 'host', purpose: 'CVE-specific exploit validation.' },
  { name: 'smb_exec', group: 'host', purpose: 'Read-only SMB share operations.' },
  { name: 'winrm_exec', group: 'host', purpose: 'One non-interactive Windows command.' },
  { name: 'winrm_probe', group: 'host', purpose: 'WinRM listener and auth-scheme disclosure.' },
  { name: 'ssh_exec', group: 'host', purpose: 'One non-interactive Linux command.' },
  { name: 'ssh_agent_audit', group: 'host', purpose: 'Agent-forwarding socket exposure.' },
  { name: 'nfs_enum', group: 'host', purpose: 'NFS export listing and grants.' },

  // Identity.
  { name: 'ad_enum', group: 'identity', purpose: 'Read-only LDAP/AD enumeration and attack paths.' },
  { name: 'rdp_auth', group: 'identity', purpose: 'Validate the test account over NLA.' },
  { name: 'rdp_shadow_prep', group: 'identity', purpose: 'Prepare RDP shadowing for a human operator.' },
  { name: 'krb_ptt', group: 'identity', purpose: 'Replay the test account own Kerberos tickets.' },

  // Credential material.
  { name: 'john_exec', group: 'credential', purpose: 'Offline cracking against an operator hash file.' },
  { name: 'smb_pth', group: 'credential', purpose: 'Pass-the-hash with the test account own hash.' },

  // Resilience.
  { name: 'burst_probe', group: 'resilience', purpose: 'One fixed-size batch to observe rate limiting.' },
] as const

// ---------------------------------------------------------------------------
// Shared tool sets, so a template cannot silently omit its base.
// ---------------------------------------------------------------------------

const ENGAGEMENT_TOOLS = TOOL_CATALOGUE.filter(t => t.group === 'engagement').map(t => t.name)
const RESEARCH_TOOLS = TOOL_CATALOGUE.filter(t => t.group === 'research').map(t => t.name)
const WEB_TOOLS = TOOL_CATALOGUE.filter(t => t.group === 'web').map(t => t.name)
const IDENTITY_TOOLS = TOOL_CATALOGUE.filter(t => t.group === 'identity').map(t => t.name)
const CREDENTIAL_TOOLS = TOOL_CATALOGUE.filter(t => t.group === 'credential').map(t => t.name)
const RESILIENCE_TOOLS = TOOL_CATALOGUE.filter(t => t.group === 'resilience').map(t => t.name)

/** Host tools that make sense on BOTH host families (discovery + web on host). */
const SHARED_HOST_TOOLS = ['nmap_exec', 'msf_exec', 'http_probe', 'nuclei_exec'] as const
/** Windows-only host surface. */
const WINDOWS_HOST_TOOLS = [
  ...SHARED_HOST_TOOLS, 'smb_exec', 'winrm_exec', 'winrm_probe', 'nikto_exec',
] as const
/** Linux-only host surface. */
const LINUX_HOST_TOOLS = [
  ...SHARED_HOST_TOOLS, 'ssh_exec', 'ssh_agent_audit', 'nfs_enum', 'nikto_exec',
] as const

const PHASES: readonly ScanPhase[] = ['recon', 'exploit', 'report']

// ---------------------------------------------------------------------------
// The templates.
// ---------------------------------------------------------------------------

export const DEVICE_TEMPLATES: Record<DeviceId, DeviceTemplate> = {
  webapp: {
    id: 'webapp',
    label: 'Web application (client-owned)',
    summary: 'A client web application reachable over HTTP(S); the WA-* battery, opt-in.',
    phases: PHASES,
    tools: [
      ...ENGAGEMENT_TOOLS, ...RESEARCH_TOOLS, ...WEB_TOOLS, ...RESILIENCE_TOOLS,
      'nmap_exec',
    ],
    evidence: [
      'Exact request and exact response bytes, with the identity used.',
      'A sibling path or unauthorized identity that does NOT show the defect.',
      'The response must demonstrate execution or exposure — not a status code alone.',
    ],
    prerequisites: [
      'Test accounts for any authenticated or cross-tenant item.',
      'Operator-controlled callback/DNS for out-of-band items.',
    ],
  },

  secscan: {
    id: 'secscan',
    label: 'Hosted scanner surface (SS-*)',
    summary: 'The SecScan product surface: API, auth, billing, tenant boundaries.',
    phases: PHASES,
    tools: [
      ...ENGAGEMENT_TOOLS, ...RESEARCH_TOOLS, ...WEB_TOOLS, ...RESILIENCE_TOOLS,
      'nmap_exec',
    ],
    evidence: [
      'Request/response pair with the account and tenant named.',
      'Cross-tenant proof must show a value unique to the other tenant.',
      'Rate-limit findings must show the absence of any throttle across the batch.',
    ],
    prerequisites: [
      'Two accounts on different tenants for isolation items.',
      'An API key per account for authenticated probes.',
    ],
  },

  seclayer: {
    id: 'seclayer',
    label: 'Seclayer service surface (SL-*)',
    summary: 'The Seclayer scanning service: job isolation, webhooks, quota, report integrity.',
    phases: PHASES,
    tools: [
      ...ENGAGEMENT_TOOLS, ...RESEARCH_TOOLS, ...WEB_TOOLS, ...RESILIENCE_TOOLS,
      'nmap_exec',
    ],
    evidence: [
      'Job id and scan id carried through the request and the response.',
      'Webhook signature verified against the delivered body.',
      'Cross-account reads must show data belonging to the other account.',
    ],
    prerequisites: [
      'A second account with its own API key.',
      'A webhook receiver under operator control.',
    ],
  },

  windows: {
    id: 'windows',
    label: 'Windows workstation/server (WS-*)',
    summary: 'A Windows host: SMB/RPC/RDP/WinRM, services, tasks, AD, credential stores.',
    phases: PHASES,
    tools: [
      ...ENGAGEMENT_TOOLS, ...RESEARCH_TOOLS, ...WINDOWS_HOST_TOOLS, ...IDENTITY_TOOLS,
      ...CREDENTIAL_TOOLS, ...RESILIENCE_TOOLS,
    ],
    evidence: [
      'Command output captured verbatim from the host, with the account context.',
      'Registry/service/ACL values quoted with their exact path.',
      'A negative control: the same read as an identity without the right.',
    ],
    prerequisites: [
      'Test-account credentials (WinRM/SMB/RDP) provisioned by the operator.',
      'Kerberos ticket material for pass-the-ticket items.',
      'A human operator for shadowing items.',
    ],
  },

  linux: {
    id: 'linux',
    label: 'Linux server (LX-*)',
    summary: 'A Linux host: SSH, services, permissions, SUID, NFS, containers.',
    phases: PHASES,
    tools: [
      ...ENGAGEMENT_TOOLS, ...RESEARCH_TOOLS, ...LINUX_HOST_TOOLS, ...RESILIENCE_TOOLS,
      // Offline cracking applies to Linux; pass-the-hash is a Windows primitive.
      'john_exec',
    ],
    evidence: [
      'Command output captured verbatim from the host, with the account context.',
      'SUID/ACL/mount evidence quoted with exact paths and modes.',
      'A negative control: the same command as an unprivileged identity.',
    ],
    prerequisites: [
      'Test-account SSH credentials provisioned by the operator.',
      'A privileged test client for NFS mount proofs.',
    ],
  },
}

/** Every device template, in a stable order for prompts and reports. */
export const DEVICE_ORDER: readonly DeviceId[] = ['webapp', 'secscan', 'seclayer', 'windows', 'linux']
