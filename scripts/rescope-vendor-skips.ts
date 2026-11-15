/** The files where an upstream name is product data rather than a package reference. */

import { RENAMES } from './rescope-vendor-renames.ts'
import type { GenericSkip } from './rescope-vendor-types.ts'

export const GENERIC_SKIPS: readonly GenericSkip[] = [
  // `Symbol.for('schemastery')` and the `vendor:` metadata field are upstream identifiers.
  { file: 'vendor/schemastery/src/index.ts', upstream: ['schemastery'] },
  // Narrows a Standard Schema by the same upstream `vendor:` identifier.
  { file: 'vendor/loader/src/config/diff.ts', upstream: ['schemastery'] },
  // Native schema detection and its fixture share the vendored runtime's Symbol.for identifier.
  { file: 'packages/boot/app-boot/src/config-schema/native.ts', upstream: ['schemastery'] },
  { file: 'packages/boot/app-boot/tests/config-schema.spec.ts', upstream: ['schemastery'] },
  // Asserts the vendored-manifest table, which gains an upstream-name column.
  { file: 'scripts/gen-third-party-notices.spec.ts', upstream: RENAMES.map(rename => rename.upstream) },
  // `cordis` is also an agent-preset id, so in these files the bare name is
  // product data, not a package reference. Renaming it changed which preset
  // the creator flow stages and which id the roster reports.
  { file: 'packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx', upstream: ['cordis'] },
  { file: 'packages/client/ui-agent-preset/src/client/PresetGuideDialog.tsx', upstream: ['cordis'] },
  { file: 'packages/client/ui-agent-preset/src/client/index.ts', upstream: ['cordis'] },
  { file: 'packages/client/ui-agent-preset/tests/apply.client.spec.ts', upstream: ['cordis'] },
  { file: 'packages/client/ui-agent-preset/tests/locales.client.spec.ts', upstream: ['cordis'] },
  { file: 'packages/client/ui-agent-preset/tests/section.client.spec.tsx', upstream: ['cordis'] },
  { file: 'apps/cli/tests/web-agent-presets.e2e.ts', upstream: ['cordis'] },
  { file: 'apps/cli/tests/profiles/web/tests/fixtures/creator-plugin-manager.mjs', upstream: ['cordis'] },
  { file: 'apps/web/tests/agent-preset-authoring.e2e.ts', upstream: ['cordis'] },
  { file: 'packages/preset/agent-preset-registry/tests/session.spec.ts', upstream: ['cordis'] },
  // The preset-roster loop names the `cordis` preset id, not a package.
  { file: 'apps/cli/tests/windows-shell.spec.ts', upstream: ['cordis'] },
  // GROUP_ORDER holds `packages/<group>/` directory names, not package names.
  { file: 'scripts/gen-module-graph.ts', upstream: ['cordis'] },
  { file: 'scripts/gen-doc-graphs.ts', upstream: ['cordis'] },
  // `cordis/*` is the extensions event domain, not a package subpath. The
  // generated catalogs and every producer/consumer must preserve that wire id.
  { file: 'docs/event-producer-consumer.md', upstream: ['cordis'] },
  { file: 'docs/event-producer-consumer.zh.md', upstream: ['cordis'] },
  { file: 'docs/subsystems/extensions.md', upstream: ['cordis'] },
  { file: 'docs/subsystems/extensions.zh.md', upstream: ['cordis'] },
  { file: 'packages/api/remotes/src/remote-events.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/cordis-client-runner/src/client/index.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/cordis-client-runner/src/client/runtime.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/cordis-client-runner/tests/orchestrator.client.spec.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/cordis-client-runner/tests/plugin.client.spec.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/cordis-host-runner/src/index.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/cordis-host-runner/src/inspect-registry.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/cordis-host-runner/src/types.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/cordis-host-runner/tests/helpers.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/cordis-host-runner/tests/runner.spec.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/cordis-host-runner/tests/versioning.spec.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/tool-cordis/src/api-catalog.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/tool-cordis/src/providers.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/ui-cordis/src/client/index.ts', upstream: ['cordis'] },
  { file: 'packages/extensions/ui-cordis/src/client/inventory.ts', upstream: ['cordis'] },
  // `cordis/tree` is an Inspector observation topic, not a package subpath.
  { file: 'packages/experimental/inspector/src/shared/bridge/messages/cordis.ts', upstream: ['cordis'] },
  { file: 'packages/experimental/inspector/tests/cordis-query.host.spec.ts', upstream: ['cordis'] },
  { file: 'packages/experimental/inspector/tests/cordis-tree.host.spec.ts', upstream: ['cordis'] },
  { file: 'packages/experimental/inspector/tests/plugin.client.spec.ts', upstream: ['cordis'] },
  { file: 'scripts/gen-cordis-catalog.ts', upstream: ['cordis'] },
  // The UI locale namespace and input-trigger source id are product keys.
  { file: 'packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx', upstream: ['cordis'] },
  { file: 'packages/extensions/ui-cordis/src/client/CordisActionRow.tsx', upstream: ['cordis'] },
  { file: 'packages/extensions/ui-cordis/src/client/CordisDefineRow.tsx', upstream: ['cordis'] },
  { file: 'packages/extensions/ui-cordis/src/client/CordisPanel.tsx', upstream: ['cordis'] },
  { file: 'packages/extensions/ui-cordis/src/client/CordisRunRow.tsx', upstream: ['cordis'] },
  { file: 'packages/extensions/ui-cordis/src/client/locales.ts', upstream: ['cordis'] },
]
