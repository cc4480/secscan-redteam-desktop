/**
 * Target-family protocols (the "no headless chicken" layer).
 *
 * Every engagement binds to exactly ONE target family before any seat acts.
 * The family decides, mechanically:
 *
 *   - what the recon seat enumerates first (platform, not pages),
 *   - which skills ride in each seat's prompt (a Windows host gets AD/SMB/
 *     WinRM tooling, never webapp-scan; an Android app gets mobile static and
 *     dynamic analysis, never nmap-first),
 *   - which ordered steps exist, who owns each, what each step must collect,
 *     and what evidence closes it,
 *   - what the seat may NOT do on that family.
 *
 * A seat acts inside the CURRENT step only. A tool outside the step's allowlist
 * needs a recorded rationale naming the step it serves; an unmapped family runs
 * the DETECTION step before anything else. A step with no applicable surface is
 * closed with a recorded verdict carrying the observation that proves it — never
 * silently skipped and never marked clean.
 */
/** Law every seat carries, whatever the family. */
export const PROTOCOL_LAW = [
    'One engagement, one target family. Bind the family before the first action.',
    'Act inside the current step only. Cite its step id (e.g. WIN-03) in the action rationale.',
    'A tool outside the current step\'s allowlist requires a recorded rationale naming the step it serves.',
    'A step with no applicable surface is closed with a recorded verdict + the observation proving it. Never silent, never "clean".',
    'Non-destructive always: no writes, no deletes, no account or credential modification, no DoS, no exfiltration beyond proof.',
    'Two independent observations before any finding. One observation is a lead, not a finding.',
].join('\n');
/** Web application / API. */
const WEBAPP = {
    family: 'webapp',
    label: 'Web application / HTTP API',
    intelligence: [
        'Scheme, host, port and TLS posture',
        'Server + framework fingerprint and version',
        'Auth model: anonymous, session, token, SSO',
        'Route surface: linked pages, forms, JSON endpoints',
    ],
    confirm: 'HTTP(S) endpoint answers; server/framework fingerprint readable.',
    steps: [
        {
            id: 'WEB-01',
            title: 'Passive scan + fingerprint',
            owner: 'recon',
            tools: ['secscan_exec', 'bridge_http_headers', 'bridge_tls_info', 'bridge_dns_query'],
            collect: ['server/framework versions', 'TLS posture', 'security headers', 'cookies and their flags', 'robots/sitemap/exposed files'],
            done: 'Stack and entry surface are named, with the scan report kept as evidence.',
            evidence: 'scan report + header/TLS capture',
        },
        {
            id: 'WEB-02',
            title: 'Route and parameter inventory',
            owner: 'recon',
            tools: ['ffuf_exec', 'nikto_exec', 'http_probe'],
            collect: ['paths and status codes', 'parameters per route', 'auth-gated vs public routes', 'alternate methods'],
            done: 'Every parameter the exploiter will mutate is on the shared target map with a route and auth state.',
            evidence: 'discovery output + target map entries',
        },
        {
            id: 'WEB-03',
            title: 'Authentication and session behavior',
            owner: 'exploiter',
            tools: ['http_probe', 'nuclei_exec'],
            collect: ['login flow and token shape', 'session invalidation behavior', 'password reset / registration edges'],
            done: 'Auth boundaries are mapped and the first bypass hypothesis is recorded.',
            evidence: 'request/response pairs with identities',
        },
        {
            id: 'WEB-04',
            title: 'Injection and logic probes',
            owner: 'exploiter',
            tools: ['nuclei_exec', 'sqlmap_exec', 'http_probe', 'burst_probe'],
            collect: ['injection class per parameter', 'server-side behavior on malformed input', 'rate-limit posture (burst_probe once)'],
            done: 'Each hypothesis is PROVEN with two observations or killed with the killing observation recorded.',
            evidence: 'canary marker sent + echoed, with the exact request',
        },
        {
            id: 'WEB-05',
            title: 'Access control and object-level checks',
            owner: 'exploiter',
            tools: ['http_probe'],
            collect: ['object ownership checks', 'function-level auth', 'cross-role/tenant reads'],
            done: 'Every object/function boundary tested from the unauthorized identity, with the negative control.',
            evidence: 'authorized vs unauthorized pair',
        },
    ],
    forbidden: [
        'Destructive writes, deletes, or configuration changes on the target',
        'Credential stuffing or password spraying against real user accounts',
        'Data exfiltration beyond the single artifact that proves access',
    ],
    seatTasks: {
        coordinator: 'Bind family webapp, publish the step plan, open WEB-01 and name each transition by step id. Own scope and stop conditions.',
        recon: 'Own WEB-01 and WEB-02: fingerprint the stack, inventory every route and parameter, keep the shared target map current.',
        exploiter: 'Own WEB-03, WEB-04 and WEB-05: prove or kill every hypothesis with two observations and a negative control.',
        reporter: 'Convert only evidenced steps into findings; name each finding\'s endpoint shape, payload class and proof type.',
        coder: 'Build the payload, harness or parser a proving step needs, scoped to the mechanism under test.',
        publisher: 'Assemble the report and attestation; verify every claim traces to a recorded step and evidence bundle.',
    },
    skills: {
        coordinator: ['redteam-ops-coordination'],
        recon: ['deep-research-osint', 'webapp-scan'],
        exploiter: ['webapp-exploit', 'browser-action-execution'],
        reporter: ['findings-grading-reporting', 'html-report-design'],
        coder: ['exploit-coding-toolbuilding'],
        publisher: ['findings-grading-reporting', 'html-report-design'],
    },
};
/** Windows host (with optional AD). */
const WINDOWS = {
    family: 'windows',
    label: 'Windows host / Active Directory',
    intelligence: [
        'Open TCP services and their versions (445/139/3389/5985/5986/88/389)',
        'Host role: workstation, member server, or domain controller',
        'Domain name, membership and reachable DCs',
        'SMB signing and NLA posture',
    ],
    confirm: 'SMB/WinRM/RDP listener answers, or WinRM SESSION_SETUP succeeds.',
    steps: [
        {
            id: 'WIN-01',
            title: 'Host and service discovery',
            owner: 'recon',
            // http_probe is discovery, not exploitation: a Windows host commonly runs a
            // web surface, and no other WIN step admits an HTTP tool at all.
            tools: ['nmap_exec', 'bridge_tcp_check', 'winrm_probe', 'http_probe'],
            collect: ['open ports + versions', 'OS family/version', 'SMB signing', 'WinRM auth schemes', 'RDP NLA', 'web banner, headers, TLS and admin-surface presence'],
            done: 'Services and posture are on the target map; host role is stated.',
            evidence: 'nmap XML-derived port/service list + probe output',
        },
        {
            id: 'WIN-02',
            title: 'Authentication reachability',
            owner: 'exploiter',
            tools: ['winrm_exec', 'smb_exec', 'rdp_auth', 'ssh_exec'],
            collect: ['which supplied credential works where', 'share exposure', 'remote execution reach'],
            done: 'Test-account access is proven or ruled out per service, with the failure observed.',
            evidence: 'successful command output + the denied parallel',
        },
        {
            id: 'WIN-03',
            title: 'Directory enumeration (AD present)',
            owner: 'recon',
            tools: ['ad_enum', 'smb_exec'],
            collect: ['users/groups/computers', 'ACLs granting non-Tier-0 principals', 'ADCS template conditions', 'computed attack paths'],
            done: 'Attack paths to Tier-0 are computed offline and recorded, or AD is proven absent.',
            evidence: 'enumeration output, paths as data (never executed)',
        },
        {
            id: 'WIN-04',
            title: 'Host enumeration through access',
            owner: 'exploiter',
            tools: ['winrm_exec', 'msf_exec'],
            collect: ['local privilege posture', 'services and unquoted paths', 'scheduled tasks', 'installed security controls'],
            done: 'Privilege-escalation hypotheses are listed with the evidence that scopes them.',
            evidence: 'command transcripts',
        },
        {
            id: 'WIN-05',
            title: 'Credential-material proof (authorized only)',
            owner: 'exploiter',
            tools: ['msf_exec'],
            collect: ['count/type of credential artifacts', 'proof artifact reference'],
            done: 'A single artifact proving the exposure is referenced; no bulk extraction retained.',
            evidence: 'sealed evidence reference + counts only',
        },
    ],
    forbidden: [
        'Domain-wide credential dumps retained or copied',
        'Usable credential modification, persistence, or account changes',
        'Real-user password spraying or lockout-triggering attempts',
    ],
    seatTasks: {
        coordinator: 'Bind family windows, publish the step plan, and refuse any host probe that is not in scope or not under a step id.',
        recon: 'Own WIN-01 and WIN-03: services/versions, host role, SMB signing, WinRM/RDP posture, then AD/ACL/ADCS enumeration with paths computed offline only.',
        exploiter: 'Own WIN-02, WIN-04 and WIN-05: prove which supplied credential reaches what, enumerate privilege posture through access, reference one credential artifact as proof.',
        reporter: 'Report host posture and reach with the exact command transcript; state plainly that computed paths were not executed.',
        coder: 'Build the execution or parsing helper a proving step needs; nothing that weakens the host or persists.',
        publisher: 'Assemble the report and attestation; cite ports, versions and transcripts as evidence, not impressions.',
    },
    skills: {
        coordinator: ['redteam-ops-coordination'],
        recon: ['scanning-network-with-nmap-advanced', 'performing-windows-artifact-analysis-with-eric-zimmerman-tools'],
        exploiter: ['performing-privilege-escalation-assessment', 'moving-laterally-with-netexec', 'performing-credential-access-with-lazagne'],
        reporter: ['findings-grading-reporting', 'html-report-design'],
        coder: ['exploit-coding-toolbuilding'],
        publisher: ['findings-grading-reporting', 'html-report-design'],
    },
};
/** Linux host. */
const LINUX = {
    family: 'linux',
    label: 'Linux host',
    intelligence: [
        'Open TCP services and versions (22/80/443/2049/111/3306/5432)',
        'Distribution and kernel',
        'Exposed file services (NFS/SMB exports)',
        'Web stack presence and version',
    ],
    confirm: 'SSH banner answers, or an exposed service identifies a Linux distro.',
    steps: [
        {
            id: 'LNX-01',
            title: 'Service and OS discovery',
            owner: 'recon',
            tools: ['nmap_exec', 'bridge_tcp_check', 'nfs_enum'],
            collect: ['open ports + versions', 'distro/kernel', 'exported filesystems and grants', 'web stack'],
            done: 'Services and exports are on the target map with versions.',
            evidence: 'nmap-derived service list + export listing',
        },
        {
            id: 'LNX-02',
            title: 'Access and authentication',
            owner: 'exploiter',
            tools: ['ssh_exec', 'ssh_agent_audit'],
            collect: ['which supplied credential works', 'agent-forwarding exposure', 'key/permission posture'],
            done: 'Access is proven with a command transcript, or ruled out per service.',
            evidence: 'command output + denied parallel',
        },
        {
            id: 'LNX-03',
            title: 'Local enumeration through access',
            owner: 'exploiter',
            tools: ['ssh_exec'],
            collect: ['sudo rights', 'SUID/SGID binaries', 'cron and systemd timers', 'writable service paths', 'credential files in reach'],
            done: 'Every escalation hypothesis has the observation that scopes it.',
            evidence: 'command transcripts',
        },
        {
            id: 'LNX-04',
            title: 'Exposed application layer',
            owner: 'exploiter',
            tools: ['nuclei_exec', 'ffuf_exec', 'http_probe'],
            collect: ['web app on the host', 'known-CVE checks', 'exposed admin surfaces'],
            done: 'Host web surface tested to the same bar as a webapp engagement, or proven absent.',
            evidence: 'template output + request/response pair',
        },
    ],
    forbidden: [
        'Service disruption, package installs, or config changes on the host',
        'Bulk copying of /etc/shadow or credential stores beyond the proof artifact',
        'Data exfiltration beyond the single demonstrating artifact',
    ],
    seatTasks: {
        coordinator: 'Bind family linux, publish the step plan, and stop the run if a host outside scope appears in a probe.',
        recon: 'Own LNX-01: ports, versions, distro/kernel, NFS exports and their grants — the whole surface before any login.',
        exploiter: 'Own LNX-02, LNX-03 and LNX-04: prove access with a transcript, enumerate sudo/SUID/cron/writable paths, then test the exposed app layer to the webapp bar.',
        reporter: 'Report each escalation hypothesis as proven or ruled out, with the command that settled it.',
        coder: 'Build the enumeration or payload helper a step needs; no package installs, no config changes on the host.',
        publisher: 'Assemble the report and attestation; keep host artifacts to the single proof each finding needs.',
    },
    skills: {
        coordinator: ['redteam-ops-coordination'],
        recon: ['scanning-network-with-nmap-advanced', 'analyzing-linux-system-artifacts'],
        exploiter: ['performing-privilege-escalation-on-linux', 'performing-linux-log-forensics-investigation'],
        reporter: ['findings-grading-reporting', 'html-report-design'],
        coder: ['exploit-coding-toolbuilding'],
        publisher: ['findings-grading-reporting', 'html-report-design'],
    },
};
/** Android application. */
const ANDROID = {
    family: 'android',
    label: 'Android application',
    intelligence: [
        'Artifact: APK/AAB path and SHA-256',
        'Package id, version, min/target SDK',
        'Declared permissions and exported components',
        'Backend API hosts referenced by the app',
    ],
    confirm: 'An APK/AAB artifact is supplied by the operator and hashed.',
    steps: [
        {
            id: 'AND-01',
            title: 'Acquire and hash the artifact',
            owner: 'recon',
            tools: ['http_probe', 'bridge_file_info'],
            collect: ['artifact path', 'SHA-256', 'signing certificate', 'package id and version'],
            done: 'Hashed artifact on record; the analysis target is fixed by hash.',
            evidence: 'hash + package metadata',
        },
        {
            id: 'AND-02',
            title: 'Static triage',
            owner: 'recon',
            tools: ['pc_run'],
            collect: ['manifest + permissions', 'exported activities/services/receivers/providers', 'hardcoded secrets and endpoints', 'native libs', 'backup/cleartext flags'],
            done: 'Exported surface and secrets are enumerated; each risky flag is named with its line of evidence.',
            evidence: 'decompiled manifest extract + findings table',
        },
        {
            id: 'AND-03',
            title: 'Dynamic analysis',
            owner: 'exploiter',
            tools: ['pc_run'],
            collect: ['runtime storage writes', 'certificate pinning behavior', 'IPC abuse results', 'keychain/keystore handling'],
            done: 'Each static hypothesis is proven at runtime or killed with the observation.',
            evidence: 'hook transcript / captured traffic',
        },
        {
            id: 'AND-04',
            title: 'Backend API layer',
            owner: 'exploiter',
            tools: ['http_probe', 'nuclei_exec'],
            collect: ['auth model of the mobile API', 'object-level authorization', 'token handling'],
            done: 'Mobile API tested with the app\'s own identity: BOLA/auth hypotheses proven or killed.',
            evidence: 'request/response pairs from the app identity',
        },
    ],
    forbidden: [
        'Installing the application on a non-authorized device fleet',
        'Extracting real user data beyond the proof artifact',
        'Submitting findings from the artifact alone as runtime-proven',
    ],
    seatTasks: {
        coordinator: 'Bind family android, publish the step plan, and state which device fleet (if any) is authorized before AND-03 opens.',
        recon: 'Own AND-01 and AND-02: hash the artifact, then enumerate manifest, permissions, exported components, secrets and endpoints with line evidence.',
        exploiter: 'Own AND-03 and AND-04: prove each static hypothesis at runtime, then test the mobile API under the app\'s own identity.',
        reporter: 'Separate static observation from runtime proof in every finding, and never merge them.',
        coder: 'Build the Frida hook, parser or request harness a step needs, scoped to the artifact hash under test.',
        publisher: 'Assemble the report with the artifact hash, tool versions and transcripts that make each finding replayable.',
    },
    skills: {
        coordinator: ['redteam-ops-coordination'],
        recon: ['performing-android-app-static-analysis-with-mobsf', 'deep-research-osint'],
        exploiter: ['performing-dynamic-analysis-of-android-app', 'testing-android-intents-for-vulnerabilities', 'testing-mobile-api-authentication'],
        reporter: ['findings-grading-reporting', 'html-report-design'],
        coder: ['exploit-coding-toolbuilding'],
        publisher: ['findings-grading-reporting', 'html-report-design'],
    },
};
/** iOS application. */
const IOS = {
    family: 'ios',
    label: 'iOS application',
    intelligence: [
        'Artifact: IPA path and SHA-256',
        'Bundle id, version, minimum iOS',
        'Entitlements and Info.plist posture (ATS, URL schemes)',
        'Backend API hosts referenced by the app',
    ],
    confirm: 'An IPA artifact is supplied by the operator and hashed.',
    steps: [
        {
            id: 'IOS-01',
            title: 'Acquire and hash the artifact',
            owner: 'recon',
            tools: ['http_probe', 'bridge_file_info'],
            collect: ['artifact path', 'SHA-256', 'bundle id and version', 'signing identity'],
            done: 'Hashed artifact on record; the analysis target is fixed by hash.',
            evidence: 'hash + bundle metadata',
        },
        {
            id: 'IOS-02',
            title: 'Static triage',
            owner: 'recon',
            tools: ['pc_run'],
            collect: ['Info.plist: ATS exceptions, URL schemes', 'entitlements', 'embedded frameworks', 'hardcoded secrets and endpoints', 'binary protections (PIE/ARC/stack canary)'],
            done: 'Transport, scheme and secret posture enumerated with evidence per item.',
            evidence: 'plist/entitlement extracts + findings table',
        },
        {
            id: 'IOS-03',
            title: 'Dynamic analysis',
            owner: 'exploiter',
            tools: ['pc_run'],
            collect: ['keychain access', 'filesystem storage', 'pinning behavior', 'runtime class/method surface'],
            done: 'Each static hypothesis is proven at runtime or killed with the observation.',
            evidence: 'hook transcript / captured traffic',
        },
        {
            id: 'IOS-04',
            title: 'Backend API layer',
            owner: 'exploiter',
            tools: ['http_probe', 'nuclei_exec'],
            collect: ['auth model', 'object-level authorization', 'token handling'],
            done: 'Mobile API tested with the app\'s own identity: hypotheses proven or killed.',
            evidence: 'request/response pairs from the app identity',
        },
    ],
    forbidden: [
        'Jailbreak/provisioning changes on non-authorized devices',
        'Extracting real user data beyond the proof artifact',
        'Presenting static-only observations as runtime-proven findings',
    ],
    seatTasks: {
        coordinator: 'Bind family ios, publish the step plan, and state which devices (if any) are authorized before IOS-03 opens.',
        recon: 'Own IOS-01 and IOS-02: hash the IPA, then enumerate Info.plist (ATS, URL schemes), entitlements, frameworks, secrets and binary protections.',
        exploiter: 'Own IOS-03 and IOS-04: prove keychain/storage/pinning behavior at runtime, then test the mobile API under the app\'s own identity.',
        reporter: 'Separate static observation from runtime proof in every finding; no jailbreak claims without the device record.',
        coder: 'Build the Objection/Frida script or request harness a step needs, scoped to the bundle under test.',
        publisher: 'Assemble the report with the IPA hash, tool versions and transcripts that make each finding replayable.',
    },
    skills: {
        coordinator: ['redteam-ops-coordination'],
        recon: ['performing-ios-app-security-assessment', 'deep-research-osint'],
        exploiter: ['analyzing-ios-app-security-with-objection', 'reverse-engineering-ios-app-with-frida', 'testing-mobile-api-authentication'],
        reporter: ['findings-grading-reporting', 'html-report-design'],
        coder: ['exploit-coding-toolbuilding'],
        publisher: ['findings-grading-reporting', 'html-report-design'],
    },
};
/** Bare network / unspecified host: discovery first, then branch. */
const NETWORK = {
    family: 'network',
    label: 'Network / unclassified host (discovery-first)',
    intelligence: [
        'Live host confirmation',
        'Open TCP ports and service banners',
        'OS family hints from TTL/banner/service mix',
    ],
    confirm: 'Host answers on at least one probed port.',
    steps: [
        {
            id: 'NET-01',
            title: 'Host and port discovery',
            owner: 'recon',
            tools: ['nmap_exec', 'bridge_tcp_check'],
            collect: ['open ports', 'service/version per port', 'host-up evidence'],
            done: 'The host surface is on the target map.',
            evidence: 'nmap-derived port list',
        },
        {
            id: 'NET-02',
            title: 'Classify and bind the real family',
            owner: 'coordinator',
            tools: [],
            collect: ['family decision + reason', 'protocol swap recorded on the board'],
            done: 'A concrete family (webapp/windows/linux) is bound; its protocol replaces this one.',
            evidence: 'classification note with the observation that decided it',
        },
    ],
    forbidden: [
        'Running exploitation from the discovery protocol without a bound family',
        'Scanning hosts outside the engagement scope',
    ],
    seatTasks: {
        coordinator: 'Bind discovery-first, then own NET-02: name the concrete family, record the observation that decided it, and swap to that protocol before any exploitation.',
        recon: 'Own NET-01: host-up evidence, open ports, service versions — the facts that make classification possible.',
        exploiter: 'Stay idle: no exploitation runs under this protocol. Pick up the bound family\'s protocol instead.',
        reporter: 'Hold: nothing is reportable until a concrete family is bound and its steps produce evidence.',
        coder: 'Build the discovery/parser helper a step needs; nothing that fires at a host before classification.',
        publisher: 'Hold the report open and label the run "discovery only — family unbound" if the engagement ends here.',
    },
    skills: {
        coordinator: ['redteam-ops-coordination'],
        recon: ['scanning-network-with-nmap-advanced', 'conducting-network-penetration-test'],
        exploiter: ['conducting-network-penetration-test'],
        reporter: ['findings-grading-reporting', 'html-report-design'],
        coder: ['exploit-coding-toolbuilding'],
        publisher: ['findings-grading-reporting', 'html-report-design'],
    },
};
/** Every protocol, by family, before the shared seat steps are appended. */
const BASE_PROTOCOLS = {
    webapp: WEBAPP,
    windows: WINDOWS,
    linux: LINUX,
    android: ANDROID,
    ios: IOS,
    network: NETWORK,
};
/**
 * The three steps every family ends with (A5). The seat audit found coder,
 * evaluator-reporter and publisher owning ZERO steps across all six families,
 * which made "has tools" true and "has a job in the plan" false. These are
 * their jobs, in the same shape as every other step: owner, tools, what to
 * collect, done-criteria, evidence.
 */
