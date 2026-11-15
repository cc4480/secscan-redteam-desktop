/**
 * Boot-manifest entries for the session query, delegation, jobs, team, todo,
 * workflow and web tool packages.
 */

import { resolve } from 'node:path'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type TeamService from '@deepseek-ai/dsh-experimental-agent-team'
import * as ToolTeam from '@deepseek-ai/dsh-experimental-tool-agent-team'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import * as ToolSessionQuery from '@deepseek-ai/dsh-tool-session-query'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import * as ToolSubagentControl from '@deepseek-ai/dsh-tool-subagent-control'
import * as ToolSubagentListAgents from '@deepseek-ai/dsh-tool-subagent-control/list-agents'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import * as ToolWorkflow from '@deepseek-ai/dsh-tool-workflow'
import * as ToolWorkspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as WebFetchLocal from '@deepseek-ai/dsh-web-fetch-http'
import * as WebSearchExa from '@deepseek-ai/dsh-web-search-exa'
import { registerListSubagentModels } from '../packages/subagent/tool-subagent/src/list-models.ts'
import {
  CatalogWorkflowEngine,
  catalogChildScopes,
  registerCatalogSubagentProvider,
  root,
} from './gen-tool-catalog-support.ts'
import type { ToolPackage } from './gen-tool-catalog-types.ts'

