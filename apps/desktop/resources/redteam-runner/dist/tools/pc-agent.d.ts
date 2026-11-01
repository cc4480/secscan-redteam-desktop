/**
 * Local-PC agent tool definitions (eyes / hands / robot).
 *
 * One tool per autonomy tier keeps the model-facing surface small and makes the
 * gate explicit: `pc_observe` is read-only, `pc_act` touches the visible
 * desktop, and `pc_run` is destructive and therefore requires operator approval.
 * The bridge itself is the closed tool set in `host-exec/pc-agent.ts`.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
/** Operations `pc_observe` may request; all map onto tier-0 pc-agent tools. */
export declare const PC_OBSERVE_OPERATIONS: readonly ["system_info", "list_processes", "list_dir", "read_file", "screen_snapshot", "ui_windows", "ui_tree", "ui_describe", "ui_focused", "state_hash", "clipboard_get", "wait_idle", "wait_window"];
/** Operations `pc_act` may request; all map onto tier-1 pc-agent tools. */
export declare const PC_ACT_OPERATIONS: readonly ["ui_invoke", "ui_set_value", "ui_toggle", "input_click", "input_type", "input_key", "input_scroll", "input_drag", "window_focus", "window_arrange", "window_close", "clipboard_set", "assert_element"];
/** Operations `pc_run` may request; all map onto tier-2 pc-agent tools. */
export declare const PC_RUN_OPERATIONS: readonly ["shell_exec", "shell_pwsh", "proc_kill", "fs_write", "fs_delete"];
/** Every tool name this family introduces. */
export declare const PC_AGENT_TOOL_NAMES: ReadonlySet<string>;
/** Every local-PC tool definition, in tier order. */
export declare const PC_AGENT_TOOLS: readonly JsonSchemaTool[];
