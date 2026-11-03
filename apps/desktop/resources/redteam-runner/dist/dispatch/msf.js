/**
 * Metasploit bridge tool handler: msf_exec (v0.19.0 refactor — extracted from dispatch.ts).
 */
import { BATTERY_CATEGORIES } from "../battery.js";
import { isTargetId } from "../targets.js";
import { techniqueAllowed } from "../gate.js";
import { sleep } from "../util.js";
import { noteCategoryCoverage, optStr } from "./prelude.js";
import { join } from "node:path";
import { checkMsfModule, checkMsfPayload } from "../msf/policy.js";
import { DUMP_KINDS } from "../msf/executor/credential-dump.js";
import { noteTestModeBypass, testModeOn } from "./test-mode.js";
export async function handleMsfTools(ctx, _role, phase, call, args, _seam, dispatchSignal) {
    if (call.name !== "msf_exec")
        return null;
    if (call.name === "msf_exec") {
        const attackId = typeof args["attackId"] === "string" ? args["attackId"].toUpperCase() : undefined;
        const rawCat = typeof args["category"] === "string" ? args["category"].toLowerCase() : "";
        const category = BATTERY_CATEGORIES.includes(rawCat) ? rawCat : undefined;
        if (!techniqueAllowed(attackId, ctx.input.mode, ctx.input.roe, { testMode: ctx.config?.testMode === true })) {
            return { result: `DENIED by ROE: technique ${attackId} is excluded for this engagement.`, attackId, target: String(args["host"] ?? "") };
        }
        const rawTp = typeof args["targetProfile"] === "string" ? args["targetProfile"].toLowerCase() : "";
        if (!isTargetId(rawTp) || (rawTp !== "windows" && rawTp !== "linux")) {
            return {
                result: `DENIED: msf_exec requires targetProfile "windows"|"linux" (host targets are never inferred) — got ${JSON.stringify(args["targetProfile"] ?? null)}.`,
                attackId,
                target: String(args["host"] ?? ""),
            };
        }
        const rawAction = typeof args["action"] === "string" ? args["action"] : "";
        const action = rawAction === "run" || rawAction === "suggest" || rawAction === "session_command" || rawAction === "credential_dump" || rawAction === "session_close"
            ? rawAction
            : "search";
        if ((action === "run" || action === "session_command" || action === "credential_dump") && phase !== "exploit") {
            return {
                result: `DENIED: msf_exec ${action} acts on targets through exploits/sessions — allowed in the exploit phase only, after the recon→exploit coordinator sign-off (candidate modules from 'suggest' go to the coordinator for approval first). Current phase: ${phase}.`,
                attackId,
                target: String(args["host"] ?? ""),
            };
        }
        const sessionHandle = optStr(args["sessionHandle"]);
        const sessionCommandText = optStr(args["command"]);
        const dumpKind = optStr(args["dumpKind"]);
        if (action === "session_command" && (!sessionHandle || !sessionCommandText)) {
            return {
                result: `DENIED: msf_exec session_command requires sessionHandle (issued by a validated run that opened a session) and command.`,
                attackId,
                target: String(args["host"] ?? ""),
            };
        }
        if ((action === "credential_dump" || action === "session_close") && !sessionHandle) {
            return {
                result: `DENIED: msf_exec ${action} requires sessionHandle (issued by a validated run that opened a session).`,
                attackId,
                target: String(args["host"] ?? ""),
            };
        }
        if (action === "credential_dump" && !dumpKind) {
            return {
                result: `DENIED: msf_exec credential_dump requires dumpKind (hashdump, smart_hashdump, cachedump, lsa_secrets, credential_collector, gpp, chrome, firefox, ssh_creds, linux_hashdump, kiwi).`,
                attackId,
                target: String(args["host"] ?? ""),
            };
        }
        const host = String(args["host"] ?? "");
        ctx.probesUsed++;
        noteCategoryCoverage(ctx, category, rawTp);
        const ctrl = { signal: dispatchSignal ?? new AbortController().signal };
        // TEST MODE (operator order): the executor will skip module/payload
        // policy — pre-compute the would-be denials (policy evaluated WITHOUT
        // test mode) so the bypass lands in the engagement log with its labels.
        if (action === "run" && testModeOn(ctx)) {
            const moduleType = args["moduleType"] === "auxiliary" ? "auxiliary" : "exploit";
            const wouldModule = checkMsfModule(String(args["module"] ?? ""), moduleType);
            if (wouldModule) {
                noteTestModeBypass(ctx, phase, host, `msf module policy would refuse msf_exec: ${wouldModule}`);
            }
            const wouldPayloadValue = optStr(args["payload"]) ?? (moduleType === "exploit" ? "cmd/unix/generic" : undefined);
            if (wouldPayloadValue) {
                const wouldPayload = checkMsfPayload(wouldPayloadValue);
                if (wouldPayload) {
                    noteTestModeBypass(ctx, phase, host, `msf payload policy would refuse msf_exec: ${wouldPayload}`);
                }
            }
        }
        if (action === "credential_dump" && testModeOn(ctx) && dumpKind) {
            const spec = DUMP_KINDS[dumpKind];
            if (spec?.module) {
                const wouldModule = checkMsfModule(spec.module, "post");
                if (wouldModule) {
                    noteTestModeBypass(ctx, phase, host, `msf post policy would refuse msf_exec credential_dump: ${wouldModule}`);
                }
            }
        }
        try {
            if (ctx.input.mode === "black")
                await sleep(Math.random() * 2500); // jitter
            const exec = ctx.msfExecutor;
            const t = { host, scopeHosts: ctx.hosts, signal: ctrl.signal };
            const platform = args["platform"] === "linux" ? "linux" : args["platform"] === "windows" ? "windows" : rawTp === "linux" ? "linux" : "windows";
            const res = action === "search"
                ? await exec.search({ ...t, query: optStr(args["query"]), cve: optStr(args["cve"]), service: optStr(args["service"]), platform })
                : action === "suggest"
                    ? await exec.suggest({
                        ...t,
                        service: optStr(args["service"]),
                        version: optStr(args["version"]),
                        cve: optStr(args["cve"]),
                        platform,
                    })
                    : action === "session_command"
                        ? await exec.sessionCommand({ ...t, handle: sessionHandle, command: sessionCommandText })
                        : action === "credential_dump"
                            ? await exec.credentialDump({
                                ...t,
                                handle: sessionHandle,
                                kind: dumpKind,
                                evidenceDir: join(ctx.events.dir, "evidence"),
                            })
                            : action === "session_close"
                                ? await exec.sessionClose({ ...t, handle: sessionHandle })
                                : await exec.run({
                                    ...t,
                                    moduleType: args["moduleType"] === "auxiliary" ? "auxiliary" : "exploit",
                                    module: String(args["module"] ?? ""),
                                    options: args["options"] && typeof args["options"] === "object"
                                        ? Object.fromEntries(Object.entries(args["options"])
                                            .filter(([, v]) => typeof v === "string")
                                            .map(([k, v]) => [k, v]))
                                        : undefined,
                                    payload: optStr(args["payload"]),
                                    // Runner-generated canary — the agent never chooses the marker.
                                    marker: `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(16)}`,
                                });
            if (res.refused) {
                return { result: `DENIED by msf safety policy: ${res.refused}`, attackId, target: host };
            }
            // W8 audit trail: the session lifecycle and every session interaction
            // land in the engagement event log as their own events — the generic
            // msf_exec result event carries only a truncated summary. Session
            // commands log command + full (runner-capped) response; credential
            // dumps log counts/types/reference only — raw material stays sealed.
            if (action === "run" && res.session) {
                ctx.events.append({
                    phase,
                    actor: _role,
                    action: "msf_session_opened",
                    target: host,
                    ...(attackId ? { attackId } : {}),
                    result: `Meterpreter session opened on ${host} as the mechanical follow-through of the validated run of ${String(args["module"] ?? "")} (handle ${res.session.handle}). A session is transport, not proof — the marker was proven through the session: ${res.ok}.`,
                });
            }
            if (action === "session_command" && res.ok) {
                ctx.events.append({
                    phase,
                    actor: _role,
                    action: "msf_session_command",
                    target: host,
                    ...(attackId ? { attackId } : {}),
                    result: `session command (handle ${sessionHandle}) on ${host}: ${sessionCommandText}\n--- response ---\n${res.output}`,
                });
            }
            if (action === "credential_dump" && res.evidence) {
                ctx.events.append({
                    phase,
                    actor: _role,
                    action: "msf_credential_dump",
                    target: host,
                    ...(attackId ? { attackId } : {}),
                    result: `credential dump (${dumpKind}) on ${host}: ${res.evidence.records} record(s) [${res.evidence.types.join(", ")}] sealed to ${res.evidence.path} (sha256 ${res.evidence.sha256}) — raw material sealed in the evidence store, never logged.`,
                });
            }
            if (action === "session_close" && res.ok) {
                ctx.events.append({
                    phase,
                    actor: _role,
                    action: "msf_session_closed",
                    target: host,
                    ...(attackId ? { attackId } : {}),
                    result: `Meterpreter session closed on ${host} (handle ${sessionHandle}).`,
                });
            }
            const cveTag = /^CVE-\d{4}-\d{4,7}$/i.test(String(args["cve"] ?? "")) ? ` [${String(args["cve"]).toUpperCase()}]` : "";
            const out = res.output ? ` Output: ${res.output.slice(0, 600)}` : "";
            return { result: `${res.summary}.${cveTag}${out}`, attackId, target: host, ok: res.ok };
        }
        catch (err) {
            // Fail as a tool result, never as a dispatcher crash: the executor
            // methods translate their own failures, but a throw from anywhere else
            // in this handler (eng-2026-11-02-wcsu: an msf search died with
            // "Cannot read properties of undefined (reading 'length')") must reach
            // the agent as a failed call it can route around, not an exception
            // that tears down the dispatch path.
            return { result: `msf_exec ${action} failed: ${err.message}`, attackId, target: host, ok: false };
        }
    }
    return null;
}
//# sourceMappingURL=msf.js.map