const SHARED_TAIL = [
    {
        title: 'Build the helper the proving step needs',
        owner: 'coder',
        tools: ['pc_run', 'load_skill'],
        collect: [
            'what the proving step needs that the offered tools cannot do',
            'the built artifact, where it lives, and how it is invoked',
        ],
        done: 'The helper exists, runs on the analysis host, and is cited by the step that uses it.',
        evidence: 'helper path + the local run that proves it works',
    },
    {
        title: 'Evaluate proofs and gate the report',
        owner: 'reporter',
        tools: ['record_finding', 'record_item_verdict'],
        collect: [
            "every finding's two independent observations",
            'the negative control for each finding',
            'every killed hypothesis and its killing observation',
        ],
        done: 'Every finding carries two observations plus a negative control, or is downgraded to DETECTED.',
        evidence: 'finding records with receipts; verdict ledger complete',
    },
    {
        title: 'Assemble the uniform report set',
        owner: 'publisher',
        tools: [],
        collect: [
            'the fixed manifest from the house template',
            'findings grouped into key risk areas with ranked actions',
        ],
        done: 'Exactly one .md, one .txt, one .csv and one HTML from the house template exist, same names every run.',
        evidence: 'file-set listing from the engagement report directory',
    },
];
/**
 * Append the shared seat steps, numbered into the family's own sequence.
 * @param protocol - the family's protocol before the shared tail.
 * @returns the protocol with the three shared steps appended.
 */
