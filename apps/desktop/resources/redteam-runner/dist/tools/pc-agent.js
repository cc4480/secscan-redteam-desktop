/** Operations `pc_observe` may request; all map onto tier-0 pc-agent tools. */
export const PC_OBSERVE_OPERATIONS = [
    "system_info",
    "list_processes",
    "list_dir",
    "read_file",
    "screen_snapshot",
    "ui_windows",
    "ui_tree",
    "ui_describe",
    "ui_focused",
    "state_hash",
    "clipboard_get",
    "wait_idle",
    "wait_window",
];
/** Operations `pc_act` may request; all map onto tier-1 pc-agent tools. */
export const PC_ACT_OPERATIONS = [
    "ui_invoke",
    "ui_set_value",
    "ui_toggle",
    "input_click",
    "input_type",
    "input_key",
    "input_scroll",
    "input_drag",
    "window_focus",
    "window_arrange",
    "window_close",
    "clipboard_set",
    "assert_element",
];
/** Operations `pc_run` may request; all map onto tier-2 pc-agent tools. */
export const PC_RUN_OPERATIONS = [
    "shell_exec",
    "shell_pwsh",
    "proc_kill",
    "fs_write",
    "fs_delete",
];
/** Every tool name this family introduces. */
export const PC_AGENT_TOOL_NAMES = new Set(["pc_observe", "pc_act", "pc_run"]);
const OBSERVE_TOOL = {
    name: "pc_observe",
    description: "Observe the operator's Windows desktop through the paired local PC agent (read-only, tier 0). Use this before acting: screen_snapshot returns an image, ui_tree returns the accessibility tree with stable element refs (prefer it over pixels), ui_windows lists windows, state_hash cheaply detects change, wait_idle/wait_window wait for the UI to settle. Host inventory on the same paired machine: system_info (OS/host identity), list_processes, list_dir and read_file — the local-host collector's channel. Off-machine by default: only call it when the current task is about this workstation.",
    parameters: {
        type: "object",
        properties: {
            operation: { type: "string", enum: [...PC_OBSERVE_OPERATIONS] },
            path: { type: "string", description: "list_dir/read_file: path on the paired machine." },
            window: { type: "string", description: "Window ref from ui_windows, when the operation is window-scoped." },
            ref: { type: "string", description: "Element ref from ui_tree, for ui_describe." },
            quietMs: { type: "number", description: "wait_idle: how long the UI must stay unchanged." },
            timeoutMs: { type: "number", description: "wait_idle/wait_window deadline." },
            title: { type: "string", description: "wait_window: title substring to wait for." },
            maxNodes: { type: "number", description: "ui_tree: node cap (default 400)." },
        },
        required: ["operation"],
    },
};
const ACT_TOOL = {
    name: "pc_act",
    description: "Act on the operator's Windows desktop through the paired local PC agent (tier 1, safe actions). Prefer element addressing (ui_invoke/ui_set_value/ui_toggle with a ref from ui_tree) over coordinates. Every call returns an action receipt with before/after observation hashes and a changed flag; treat changed=false as a failed step. Add assert to verify a postcondition. Re-observe after a failed action instead of retrying blindly.",
    parameters: {
        type: "object",
        properties: {
            operation: { type: "string", enum: [...PC_ACT_OPERATIONS] },
            ref: { type: "string" },
            text: { type: "string" },
            on: { type: "boolean" },
            x: { type: "number" },
            y: { type: "number" },
            combo: { type: "string", description: "input_key: e.g. 'ctrl+shift+s'." },
            delta: { type: "number" },
            from: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
            to: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
            bounds: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } } },
            assert: { type: "object", description: "Postcondition: { exists?, enabled?, value? }." },
        },
        required: ["operation"],
    },
};
const RUN_TOOL = {
    name: "pc_run",
    description: "Destructive local commands on the operator's Windows desktop through the paired local PC agent (tier 2). Refused unless the operator enabled destructive actions for this session (REDTEAM_PC_AGENT_ALLOW_DESTRUCTIVE=1). Use shell_exec/shell_pwsh for one non-interactive command, proc_kill for one PID, fs_write/fs_delete only inside the allow-listed roots. Prefer pc_observe first.",
    parameters: {
        type: "object",
        properties: {
            operation: { type: "string", enum: [...PC_RUN_OPERATIONS] },
            command: { type: "string" },
            cwd: { type: "string" },
            timeoutMs: { type: "number" },
            pid: { type: "number" },
            path: { type: "string" },
            content: { type: "string" },
        },
        required: ["operation"],
    },
};
/** Every local-PC tool definition, in tier order. */
export const PC_AGENT_TOOLS = [OBSERVE_TOOL, ACT_TOOL, RUN_TOOL];
//# sourceMappingURL=pc-agent.js.map