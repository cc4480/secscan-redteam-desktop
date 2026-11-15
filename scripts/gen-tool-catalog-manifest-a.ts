/**
 * Boot-manifest entries for the registry, interaction, shell, deliverable and
 * extension tool packages.
 */

import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import BrowserUseRegistry from '@deepseek-ai/dsh-browser-use'
import CordisHostRunner from '@deepseek-ai/dsh-cordis-host-runner'
import * as StagehandBrowserTools from '@deepseek-ai/dsh-experimental-browser-use-stagehand-native'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'
import type PluginManager from '@deepseek-ai/dsh-plugin-manager'
import * as PluginManagerTools from '@deepseek-ai/dsh-plugin-manager/tools'
import { PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolAskUser from '@deepseek-ai/dsh-tool-ask-user'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolCordis from '@deepseek-ai/dsh-tool-cordis'
import * as ToolPresent from '@deepseek-ai/dsh-tool-present'
import * as ToolPwsh from '@deepseek-ai/dsh-tool-pwsh'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { ToolPackage } from './gen-tool-catalog-types.ts'

export const TOOL_PACKAGES_A: ToolPackage[] = [
  {
    pkg: '@deepseek-ai/dsh-plugin-manager',
    dir: 'plugin-manager',
    source: 'packages/boot/plugin-manager/src/tools.ts',
    requires: ['ctx.tools', 'ctx.pluginManager', 'ctx.sandboxPolicy'],
    writes: ['tool/call', 'tool/result', 'user/message'],
    async mount(ctx) {
      // Schema harvest never executes a management method or opens a profile.
      ctx.provide('pluginManager', {} as PluginManager)
      await ctx.plugin(SandboxPolicy)
      await ctx.plugin(PluginManagerTools)
    },
  },
  {
    pkg: '@deepseek-ai/dsh-mcp-resources',
    dir: 'mcp-resources',
    source: 'packages/mcp/mcp-resources/src/tools.ts',
    requires: ['ctx.tools', 'ctx.mcpResources'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(McpResources)
      ctx.mcpResources.register('catalog', {
        request: () => Promise.reject(new Error('gen-tool-catalog: MCP requests are unreachable during schema harvest')),
      })
    },
  },
  {
    pkg: '@deepseek-ai/dsh-experimental-browser-use-stagehand-native',
    dir: 'browser-use-stagehand-native',
    source: 'packages/experimental/browser-use-stagehand-native/src/index.ts',
    requires: ['ctx.browserUse', 'ctx.agents', 'ctx.tools', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(BrowserUseRegistry)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(StagehandBrowserTools, {
        mode: 'launch', model: { modelName: 'openai/gpt-5.4-mini', apiKey: 'catalog-placeholder' },
      })
    },
  },
  {
    pkg: '@deepseek-ai/dsh-tool-ask-user',
    dir: 'tool-ask-user',
    source: 'packages/interaction/tool-ask-user/src/index.ts',
    requires: ['ctx.tools', 'ctx.userQuestions'],
    writes: ['tool/call', 'tool/result after a UI/provider answers the question'],
    async mount(ctx) {
      await ctx.plugin(UserQuestionService)
      await ctx.plugin(ToolAskUser)
    },
    note:
      'ask_user_question pauses the tool call until the active UI provider returns a human answer.',
  },
  {
    pkg: '@deepseek-ai/dsh-tools',
    dir: 'tools',
    source: 'packages/core/tools/src/ptc.ts',
    requires: ['ctx.tools', 'ctx.ptcRuntime (execution time)', 'ctx.systemPrompt'],
    writes: ['tool/call', 'one tool/ptc-dispatch-start + tool/ptc-dispatch pair per bridged sub-call', 'tool/result'],
    // The registry's OWN tool: run_code exists only under a non-native mode
    // (the registry registers it in its constructor; the PTC runtime is read
    // at assembly/execution time, so the schema harvest needs none mounted).
    toolsConfig: { mode: 'ptc' },
    async mount() {},
    note:
      'Owned by the tool registry as a reserved transport outside filterable capability layers under `mode: ptc` / `mode: both` (see the PTC mode Agent Note). Under `ptc` it is the registry\'s only wire contribution; the other visible capabilities are declared in a generated SDK section in the loaded runtime\'s language, and a program calls them through bindings scheduled under the native concurrency contract (submission-ordered starts and policy; concurrency-safe bodies overlap up to `maxParallelSubCalls`) that re-enter the complete guarded tool pipeline and link each nested execution to this outer result.',
  },
  {
    pkg: '@deepseek-ai/dsh-plan-mode',
    dir: 'plan-mode',
    source: 'packages/plan/plan-mode/src/index.ts',
    requires: ['ctx.tools', 'ctx.systemPrompt', 'ctx.userQuestions (execution time, opportunistic)'],
    writes: ['tool/call', 'plan/mode inactive on an approved review', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(PlanModeController, { section: 'Tool catalog schema harvest.' })
    },
    note:
      'exit_plan_mode stays in the model-facing schema while planning is inactive so transitions add no tool-catalog churn on top of the plan-policy change. Its execute path rejects calls outside plan mode; in plan mode it presents the plan over the user-questions seam (approve / keep planning with feedback), and approval logs plan mode inactive at the step boundary.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-bash',
    dir: 'tool-bash',
    source: 'packages/shell/tool-bash/src/index.ts',
    requires: ['ctx.tools', 'ctx.shell', 'ctx.systemPrompt', 'ctx.shellEnv', 'ctx.jobs for run_in_background and the job-backed foreground path'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(BashEnvPlugin)
      await ctx.plugin(LocalBashExecutor)
      // The shipped profiles compose the job registry, and the tool's
      // background surface follows it: harvest the job-backed schema.
      await ctx.plugin(LocalJobRegistry)
      await ctx.plugin(ToolBash)
    },
    note:
      'The bash tool is the model-facing consumer of the bash executor seam. With a job registry composed every call registers with the generic `ctx.jobs` runtime as it starts, collected/stopped through the `job_*` tools from `@deepseek-ai/dsh-tool-jobs`; without one, or with `enableRunInBackground: false`, the tool registers a foreground-only schema without the `run_in_background` parameter.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-present',
    dir: 'tool-present',
    source: 'packages/deliverables/tool-present/src/index.ts',
    requires: ['ctx.tools', 'ctx.fs', 'ctx.sessionProjections'],
    writes: ['tool/call', 'deliverables/presented after a successful final result', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(LocalFileSystem)
      await ctx.plugin(ToolPresent)
    },
    note: 'Deliveries belong to the calling Session; Web ui-deliverables supplies source-file opening and cards.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-pwsh',
    dir: 'tool-pwsh',
    source: 'packages/shell/tool-pwsh/src/index.ts',
    requires: ['ctx.tools', 'ctx.shell', 'ctx.systemPrompt', 'ctx.shellEnv', 'ctx.jobs for run_in_background and the job-backed foreground path'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      // The pwsh tool consumes the bash executor seam; the schema harvest
      // mounts the pwsh-local implementation so the inject resolves without
      // executing anything (registration never spawns a process). The job
      // registry is composed for the same reason as the bash entry.
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(BashEnvPlugin)
      await ctx.plugin(PwshLocalExecutor)
      await ctx.plugin(LocalJobRegistry)
      await ctx.plugin(ToolPwsh)
    },
    note:
      'The pwsh tool is the PowerShell-dialect consumer of the bash executor seam for Windows compositions (a PowerShell executor such as `@deepseek-ai/dsh-pwsh-local` backs `ctx.shell`); it mirrors the bash tool call-for-call minus sandbox controls — `run_in_background` runs register with the generic `ctx.jobs` runtime and are collected/stopped through the `job_*` tools, and the managed `DSH_*` environment comes from `@deepseek-ai/dsh-shell-env`. Each call runs in a fresh process (no persistent PTY session), with native `C:\\...` paths and `$env:NAME` variables.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-cordis',
    dir: 'tool-cordis',
    source: 'packages/extensions/tool-cordis/src/index.ts',
    requires: ['ctx.tools', 'ctx.cordisInspect'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(CordisHostRunner)
      await ctx.plugin(ToolCordis)
    },
    note:
      'Creator mode provides two read-only runtime inspection tools. The Cordis host runner supplies the inspection registry; Client queries require a connected page. Author persistent changes as bundles and install them with plugin_manager.',
  },
]
