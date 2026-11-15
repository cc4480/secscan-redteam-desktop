/**
 * Static-hygiene and documentation leaf gates: the shared check set every CI
 * aggregate carries, plus the documentation-standard aggregates.
 */
import { builtPackageInvariantsGate, pnpmExec, pnpmScript } from './run-gates-leaves.ts'
import type { Gate } from './run-gates-types.ts'

/**
 * Build the static checks shared by every primary CI aggregate.
 * @returns the shared static gates.
 */
export function ciSharedStaticGates(): Gate[] {
  return [
    pnpmScript('runtime-closure', 'verify-runtime-closure', { label: 'runtime closure' }),
    pnpmScript('default-product-isolation', 'verify-default-product-isolation', { label: 'default product isolation' }),
    pnpmScript('application-entrypoints', 'verify-application-entrypoints', { label: 'application entrypoints' }),
    pnpmScript('constraints', 'constraints'),
    pnpmScript('package-dependencies', 'verify-package-dependencies', { label: 'package dependencies' }),
    pnpmScript('dsh-package-licenses', 'verify-dsh-package-licenses', { label: 'DSH package licenses' }),
    pnpmScript('package-invariants', 'verify-package-invariants', { label: 'package invariants' }),
    pnpmScript('package-meta', 'verify-package-meta', { label: 'package metadata' }),
    pnpmScript('cordis-config', 'verify-cordis-config', { label: 'Cordis config' }),
    ...sharedHygieneGates(),
    pnpmScript('approval-policy', 'test:approval-policy', { label: 'Weighted approval policy' }),
    pnpmScript('issue-management', 'test:issue-management', { label: 'Issue management policy' }),
  ]
}

/**
 * Build the hygiene checks admitted by both the CI and the local aggregates.
 * @returns the shared hygiene gates.
 */
export function sharedHygieneGates(): Gate[] {
  return [
    pnpmScript('optional-dependency-imports', 'verify-optional-dependency-imports', {
      label: 'optional dependency imports',
    }),
    pnpmScript('client-packages', 'verify-client-packages', { label: 'client packages' }),
    pnpmScript('client-ui-i18n', 'verify-client-ui-i18n', { label: 'client UI i18n' }),
    pnpmScript('client-route-resolution', 'verify-client-route-resolution', { label: 'client route resolution' }),
    pnpmScript('no-bare-dispatcher', 'verify-no-bare-dispatcher', { label: 'proxy-aware dispatchers' }),
    pnpmScript('no-unknown-casts', 'verify-no-unknown-casts', { label: 'no new unknown casts' }),
    // 250-line file budget, as a one-way ratchet (no new violation, no growth, no stale entry).
    pnpmScript('file-budget', 'verify-file-budget', { label: 'file line budget' }),
    pnpmScript('prompt-budget', 'verify-prompt-budget', { label: 'lean prompt payload budget' }),
  ]
}

/**
 * Build the hygiene aggregate's artifact-aware leaf gates.
 * @param options - gate ids the artifact readers wait for.
 * @returns the hygiene leaf gates.
 */
export function hygieneLeafGates(options: { artifactNeeds?: string[] } = {}): Gate[] {
  const artifactOptions = options.artifactNeeds === undefined ? {} : { needs: options.artifactNeeds }
  return [
    pnpmScript('rescope-vendor', 'rescope-vendor:check', { label: 'vendor rescope' }),
    pnpmScript('publint', 'publint', artifactOptions),
    pnpmScript('constraints', 'constraints'),
    pnpmScript('default-product-isolation', 'verify-default-product-isolation', { label: 'default product isolation' }),
    pnpmScript('package-dependencies', 'verify-package-dependencies', { label: 'package dependencies' }),
    pnpmScript('application-entrypoints', 'verify-application-entrypoints', { label: 'application entrypoints' }),
    pnpmScript('dsh-package-licenses', 'verify-dsh-package-licenses', { label: 'DSH package licenses' }),
    pnpmScript('package-invariants', 'verify-package-invariants', { label: 'package invariants' }),
    builtPackageInvariantsGate(options.artifactNeeds),
    pnpmScript('node-next-types', 'verify-node-next-types', {
      label: 'node-next types',
      ...artifactOptions,
    }),
    ...sharedHygieneGates(),
  ]
}

/**
 * Build the documentation-standard gates for one aggregate.
 * @param options - whether to include the doc typecheck, and what it waits for
 * and passes; the documentation build script to run.
 * @returns the documentation leaf gates.
 */
