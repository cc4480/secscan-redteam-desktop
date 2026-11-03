# @secscan/redteam-command

Human-facing RedTeam slash commands for the SecScan RedTeam profile, over
the harness command registry (`@deepseek-ai/dsh-commands`). The composer's
existing `/` menu (ui-input-trigger + ui-commands) lists and dispatches
them; the registry records `command/run` / `command/done` in the session
log for every execution. No new client surface is added.

## Commands

- `/scan <target>` — queues one fixed operator-directive user message that
  routes the session's Lead through its `engagement_launch` tool with the
  target exactly as typed: the same engagement-launch flow a typed request
  takes, made deterministic at the command seam.
- `/deepscan <target>`, `/nmap <target>`, `/nuclei <target>`,
  `/metasploit <target>` — the sibling engagement commands: each queues
  its own directive naming the command and carrying its registry tier,
  target families, and phase list as `engagement_launch` arguments, so
  the run is the bounded one the registry defines (for example `/nmap`
  is tier 0 over recon+report and runs no exploit phase; `/metasploit`
  is tier 2 and approval-gated). `/pcscan` takes no target: its
  directive routes through `engagement_launch_local` for a local host
  assessment of this machine.
- `/status` — queues the directive that routes the Lead through
  `engagement_status` and narrates the snapshot in the thread.
- `/report` — queues the directive that routes the Lead through
  `engagement_report` and delivers the finished report in the thread; a
  not-ready report is reported as not ready.
- `/stop` — aborts the active turn through the agent's own cancellation
  path (the composer's stop path). It deliberately does not abort a
  running engagement: that halt lives on the Watch tab's Abort control,
  and the command's result text says so.
- `/use <tool> [instruction]` — validates the tool name against the tools
  service's real per-agent catalog (`ctx.tools`) and steers the driver
  with a logged, model-visible operator directive binding the next tool
  action. An unknown name is rejected with the seat's actual catalog in
  the message; nothing is sent to the agent. Tools that live inside the
  runner (for example `msf_exec`) are not in the Lead's catalog and are
  rejected — direct the Lead with `/use mcp__redteam__engagement_launch`
  and put runner-level direction in the instruction text.

`/model` is not re-implemented here: it already ships as the
ui-model-selection command contribution. `/clear` is not provided: which
session is active is client navigation state, a host command cannot
switch it, and the sidebar's New Chat action already owns it.

## Model Experience

Each of `/scan`, the sibling commands, `/status`, `/report` adds exactly
one user message (the operator directive in `src/directive.ts`, verbatim)
as its own follow-up turn; `/use` adds one steering user message consumed
at the next step boundary. The directive text is fixed apart from the
operator's own target, tool name, and instruction, so the model-visible
content is reconstructable from the session log word for word. `/stop`
adds no model input.

#### KV Cache effect

One added user turn per command execution, at the point of execution;
earlier request prefixes are untouched.

## Known Limitations and Deferred Work

- The `/use` tool list is validated host-side; the palette does not yet
  enumerate tool names because no client-visible tool-catalog RPC exists.
  The rejection and bare-usage messages carry the seat's real catalog.
- `/scan`, `/status`, and `/report` direct the Lead through its existing
  engagement tools; they do not call the runner's HTTP API themselves.
