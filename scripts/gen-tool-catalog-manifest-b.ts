/**
 * Boot-manifest entries for the persistent shells, filesystem, terminal, goal,
 * schedule, lsp and skill tool packages.
 */

import { resolve } from 'node:path'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import GoalService from '@deepseek-ai/dsh-goal'
import Lsp from '@deepseek-ai/dsh-lsp'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolSchedule from '@deepseek-ai/dsh-schedule'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import * as ToolBashPersistent from '@deepseek-ai/dsh-tool-bash-persistent'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import * as ToolLsp from '@deepseek-ai/dsh-tool-lsp'
import * as ToolPwshPersistent from '@deepseek-ai/dsh-tool-pwsh-persistent'
import * as ToolRalph from '@deepseek-ai/dsh-tool-ralph'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import * as ToolStrReplaceEditor from '@deepseek-ai/dsh-tool-str-replace-editor'
import * as ToolPty from '@deepseek-ai/dsh-tool-terminal'
import {
  CatalogAttachmentStore,
  CatalogWorkflowEngine,
  catalogChildScopes,
  mountCatalogChildScope,
  registerCatalogSubagentProvider,
  root,
} from './gen-tool-catalog-support.ts'
import type { ToolPackage } from './gen-tool-catalog-types.ts'

export const TOOL_PACKAGES_B: ToolPackage[] = [
  {
    pkg: '@deepseek-ai/dsh-tool-bash-persistent',
    dir: 'tool-bash-persistent',
    source: 'packages/shell/tool-bash-persistent/src/index.ts',
    requires: ['ctx.tools', 'ctx.terminals', 'an owning Agent at execution time'],
    writes: ['tool/call', 'PTY shell state', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(TerminalSessionService)
      await ctx.plugin(ToolBashPersistent)
    },
    note:
      'One owner-isolated persistent bash tool; deployment composition supplies the PTY backend and may override the model-facing environment description.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-pwsh-persistent',
    dir: 'tool-pwsh-persistent',
    source: 'packages/shell/tool-pwsh-persistent/src/index.ts',
    requires: ['ctx.tools', 'ctx.terminals', 'an owning Agent at execution time'],
    writes: ['tool/call', 'PTY shell state', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(TerminalSessionService)
      await ctx.plugin(ToolPwshPersistent)
    },
    note:
      'One owner-isolated persistent pwsh tool, the Windows counterpart of the persistent bash tool; deployment composition supplies a pwsh-dialect PTY backend and may override the model-facing environment description.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-str-replace-editor',
    dir: 'tool-str-replace-editor',
    source: 'packages/fs/tool-str-replace-editor/src/index.ts',
    requires: ['ctx.tools', 'ctx.fs'],
    writes: ['tool/call', 'fs/observed after view presence/absence, edit absence, or successful mutation', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(LocalFileSystem)
      await ctx.plugin(ToolStrReplaceEditor)
    },
    note:
      'Standalone view/create/unique literal replace/line insert tool over the filesystem seam; it composes with any shell or terminal API.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-fs',
    dir: 'tool-fs',
    source: 'packages/fs/tool-fs/src/index.ts',
    requires: ['ctx.tools', 'ctx.fs', 'ctx.systemPrompt', 'ctx.attachments (image-tool registration)', 'ctx.llm + an image-capable route (image-tool execution)'],
    writes: ['tool/call', 'fs/write-intent or fs/edit-intent for mutations', 'fs/observed after read presence/absence or successful file operation', 'durable attachment (read_image)', 'tool/result'],
    async mount(ctx) {
      // The tool needs `fs`; the bare provider is sufficient because policy
      // changes behavior, not schema shape. The catalog seam marker opts into
      // the attachments-conditional image schema without attachment I/O.
      await ctx.plugin(LocalFileSystem)
      await ctx.plugin(CatalogAttachmentStore)
      await ctx.plugin(ToolFs)
    },
    note:
      'The read-before-write/edit policy is added by `@deepseek-ai/dsh-fs-observation-policy` (an `fs/*` event-gate plugin, no schema change); a deployment that loads these tools is expected to also load it. The image tool is not registered without `ctx.attachments`; its schema is route-independent, and execution refuses unless the exact routed model declares image input.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-fs-search',
    dir: 'tool-fs-search',
    source: 'packages/fs/tool-fs-search/src/index.ts',
    requires: ['ctx.tools', 'ctx.subprocess', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      // The tools inject `subprocess` (search spawns the packaged ripgrep
      // binary through the seam, not ctx.fs); registration itself never
      // spawns, so the real local service is inert here. `ctx.spillStore` is
      // optional (read via ctx.get) and does not affect the schemas, so no
      // spill backend is mounted.
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: true })
    },
    note:
      'glob and grep are unconditional discovery tools that spawn the packaged ripgrep binary (`@vscode/ripgrep`) through ctx.subprocess as ordinary foreground calls (never background jobs) — no host `rg` install and no shell layer. The catalog uses `sampleOverCapGlobResults: true`; deployments must choose that behavior explicitly. Capped results save the complete formatted list through the optional ctx.spillStore backend; returned locators are follow-up-readable/searchable when the backend exposes local paths in co-located deployments.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-terminal',
    dir: 'tool-terminal',
    source: 'packages/terminal/tool-terminal/src/index.ts',
    requires: ['ctx.tools', 'ctx.terminals', 'ctx.systemPrompt', 'ctx.jobs at call time for run_in_background'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(TerminalSessionService)
      await ctx.plugin(ToolPty)
    },
    note:
      'The six terminal tools are opt-in and complement one-shot shell/filesystem tools. `terminal_send(run_in_background: true)` registers with `ctx.jobs`; TUI, named key sequences, BEL, resize, auto-start, and cross-agent sharing are absent from the schema.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-goal',
    dir: 'tool-goal',
    source: 'packages/goal/tool-goal/src/index.ts',
    requires: ['ctx.tools', 'ctx.agents', 'ctx.goals', 'ctx.systemPrompt', 'a calling Agent in an authorized open turn'],
    writes: ['tool/call', 'goal/change for mutations', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(GoalService)
      await ctx.plugin(ToolGoal)
    },
    note:
      'create, edit, pause, and resume require direct-human root authority; complete and blocked also accept the exact current goal round. The default blocked lower bound is three admitted rounds.',
  },
  {
    pkg: '@deepseek-ai/dsh-schedule',
    dir: 'schedule',
    source: 'packages/schedule/schedule/src/tools.ts',
    requires: ['ctx.tools', 'ctx.sessions', 'Session persistence', 'a future live root Agent'],
    writes: ['tool/call', 'schedule/change create or delete', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(SessionStore)
      const session = ctx.sessions.create(SessionId('tool-catalog-schedule'))
      const agent = { id: session.id, session } as Agent
      await mountCatalogChildScope(ctx, (childCtx) => {
        ToolSchedule.registerScheduleTools(ctx, childCtx, agent, () => {})
      }, agent, ['tools', 'systemPrompt'])
    },
    scope: ctx => catalogChildScopes.get(ctx) as Agent,
    note:
      'Registered only inside live root Agent scopes created after the opt-in Schedule plugin loads. '
      + 'Version 1 accepts after_seconds, explicit absolute at, and bounded fixed-rate every_seconds, '
      + 'and discloses session-local delivery; '
      + 'management reads and mutations require the shared Session persistence barrier.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-lsp',
    dir: 'tool-lsp',
    source: 'packages/lsp/tool-lsp/src/index.ts',
    requires: ['ctx.tools', 'ctx.lsp', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      // The tool registers from the seam alone; the schema does not depend on any provider.
      await ctx.plugin(Lsp)
      await ctx.plugin(ToolLsp)
    },
    note:
      'The lsp tool keeps provider selection and language-server subprocesses behind ctx.lsp, so its model-visible schema stays stable across providers. Requires a registered provider (e.g. `@deepseek-ai/dsh-lsp-stdio`) at runtime; without one, a query returns the structured `LSP_UNAVAILABLE` error rather than changing the schema.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-ralph',
    dir: 'tool-ralph',
    source: 'packages/workflow/tool-ralph/src/index.ts',
    requires: ['ctx.tools', 'ctx.workflowEngine', 'ctx.subagents', 'ctx.systemPrompt', 'a calling Agent (exec.agent parents every fresh round)'],
    writes: ['tool/call', 'tool/result', 'workflow and child session events during execution'],
    async mount(ctx) {
      await ctx.plugin(SubagentRuntime)
      registerCatalogSubagentProvider(ctx, 'mock')
      await ctx.plugin(CatalogWorkflowEngine)
      await ctx.plugin(ToolRalph, { subagentProvider: 'mock' })
    },
    note:
      'A fixed foreground workflow starts one fresh structured child per round; the model selects only the immutable objective and an optional round cap.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-skill',
    dir: 'tool-skill',
    source: 'packages/skill/tool-skill/src/index.ts',
    requires: ['ctx.tools', 'ctx.agents', 'ctx.skills'],
    writes: ['tool/call', 'tool/result', 'user/message replacement catalogs via agent.inject()'],
    async mount(ctx) {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, {
        dshHome: resolve(root, '.tmp/tool-catalog/.dsh'),
        agentsHome: resolve(root, '.tmp/tool-catalog/.agents'),
      })
      await ctx.plugin(ToolSkill)
    },
  },
]
