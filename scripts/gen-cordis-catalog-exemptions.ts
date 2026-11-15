/**
 * Curated blind spots: Context keys and Events members the rendering
 * projection cannot see, each with its reason and documentation owner.
 */

/**
 * Context keys declared in `interface Context` merges that the rendering
 * projection cannot see, each with the reason and its documentation owner.
 * The scan that enforces this list reads EVERY `declare module '@deepseek-ai/cordis'`
 * Context merge under `packages/x/x/src/**` — any depth, not only root
 * `index.ts` files with a same-named service class — so a new service can
 * never silently join this blind spot: it either enters {@link SERVICE_PAGE}
 * or names itself here. Client-face keys (the projection analyzes the host
 * face only) name the package README that owns their surface.
 *
 * Two categories remain, and neither is a projection gap a scanning rule could
 * close. An OPTIONAL key (`key?: X`) is a value the launcher or boot code
 * installs before the tree mounts, which the analyzer skips by rule because no
 * plugin provides it and `inject` cannot reach it. A client-face key belongs to
 * the browser Context, which this host-face program never sees; the browser
 * surface has its own generated catalog (`scripts/gen-client-catalog.ts`, served
 * to a model as `cordis_runtime_inspect what:"client"`).
 */
export const SERVICE_WALK_EXEMPTIONS: Record<string, string> = {
  invocation: 'not a service: per-call accessor (RemoteInvocation | undefined) the Gateway derives for each Remote call — packages/api/gateway/README.md owns the contract',
  webTerminals: 'client-side terminal view models — packages/api/terminal-controller/README.md owns the API',
  appReady: 'not a service: launcher-provided successful-startup signal — packages/boot/cmdline/README.md owns the launcher contract',
  appExit: 'not a service: launcher-provided bounded process-exit callback — packages/boot/cmdline/README.md owns the launcher contract',
  cmdlineArgs: 'not a service: launcher-provided immutable app argument accessor — packages/boot/cmdline/README.md owns the launcher contract',
  configuredAgentIdentities: 'not a service: launcher-provided boot-context value (ConfiguredAgentIdentities | undefined) — packages/core/agent-loop/README.md owns this launcher contract',
  launcherSessionQueryPath: 'not a service: launcher-provided boot-context value (string | undefined) — packages/session-query/session-query-sqlite/README.md owns this launcher contract',
  dshHomePath: 'not a service: boot-provided root accessor function (typeof dshHomePath | undefined) for Loader !!js config expressions — packages/boot/app-boot/README.md owns the boot contract',
  launchEnvironment: 'not a service: launcher-provided root accessor value (LaunchEnvironmentSnapshot | undefined) — packages/util/launch-environment/README.md owns this launcher contract',
  pluginPackages: 'profile-boot-owned package resolver service used by optional consumers — packages/boot/app-boot/README.md owns this internal API',
  fileUpload: 'client-side browser upload service — packages/client/file-upload/README.md owns the API',
  uiRenderer: 'client-side interface-typed browser service — packages/client/ui-renderer/README.md owns the API',
  uiSession: 'client-side Session source adapter — packages/client/ui-session/README.md owns the API',
  uiConversation: 'client-side Conversation registries and assembler — packages/client/ui-conversation/README.md owns the API',
  uiWorkspace: 'client-side Workspace navigation adapter — packages/client/ui-workspace/README.md owns the API',
  settingsSchema: 'client-side schema introspection service — packages/client/ui-settings/README.md owns the API',
  configForms: 'client-side shared entry forms — packages/client/ui-settings/README.md owns the API',
  chatFileMentions: 'client-side slot-contract accessor (ChatFileMentions) — packages/client/ui-chat/README.md owns the API',
  commandUi: 'client-side interface-typed browser service — packages/client/ui-commands/README.md owns the API',
  feedbackUi: 'client-side feedback dialog service — packages/client/ui-message-feedback/README.md owns the API',
  conversation: 'client-side interface-typed browser service — packages/client/ui-conversation/README.md owns the API',
  layout: 'client-side interface-typed browser service — packages/client/ui-layout/README.md owns the API',
  locale: 'client-side interface-typed browser service — packages/client/locale/README.md owns the API',
  modelDirectories: 'client-side interface-typed browser service — packages/client/ui-model-selection/README.md owns the API',
  modules: 'client-side interface-typed browser service — packages/client/modules/README.md owns the API',
  remote: 'client-side interface-typed gateway accessor (ClientRemote) — packages/api/gateway/README.md owns the API',
  sessionLogDownload: 'client-side browser download controller — packages/session-query/session-log-export/README.md owns the API',
  inputTriggers: 'client-side interface-typed browser service — packages/client/ui-input-trigger/README.md owns the API',
  timer: 'client-side dynamic-package timer service — packages/extensions/cordis-client-runner/README.md owns the API',
  slots: 'client-side interface-typed browser service — packages/client/ui-renderer/README.md owns the API',
  theme: 'client-side interface-typed browser service — packages/client/ui-theme/README.md owns the API',
  workspaces: 'client-side interface-typed browser service — packages/api/workspace-controller/README.md owns the API',
  resources: 'client-side resource model (protocol providers, pins, live sources) — packages/client/resources/README.md owns the API',
  sidebarRight: 'client-side right-Sidebar navigation face — packages/client/ui-sidebar-right/README.md owns the API',
  sidebarRightTabs: 'client-side right-Sidebar tab-type registry — packages/client/ui-sidebar-right/README.md owns the API',
  documentPreviews: 'client-side document renderer registry — docs/subsystems/sidebar-right.md owns the API',
}

/**
 * Event names declared in `interface Events` merges that the rendering
 * projection cannot see, each with the reason and its documentation owner.
 * The mirror of {@link SERVICE_WALK_EXEMPTIONS} for events: an independent
 * scan reads EVERY `declare module '@deepseek-ai/cordis'` Events merge under
 * `packages/x/x/src/**`, so a declared event either renders onto a subsystems
 * page (via {@link EVENT_SCOPE_PAGE}) or names itself here — never vanishes
 * silently. Keys are full event names rather than scopes, so a scope-level
 * exemption cannot mask another declaration in that scope.
 */
export const EVENT_WALK_EXEMPTIONS: Record<string, string> = {
  'command/executed': 'client-face local command acknowledgment — packages/client/ui-commands/README.md owns the API',
  'connection/reset': 'client-face transport signal — packages/api/session-controller/README.md owns the API',
  'locale/change': 'client-face locale switch signal — packages/client/locale/README.md owns the API',
  'slash/input-begin-command': 'client-face slash-input protocol — packages/client/ui-input-trigger/README.md owns the API',
  'slash/input-consume-token': 'client-face slash-input protocol — packages/client/ui-input-trigger/README.md owns the API',
  'slash/input-insert-reference': 'client-face slash-input protocol — packages/client/ui-input-trigger/README.md owns the API',
  'slash/input-insert-text': 'client-face slash-input protocol — packages/client/ui-input-trigger/README.md owns the API',
  'slots/changed': 'client-face slot invalidation signal — packages/client/ui-renderer/README.md owns the API',
  'theme/change': 'client-face theme switch signal — packages/client/ui-theme/README.md owns the API',
}
