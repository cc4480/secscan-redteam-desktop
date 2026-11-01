export const MSF_EXEC_TOOL = {
    name: "msf_exec",
    description: "Metasploit bridge: CVE-specific exploit validation and W8 post-exploitation (Windows/Linux host targets). Actions: 'search' (module database query, recon-safe), 'suggest' (service+version → ranked candidate modules for coordinator approval — never fires), 'run' (ONE exploit/auxiliary module; EXPLOIT PHASE ONLY, after coordinator sign-off — with a generic payload the runner-built canary marker is the only payload action; with a Meterpreter session payload the run's session opens as the mechanical follow-through, is proven by the marker echoing through it, and the result returns its session handle), 'session_command' (ONE command through an open session, by runner-issued sessionHandle; every command + full response is written to the engagement event log), 'credential_dump' (gather credential material through an open session — dumpKind: hashdump, smart_hashdump, cachedump, lsa_secrets, credential_collector, gpp, chrome, firefox, ssh_creds, linux_hashdump, kiwi; raw output is SEALED to the engagement evidence store — the result carries counts/types + the evidence reference only), 'session_close' (stop the session, forget the handle). Sessions exist ONLY because a validated 'run' opened them — there is no free-standing session open, and a handle is bound to the host it was exploited on. Policy: dos/destructive modules refused, only generic cmd payloads and Meterpreter session payloads, post modules limited to the curated credential/browser/OS-store gathers, stray sessions from non-session runs stopped. Requires msfrpcd (REDTEAM_MSFRPC_* env). In-scope hosts only (runner-enforced). Include attackId (a real ATT&CK ID such as 'T1190' — the coordinator rejects anything else), the CVE in 'cve', category, targetProfile ('windows'|'linux' — never inferred), hypothesis.",
    parameters: {
        type: "object",
        properties: {
            action: { type: "string", enum: ["search", "suggest", "run", "session_command", "credential_dump", "session_close"] },
            host: { type: "string" },
            query: { type: "string" },
            service: { type: "string" },
            version: { type: "string" },
            cve: { type: "string" },
            platform: { type: "string", enum: ["windows", "linux"] },
            moduleType: { type: "string", enum: ["exploit", "auxiliary"] },
            module: { type: "string" },
            options: { type: "object", additionalProperties: { type: "string" } },
            payload: { type: "string" },
            sessionHandle: { type: "string" },
            command: { type: "string" },
            dumpKind: {
                type: "string",
                enum: ["hashdump", "smart_hashdump", "cachedump", "lsa_secrets", "credential_collector", "gpp", "chrome", "firefox", "ssh_creds", "linux_hashdump", "kiwi"],
            },
            attackId: { type: "string" },
            category: { type: "string", enum: ["logic", "functionality", "validation"] },
            targetProfile: { type: "string", enum: ["windows", "linux"] },
            hypothesis: { type: "string" },
        },
        required: ["action", "host", "category"],
    },
};
//# sourceMappingURL=msf.js.map