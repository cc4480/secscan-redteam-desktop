# Local-PC agent bridge

The Windows half of `apps/redteam-runner/src/host-exec/pc-agent.ts`: an MCP
Streamable-HTTP server that gives an agent **eyes** (screenshots + the Windows
accessibility tree), **hands** (input injection, clipboard, windows) and a gated
**robot path** (shell, files, processes) on the operator's own workstation.

Every call returns an **action receipt** — before/after screenshot hashes, a
`changed` flag, postcondition result, structured error code — so the agent can
tell a real action from a click into the void.

## Run

```powershell
$env:PC_AGENT_TOKEN = "at-least-16-chars-shared-with-the-runner"
node server.mjs
```

Options (env):

| Variable | Default | Meaning |
|---|---|---|
| `PC_AGENT_PORT` | `8765` | loopback port |
| `PC_AGENT_TOKEN` | required | bearer token; the runner's `REDTEAM_PC_AGENT_TOKEN` |
| `PC_AGENT_ALLOW_DESTRUCTIVE` | off | `1` enables tier-2 tools for this session |
| `PC_AGENT_AUDIT_LOG` | `./pc-agent-audit.jsonl` | append-only action log |

Then point the runner at it:

```powershell
$env:REDTEAM_PC_AGENT_URL  = "http://127.0.0.1:8765/mcp"
$env:REDTEAM_PC_AGENT_TOKEN = $env:PC_AGENT_TOKEN
```

Smoke test: `pnpm --filter @secscan/pc-agent-bridge run smoke` (or run
`apps/redteam-runner/scripts/smoke-pc-agent.mjs` directly).

## Tools and tiers

| Tier | Tools |
|---|---|
| 0 — observe | `system_info`, `list_processes`, `list_dir`, `read_file`, `screen_snapshot`, `ui_windows`, `ui_tree`, `ui_focused`, `state_hash`, `clipboard_get`, `wait_idle`, `wait_window` |
| 1 — action | `input_click`, `input_type`, `input_key`, `input_scroll`, `window_focus`, `window_close`, `clipboard_set`, `assert_element` |
| 2 — destructive | `shell_exec`, `shell_pwsh`, `proc_kill`, `fs_write`, `fs_delete` |

Tier 2 is refused with `POLICY_DENIED` unless `PC_AGENT_ALLOW_DESTRUCTIVE=1`.

## Not implemented yet (honest list)

`ui_invoke`, `ui_set_value`, `ui_toggle`, `ui_describe`, `input_drag`,
`window_arrange` return `NOT_IMPLEMENTED` with a fallback hint. They need a
long-lived element map (UIA refs resolved server-side between calls). Workaround
today: `ui_tree` → `input_click` with the node's bounds; `clipboard_set` +
`input_key` `^v` for text.

## Windows hard limits

- UAC secure desktop cannot be automated; expect `ELEVATION_REQUIRED`.
- A non-elevated process cannot inject input into an elevated window.
- `SendKeys` for `input_type` pastes via clipboard; keep text under a few MB.
- Multi-monitor coordinates are virtual-desktop absolute (can be negative).
- The PowerShell helper uses Windows PowerShell 5.1 (UIAutomation + WinForms).
