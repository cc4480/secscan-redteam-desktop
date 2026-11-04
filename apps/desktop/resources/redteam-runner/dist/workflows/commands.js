/** Every command the operator can use. */
export const COMMANDS = [
    {
        name: "/pcscan",
        summary: "Local host assessment of THIS workstation: on-host inventory and posture collection, misconfigurations, missing patches, then an HTML report with the host-inventory section.",
        usage: "/pcscan [quick|full]",
        phases: ["recon", "exploit", "report"],
        targets: ["windows"],
        tools: [
            "pc_observe",
            "system_info", "list_processes", "list_dir", "read_file",
        ],
        tier: 1,
        requiresApproval: false,
        artifacts: ["report.html", "report.md", "host-inventory.json", "trajectory.json"],
        local: true,
    },
    {
        name: "/scan",
        summary: "Fast authorized scan: recon plus the validation battery, no exploitation. Ends with the HTML report.",
        usage: "/scan <target> [family]",
        phases: ["recon", "exploit", "report"],
        targets: ["webapp"],
        tools: ["secscan_exec", "http_probe", "nuclei_exec", "nmap_exec"],
        tier: 1,
        requiresApproval: false,
        artifacts: ["report.html", "report.md"],
    },
    {
        name: "/deepscan",
        summary: "Full battery across the selected families with proof discipline (two observations, replay bundle). Longest run.",
        usage: "/deepscan <target> [family,...]",
        phases: ["recon", "exploit", "report"],
        targets: ["webapp", "windows", "linux"],
        tools: [
            "secscan_exec", "http_probe", "burst_probe", "nmap_exec", "nuclei_exec",
            "sqlmap_exec", "ffuf_exec", "gobuster_exec", "nikto_exec",
            "ssh_exec", "smb_exec", "winrm_exec", "ad_enum",
        ],
        tier: 1,
        requiresApproval: true,
        artifacts: ["report.html", "report.md", "proof/", "coverage"],
    },
    {
        name: "/nmap",
        summary: "Port and service discovery only, through the nmap bridge profiles (quick/service/full/udp/os).",
        usage: "/nmap <host> [quick|service|full|udp|os]",
        phases: ["recon", "report"],
        targets: ["windows", "linux"],
        tools: ["nmap_exec"],
        tier: 0,
        requiresApproval: false,
        artifacts: ["report.html"],
    },
    {
        name: "/nuclei",
        summary: "Template-based checks through the nuclei bridge (templates then run). Exploit phase only.",
        usage: "/nuclei <host> [tags,...]",
        phases: ["recon", "exploit", "report"],
        targets: ["webapp"],
        tools: ["nuclei_exec"],
        tier: 1,
        requiresApproval: false,
        artifacts: ["report.html"],
    },
    {
        name: "/metasploit",
        summary: "CVE validation through the Metasploit bridge: search/suggest in recon, run (canary payload) in exploit.",
        usage: "/metasploit <host> [cve]",
        phases: ["recon", "exploit", "report"],
        targets: ["windows", "linux"],
        tools: ["msf_exec"],
        tier: 2,
        requiresApproval: true,
        artifacts: ["report.html", "proof/"],
    },
    {
        name: "/report",
        summary: "Regenerate the HTML and Markdown report from the current engagement artifacts.",
        usage: "/report [engagement-id]",
        phases: ["report"],
        targets: [],
        tools: [],
        tier: 0,
        requiresApproval: false,
        artifacts: ["report.html", "report.md"],
    },
];
/** Lookup by name, case-insensitively; `/x` and `x` both resolve. */
export function findCommand(name) {
    const normalized = name.trim().toLowerCase().startsWith("/") ? name.trim().toLowerCase() : `/${name.trim().toLowerCase()}`;
    return COMMANDS.find(command => command.name === normalized);
}
/**
 * Every registry command except /scan (the plain launch, which carries
 * no command stamp) and /report (report delivery, not a launch),
 * projected to {@link SiblingSpec}. Derived from COMMANDS so the specs
 * can never drift from the registry.
 */