function withSharedTail(protocol) {
    const prefix = protocol.steps[0].id.split('-')[0];
    const start = protocol.steps.length + 1;
    const extra = SHARED_TAIL.map((blueprint, index) => ({
        id: `${prefix}-${String(start + index).padStart(2, '0')}`,
        title: blueprint.title,
        owner: blueprint.owner,
        tools: blueprint.tools,
        collect: blueprint.collect,
        done: blueprint.done,
        evidence: blueprint.evidence,
    }));
    return { ...protocol, steps: [...protocol.steps, ...extra] };
}
/** Every protocol, by family — the family's own steps, then the shared three. */
export const TARGET_PROTOCOLS = Object.fromEntries(Object.entries(BASE_PROTOCOLS)
    .map(([family, protocol]) => [family, withSharedTail(protocol)]));
/** Declared engagement family names → protocol family. */
const DECLARED_FAMILIES = {
    webapp: 'webapp',
    web: 'webapp',
    api: 'webapp',
    secscan: 'webapp',
    seclayer: 'webapp',
    windows: 'windows',
    linux: 'linux',
    android: 'android',
    ios: 'ios',
    network: 'network',
};
/**
 * Bind a target to exactly one family BEFORE any seat acts.
 *
 * Order: the operator's declared family wins (it is the engagement's own
 * statement); otherwise the target's shape infers it; otherwise the engagement
 * binds `network` and the protocol's first act is classification. An
 * unrecognized declared value never silently becomes another family.
 *
 * @param input - the engagement target and any declared target families.
 * @returns the binding, with the reason recorded for the board.
 */
