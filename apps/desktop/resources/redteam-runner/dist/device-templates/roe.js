export const DEVICE_RULES = {
    webapp: {
        aggression: [
            'Every injection class, auth bypass, authz/IDOR, business-logic and race-condition attempt is in scope — chain them.',
            'Mutate state when the demonstration needs it: create the object, send the second request in the race, store the payload.',
            'Authentication, session and object-level authorization boundaries are first-class targets; attack the backend the UI hides.',
        ],
        proof: [
            'A response or state difference only you could cause (canary marker, your own object id, your own stored payload).',
            'State changes you made are reversible and cleaned up; record what you created and removed.',
        ],
        limits: [
            'No denial of service, no unbounded flooding; the sanctioned resilience probe fires a fixed-size batch once.',
            'Do not delete or overwrite the client’s real data to prove a write primitive — reach the write, stop at the proof.',
        ],
    },
    secscan: {
        aggression: [
            'Every battery item in this class is in scope: run the full set, active where the domain is verified and passive only where it is not.',
            'Chain the findings: a hit is a starting point, not a result — follow it to proven impact with a second, different observation.',
            'Once the domain is verified the gate is open: press each test to a demonstrated outcome instead of stopping at the signal.',
        ],
        proof: [
            'Two independent observations of the same defect (different input, path or tool), with the exact request and response.',
            'The negative control must fail where it should fail.',
        ],
        limits: [
            'Respect the per-target rate limits the runner enforces.',
            'A passive-only target stays passive — the verification gate decides, not the prompt.',
        ],
    },
    seclayer: {
        aggression: [
            'Treat the service as a challenger to your own evidence: everything it reports is a lead, in scope for re-proving with the runner.',
            'The aggressive tier is in scope when the operator asks for it by name; never escalate the tier on your own authority.',
            'Chain service findings back into its own engagement tests rather than accepting them as the result.',
        ],
        proof: [
            'Service output is context, never engagement evidence: re-prove anything it reports with the runner’s own two observations.',
        ],
        limits: [
            'The service scope is its own; ownership proven for this engagement is not ownership proven to the service.',
            'Spending credits is the Lead’s call, stated in the thread before the call.',
        ],
    },
    windows: {
        aggression: [
            'Host enumeration, credential access, privilege escalation, lateral movement across scoped hosts and Kerberos/AD abuse are in scope — chain them to the objective.',
            'Run the exploit, not just the check: a CVE that fingerprints but never fires is not a finding.',
            'Use the host tools on this device class to their full extent (WinRM, SMB, RDP, MSF modules).',
        ],
        proof: [
            'The command actually executed and returned its marker; an access token, a path you reached, a state you changed.',
            'Hashes or tickets you recovered are proof of reach — reference them by identifier, never dump and store them.',
        ],
        limits: [
            'Credential attempts stay inside the runner’s lockout interlock and rate limits — its purpose is to stop the client’s accounts being locked out, not to stop the attempt.',
            'No persistence, no service/account disabling, no configuration change: demonstrate reach and leave the host as found.',
            'No denial of service, ever.',
        ],
    },
    linux: {
        aggression: [
            'Full host enumeration, local privilege escalation, sudo/setuid/kernel paths, credential discovery and lateral movement across scoped hosts are in scope.',
            'Run the privilege escalation, not just the enumeration that suggests it.',
            'Use the host tools on this device class to their full extent (SSH, SMB, MSF modules, xtool binaries).',
        ],
        proof: [
            'The escalated context actually reached (uid, group, path read) and the command that reached it.',
            'Anything you wrote to the host is cleaned up and named in the report.',
        ],
        limits: [
            'No persistence: no cron/authorized_keys/systemd entry left behind, no modified system files.',
            'No destructive change to services, packages or configuration — demonstrate reach, then restore.',
            'No denial of service or resource exhaustion.',
        ],
    },
};
/**
 * Render one device class’s rules as a prompt/report block.
 * @param device - The device class.
 * @returns Markdown lines, or an empty string for an unknown class.
 */
export function renderDeviceRules(device) {
    const rules = DEVICE_RULES[device];
    if (!rules)
        return '';
    return [
        `### Rules of engagement — ${device}`,
        'Aggression (what full pressure looks like here):',
        ...rules.aggression.map((line) => `- ${line}`),
        'Proof that counts:',
        ...rules.proof.map((line) => `- ${line}`),
        'Limits (these bound where and what, never how hard you push):',
        ...rules.limits.map((line) => `- ${line}`),
    ].join('\n');
}
//# sourceMappingURL=roe.js.map