export function docSyncLeafGates(options: {
  includeDocTypecheck?: boolean
  docTypecheckNeeds?: string[]
  docTypecheckEnv?: Record<string, string | undefined>
  docTypecheckScript?: 'doc-typecheck' | 'doc-typecheck:contracts-ready'
  docsBuildScript?: 'docs:build' | 'docs:build:mpa'
} = {}): Gate[] {
  const docTypecheckOptions: Partial<Gate> = {}
  if (options.docTypecheckNeeds !== undefined) docTypecheckOptions.needs = options.docTypecheckNeeds
  if (options.docTypecheckEnv !== undefined) docTypecheckOptions.env = options.docTypecheckEnv
  return [
    // Stable FIFO starts the longest leaves first; only docs-site-build writes website/.generated.
    ...options.includeDocTypecheck === false
      ? []
      : [pnpmScript('doc-typecheck', options.docTypecheckScript ?? 'doc-typecheck', docTypecheckOptions)],
    pnpmScript('docs-site-build', options.docsBuildScript ?? 'docs:build', { label: 'documentation build' }),
    pnpmScript('doc-graphs', 'verify-doc-graphs', { label: 'doc graphs' }),
    pnpmScript('markdown-links', 'verify-md-links', { label: 'markdown links', quick: true }),
    pnpmScript('type-equivalence', 'verify-type-equiv', { label: 'type equivalence', quick: true }),
    pnpmScript('cordis-catalog', 'verify-cordis-catalog', { label: 'cordis catalog' }),
    pnpmScript('cordis-inspect-catalog', 'verify-cordis-inspect-catalog', { label: 'Cordis inspect catalog' }),
    pnpmScript('workflow-guest', 'verify-workflow-guest', { label: 'workflow guest source' }),
    pnpmScript('mermaid', 'verify-mermaid'),
    pnpmScript('scoped-events', 'verify-scoped-events', { label: 'scoped events' }),
    pnpmScript('translation-pairing', 'verify-translation-pairing', { label: 'translation pairing', quick: true }),
    pnpmScript('markdown-wrap', 'verify-md-wrap', { label: 'markdown wrap', quick: true }),
    pnpmScript('client-catalog', 'verify-client-catalog', { label: 'client catalog' }),
    pnpmScript('export-jsdoc', 'verify-export-jsdoc', { label: 'export jsdoc' }),
    pnpmScript('tool-catalog', 'verify-tool-catalog', { label: 'tool catalog' }),
    pnpmScript('config-catalog', 'verify-config-catalog', { label: 'config catalog' }),
    pnpmScript('plugin-packages', 'verify-plugin-packages', { label: 'skill plugin package list' }),
    pnpmScript('dependency-catalog', 'verify-dependency-catalog', { label: 'npm dependency catalog', quick: true }),
    pnpmScript('persistence-catalog', 'verify-persistence-catalog', { label: 'persistence catalog' }),
    pnpmScript('persistence-changes', 'verify-persistence-changes', { label: 'persistence type history' }),
    pnpmScript('persistence-releases', 'verify-persistence-releases', { label: 'released persistence history' }),
    pnpmScript('persistence-formats', 'verify-persistence-formats', { label: 'Session format references', quick: true }),
    pnpmScript('session-format-catalog', 'verify-session-format-catalog', { label: 'Session format catalog' }),
    pnpmScript('public-repository-links', 'verify-public-repository-links', { label: 'public repository links', quick: true }),
    pnpmScript('repository-references', 'verify-repository-references', { label: 'repository references', quick: true }),
    pnpmScript('concrete-terms', 'verify-concrete-terms', { label: 'concrete terms', quick: true }),
    pnpmScript('doc-refs', 'verify-doc-refs', { label: 'doc refs', quick: true }),
    pnpmScript('subsystem-pages', 'verify-subsystem-pages', { label: 'subsystem pages' }),
    pnpmScript('package-paths', 'verify-package-paths', { label: 'package paths' }),
    pnpmScript('tsconfig-paths', 'verify-tsconfig-paths', { label: 'tsconfig paths' }),
    pnpmScript('config-source-ownership', 'verify-config-source-ownership', { label: 'config source ownership' }),
    pnpmScript('package-readme-summaries', 'verify-package-readme-summaries', { label: 'package README Summaries', quick: true }),
    pnpmScript('package-readme-model-experience', 'verify-package-readme-model-experience', { label: 'package README model experience', quick: true }),
    pnpmScript('agent-note-classification', 'verify-agent-note-classification', { label: 'agent note classification', quick: true }),
    pnpmScript('agent-note-format', 'verify-agent-note-format', { label: 'agent note format', quick: true }),
    pnpmScript('archived-agent-notes', 'verify-archived-agent-notes', { label: 'archived agent notes', quick: true }),
    pnpmScript('skill-invocation-metadata', 'verify-skill-invocation-metadata', { label: 'skill invocation metadata', quick: true }),
    pnpmScript('translation-prompt', 'verify-translation-prompt', { label: 'translation prompt', quick: true }),
    pnpmScript('doc-budgets', 'verify-doc-budgets', { label: 'doc budgets', quick: true }),
    pnpmExec('doc-standard-tests', ['vitest', 'run', 'scripts/doc-standard.spec.ts'], {
      label: 'documentation standard tests',
      quick: true,
    }),
    pnpmExec('docs-site-projection', [
      'vitest', 'run', 'scripts/project-doc-site.spec.ts', 'scripts/verify-doc-site-fragments.spec.ts',
      'website/tests/mermaid-viewer.spec.ts',
      'website/tests/image-viewer.spec.ts',
      'website/tests/code-groups.spec.ts',
      'website/tests/page-markdown-actions.spec.ts', 'website/tests/raw-markdown.spec.ts',
    ], {
      label: 'documentation site checks',
    }),
    pnpmScript('package-readme-limitations', 'verify-package-readme-limitations', { label: 'package README limitations', quick: true }),
  ]
}

/**
 * The quick comprehensive documentation-standard aggregate for `test:docs`.
 * It covers the prose, pairing, README, budget, and Agent Note gates
 * without builds, generator regeneration, or the VitePress site build.
 * @returns the gates admitted by the build-free documentation aggregate.
 */
export function docQuickLeafGates(): Gate[] {
  return docSyncLeafGates({ includeDocTypecheck: false }).filter(gate => gate.quick === true)
}