export const TOOL_PACKAGES_C: ToolPackage[] = [
  {
    pkg: '@deepseek-ai/dsh-tool-session-query',
    dir: 'tool-session-query',
    source: 'packages/session-query/tool-session-query/src/index.ts',
    requires: ['ctx.tools', 'ctx.systemPrompt', 'ctx.sessionQuery', 'a calling Agent for workspace authority'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SqliteSessionQueryEngine, { path: ':memory:' })
      await ctx.plugin(ToolSessionQuery)
    },
    note:
      'The five read-only tools hide provider cursors and authorize every result from the immutable calling agent session. The package is opt-in; compositions that need enforced deadlines or bounded inline output also mount the generic timeout or spill policies.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-subagent',
    dir: 'tool-subagent',
    source: {
      list_subagent_models: 'packages/subagent/tool-subagent/src/list-models.ts',
      subagent: 'packages/subagent/tool-subagent/src/index.ts',
    },
    requires: ['ctx.tools', 'ctx.subagents', 'ctx.systemPrompt', 'ctx.llm for model discovery and selected-route validation'],
    writes: ['tool/call', 'tool/result', 'child session events through the chosen provider'],
    shippedNames: ['subagent', 'subagent_fork'],
    async mount(ctx) {
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(LlmRuntime)
      registerCatalogSubagentProvider(ctx, 'mock')
      await ctx.plugin(ToolSubagent, { provider: 'mock' })
      registerListSubagentModels(ctx, { routes: [{ provider: 'mock', model: 'mock' }] })
    },
    note:
      'The registered delegation name is the load-time `toolName` config (default `subagent`); the default schema above has model selection off, while the discovery schema is shown as the fixed companion available in an enabled Session. Web presets sample the Plugins preference for each new top-level Session and preserve that decision for its child Sessions; `subagent_fork` remains fixed-route. Each instance independently controls whether it reads model-selection settings and its background behavior through `modelSelectionSettings`, `backgroundMode`, and `enableRunInBackground`.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-subagent-control',
    dir: 'tool-subagent-control',
    source: {
      interrupt_agent: 'packages/subagent/tool-subagent-control/src/index.ts',
      list_agents: 'packages/subagent/tool-subagent-control/src/list-agents.ts',
      send_message: 'packages/subagent/tool-subagent-control/src/index.ts',
    },
    requires: ['ctx.tools', 'ctx.subagents', 'ctx.agents and ctx.sessionProjections (list_agents only)'],
    writes: ['tool/call', 'tool/result', 'child session events through ctx.subagents'],
    async mount(ctx) {
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(LocalJobRegistry)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SessionStore)
      await ctx.plugin(ToolSubagentControl)
      await ctx.plugin(ToolSubagentListAgents)
    },
    note:
      'The globally named control tools over continuable background subagents: provider-bound `tool-subagent` instances register distinct delegation tools, while this package registers `send_message` and `interrupt_agent` once, plus `list_agents` from its separately loaded `/list-agents` plugin (whose catalog rows use the sessionProjections and live Agent registries).',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-jobs',
    dir: 'tool-jobs',
    source: 'packages/jobs/tool-jobs/src/index.ts',
    requires: ['ctx.tools', 'ctx.jobs', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result', 'user/message via agent.inject() for background completion notices'],
    async mount(ctx) {
      await ctx.plugin(LocalJobRegistry)
      await ctx.plugin(ToolJobs)
    },
    note:
      'The kind-agnostic background-job controller: background bash commands, PTY sends, and subagents are read, listed, and killed through the same three tools. Loading the plugin attaches the controller that arms producers\' `ctx.jobs.start()`.',
  },
  {
    pkg: '@deepseek-ai/dsh-experimental-tool-agent-team',
    dir: 'tool-agent-team',
    source: 'packages/experimental/tool-agent-team/src/index.ts',
    requires: ['ctx.tools', 'ctx.systemPrompt', 'ctx.agentTeams', 'an exact live Team member Agent'],
    writes: ['tool/call', 'team/member', 'team/message/queued', 'team/message/delivered', 'team/task', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SessionStore)
      const session = ctx.sessions.create(SessionId('tool-catalog-team-lead'))
      let agent!: Agent
      const membership = {
        get root() { return agent },
        id: session.id,
        role: 'lead' as const,
        name: 'lead',
      }
      ctx.provide('agentTeams', {
        tryMembership: (candidate: Agent) => candidate === agent ? membership : undefined,
        membership: () => membership,
      } as unknown as TeamService)
      await ctx.plugin(Object.assign(async (inner: Context) => {
        agent = {
          id: session.id,
          session,
          options: {},
          status: 'idle',
        } as unknown as Agent
        Object.assign(agent, { ctx: createScope(inner, agent).ctx })
        await inner.agents.register(agent)
      }, { inject: ['tools', 'systemPrompt', 'agents', 'agentTeams'] }))
      await ctx.plugin(ToolTeam)
      catalogChildScopes.set(ctx, agent)
    },
    scope: ctx => catalogChildScopes.get(ctx) as Agent,
    note:
      'All nine tools are scoped to implicit Team Leads and durable teammates. The shipped dsh-base bundle keeps the package disabled; the documented Agent Teams profile patch enables it while disabling the legacy continuable-child control names.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-todo',
    dir: 'tool-todo',
    source: 'packages/todo/tool-todo/src/index.ts',
    requires: ['ctx.tools', 'owning Agent session'],
    writes: ['tool/call', 'todo/write', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
    },
    note:
      'todo_write is session-owned state; UIs render the latest todo/write event as a checklist. `allowParallelInProgress` is required with no default, so the catalog states its choice: `true`, whose description invites several `in_progress` items. A deployment choosing `false` receives the same tool with a description asking for exactly one active task.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-workflow',
    dir: 'tool-workflow',
    source: 'packages/workflow/tool-workflow/src/index.ts',
    requires: ['ctx.tools', 'ctx.workflowEngine', 'ctx.systemPrompt', 'a calling Agent (exec.agent parents the script children)'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(SubagentRuntime)
      registerCatalogSubagentProvider(ctx, 'mock')
      await ctx.plugin(CatalogWorkflowEngine)
      await ctx.plugin(ToolWorkflow)
    },
  },
  {
    pkg: '@deepseek-ai/dsh-tool-workspace-dependencies',
    dir: 'tool-workspace-dependencies',
    source: 'packages/skill/tool-workspace-dependencies/src/index.ts',
    requires: ['ctx.tools'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      // Schema harvest never prepares a payload; the directory need not exist.
      await ctx.plugin(ToolWorkspaceDependencies, { source: resolve(root, '.tmp/tool-catalog/primary-runtime') })
    },
  },
  {
    pkg: '@deepseek-ai/dsh-tool-web',
    dir: 'tool-web',
    source: 'packages/web/tool-web/src/index.ts',
    requires: ['ctx.tools', 'ctx.web', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      // Mount search and fetch providers so both tools register. Their schemas
      // do not depend on provider identity or availability.
      await ctx.plugin(WebRuntime)
      await ctx.plugin(WebSearchExa)
      await ctx.plugin(WebFetchLocal)
      await ctx.plugin(ToolWeb)
    },
    note:
      'web_search and web_fetch keep provider selection behind ctx.web so model-visible schemas stay stable across backend swaps.',
  },
]