export function bindTargetFamily(input) {
    const declared = (input.declared ?? [])
        .map(value => value.trim().toLowerCase())
        .filter(value => value !== '');
    for (const value of declared) {
        const family = DECLARED_FAMILIES[value];
        if (family !== undefined) {
            return { family, reason: `operator declared target family "${value}"`, confidence: 'declared' };
        }
    }
    const target = input.target.trim().toLowerCase();
    if (target === '') {
        return { family: 'network', reason: 'no target shape to bind; discovery-first', confidence: 'default' };
    }
    if (target.endsWith('.apk') || target.endsWith('.aab') || target.includes('android')) {
        return { family: 'android', reason: 'target names an Android artifact', confidence: 'inferred' };
    }
    if (target.endsWith('.ipa') || target.includes('ios')) {
        return { family: 'ios', reason: 'target names an iOS artifact', confidence: 'inferred' };
    }
    if (/^https?:\/\//.test(target) || target.includes('/')) {
        return { family: 'webapp', reason: 'target is an HTTP URL', confidence: 'inferred' };
    }
    if (/:(445|139|3389|5985|5986|88|389)\b/.test(target)) {
        return { family: 'windows', reason: 'target names a Windows service port', confidence: 'inferred' };
    }
    if (/:(22|2049)\b/.test(target)) {
        return { family: 'linux', reason: 'target names an SSH/NFS port', confidence: 'inferred' };
    }
    return { family: 'network', reason: 'host without a decisive service hint; discovery-first', confidence: 'default' };
}
/**
 * The skills one seat binds for a family.
 * @param role - the fleet seat.
 * @param family - the bound family.
 * @returns the skill names to bind (Layer-2 bodies).
 */