export const SIBLING_COMMANDS = COMMANDS
    .filter(command => command.name !== "/scan" && command.name !== "/report")
    .map(command => ({
    name: command.name.slice(1),
    tier: command.tier,
    phases: command.phases,
    targets: command.targets,
    requiresApproval: command.requiresApproval,
}));
/**
 * Resolve one sibling by name (`/x` and `x` both resolve, via
 * {@link findCommand}).
 * @param name - the command name as given by the caller.
 * @returns the sibling spec, or undefined for /scan, /report, and unknown names.
 */
export function findSiblingCommand(name) {
    const spec = findCommand(name);
    if (spec === undefined)
        return undefined;
    return SIBLING_COMMANDS.find(sibling => sibling.name === spec.name.slice(1));
}
/**
 * Parse one operator line into an invocation.
 * @param line - e.g. `/deepscan app.example.com webapp,windows`
 * @param defaultTargets - resolved targets when the line names none.
 * @returns the invocation, or an error string for an unknown command.
 */
export function parseCommand(line, defaultTargets = ["webapp"]) {
    const text = line.trim();
    if (!text.startsWith("/"))
        return `not a command: ${text.slice(0, 40)}`;
    const [head, ...args] = text.split(/\s+/u);
    const command = findCommand(head);
    if (command === undefined)
        return `unknown command ${head}; try one of ${COMMANDS.map(c => c.name).join(", ")}`;
    const named = args.flatMap(value => value.split(",")).map(value => value.trim()).filter(value => /^[a-z][a-z0-9-]*$/iu.test(value));
    const familyArgs = [];
    for (const value of named) {
        if (["secscan", "seclayer", "webapp", "windows", "linux", "cloud", "api", "ai"].includes(value.toLowerCase())) {
            familyArgs.push(value.toLowerCase());
        }
    }
    const targets = familyArgs.length > 0 ? familyArgs : command.targets.length > 0 ? command.targets : defaultTargets;
    return { command, raw: text, args, targets };
}
/**
 * Expand a command into the ordered phase plan the agent loop follows.
 * @param invocation - parsed command.
 * @returns the plan with one entry per phase.
 */
export function planCommand(invocation) {
    const { command } = invocation;
    const objective = {
        authorize: "Prove ownership and confirm the ROE (the runner enforces this mechanically).",
        plan: "Produce one operation plan; every step carries an ATT&CK ID and an expected observation.",
        recon: command.local
            ? "Collect the host inventory ON-HOST via the pc-agent channel (no network services, no test credentials) and write host-inventory.json to the engagement record."
            : "Map the surface and write every discovery to the shared target map in the same turn.",
        exploit: "Test hypotheses one tool call at a time; two independent observations per finding.",
        report: "Write findings with evidence, fix, retest, honest limits, and render the HTML report.",
    };
    return command.phases.map(phase => ({
        phase,
        objective: objective[phase] ?? "Continue the engagement.",
        tools: command.tools,
    }));
}
/**
 * Build the EngagementInput for a LOCAL command invocation (/pcscan):
 * the target is this machine's hostname, the scope is exactly that
 * hostname, and localHost is set so the collector runs on-host. The
 * old shell instead re-aimed the remote battery at the hostname and
 * stamped the run production + confirmProduction — both gone: a local
 * assessment is a staging-class run against the operator's own box,
 * attested by the operator running it.
 * @param invocation - parsed local command.
 * @param host - this machine's hostname.
 * @param mode - engagement mode from the CLI (red|black).
 * @returns the engagement input for runEngagement.
 */
export function buildLocalEngagementInput(invocation, host, mode = "red") {
    if (!invocation.command.local) {
        throw new Error(`${invocation.command.name} is not a local-host command`);
    }
    return {
        target: host,
        mode,
        objective: `${invocation.command.summary} (${invocation.command.name})`,
        roe: { scope: [host] },
        targets: [...invocation.targets],
        tier: invocation.command.tier,
        phases: [...invocation.command.phases],
        localHost: true,
    };
}
/** The operator-facing help text, generated from the registry. */
export function commandHelp() {
    return COMMANDS.map(command => `${command.name.padEnd(12)} ${command.summary}\n${"".padEnd(12)} usage: ${command.usage}  [tier ${command.tier}${command.requiresApproval ? ", approval required" : ""}]`).join("\n\n");
}
//# sourceMappingURL=commands.js.map