export function skillsForRole(role, family) {
    return TARGET_PROTOCOLS[family].skills[role];
}
/**
 * Render the protocol as the prompt block every seat carries.
 * @param binding - the family binding to render.
 * @returns markdown block: law, family, ordered steps with owner/tools/exit.
 */
export function protocolPromptBlock(binding) {
    const protocol = TARGET_PROTOCOLS[binding.family];
    const lines = [
        `## TARGET PROTOCOL — ${protocol.label} (family: ${protocol.family})`,
        '',
        `Bound because: ${binding.reason} (${binding.confidence}).`,
        `Confirm on target: ${protocol.confirm}`,
        '',
        '### Protocol law',
        '```text',
        PROTOCOL_LAW,
        '```',
        '',
        '### Intelligence to establish first',
        ...protocol.intelligence.map(item => `- ${item}`),
        '',
        '### Ordered steps — act inside the current one only',
    ];
    for (const step of protocol.steps) {
        lines.push('', `#### ${step.id} — ${step.title}`, `- Owner: \`${step.owner}\``, `- Tools: ${step.tools.length > 0 ? step.tools.map(tool => `\`${tool}\``).join(', ') : '_none — decision step_'}`, `- Collect: ${step.collect.join('; ')}`, `- Closes when: ${step.done}`, `- Evidence: ${step.evidence}`);
    }
    lines.push('', '### Assigned task per seat — no seat is undefined', ...Object.entries(protocol.seatTasks).map(([seat, task]) => `- **${seat}** — ${task}`), '', '### Wrong for this family — do not do these', ...protocol.forbidden.map(item => `- ${item}`), '', '### Your seat in this protocol', 'Coordinator owns phase transitions and must name the step id it is moving to.', 'Recon owns every enumeration step; it does not exploit.', 'Exploiter owns every proving step; it does not enumerate from scratch.', 'Reporter records only steps with evidence, and names any step that closed as not-applicable.', 'A step may not be skipped silently. Close it with evidence or a recorded verdict.');
    return lines.join('\n');
}
//# sourceMappingURL=target-protocol.js.map