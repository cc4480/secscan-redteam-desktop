/** Operations available to the isolated native welcome renderer. */

import type { AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { McpCredentialDraftInput, McpEnvironmentName, McpTokenName } from './mcp-credential-contract.ts'
import type { DesktopLocale } from './locale.ts'

/** Private native welcome channels, installed only while its window exists. */
export const WELCOME_IPC = {
  saveApiKey: 'dsh-welcome:save-api-key',
  skip: 'dsh-welcome:skip',
  start: 'dsh-welcome:start',
  cancel: 'dsh-welcome:cancel',
  copyLink: 'dsh-welcome:copy-link',
  state: 'dsh-welcome:state',
  readMcp: 'dsh-welcome:read-mcp',
  saveMcp: 'dsh-welcome:save-mcp',
  clearMcp: 'dsh-welcome:clear-mcp',
  finishMcp: 'dsh-welcome:finish-mcp',
  readiness: 'dsh-welcome:readiness',
} as const

/** Page the native welcome window opens on. */
export type WelcomePage = 'entry' | 'mcp'

/** Credential writes return a safe outcome without exposing Host diagnostics. */
export type WelcomeSaveResult = { readonly ok: true } | { readonly ok: false }

/** One tool-readiness check and its outcome, passed through from the runner unchanged. */
export interface ReadinessItem {
  /** Stable identifier used by the UI and tests. */
  id: string
  /** Human label. */
  label: string
  /** Whether the requirement is satisfied, absent, unreachable, or unconfigured. */
  state: 'ready' | 'missing' | 'unreachable' | 'not-configured'
  /** What was found, when relevant (path, version, endpoint). */
  detail?: string
  /** What to do when the state is not `ready`. */
  fix?: string
  /** Required items block an engagement; optional ones only degrade it. */
  required: boolean
}

/** The whole tool-readiness report, reduced to what the welcome window needs. */
export interface ReadinessView {
  /** True when every required item is ready. */
  ok: boolean
  /** Short human summary of how many items are ready. */
  summary: string
  /** The individual checks, in report order. */
  items: ReadinessItem[]
}

/** A successful readiness run, or a reason that is safe to show and carries no secret. */
export type ReadinessResult = { ok: true; readiness: ReadinessView } | { ok: false; reason: string }

/**
 * Masked first-run MCP state. It carries a fingerprint and never a credential
 * value: the renderer is sandboxed, and nothing that reaches it may be echoed
 * into a log, an error, or a checked-in fixture.
 */
export interface WelcomeMcpState {
  /** Whether this installation still has to answer the setup step before the workspace opens. */
  readonly required: boolean
  /** Whether the account or API-key entry still follows this step. */
  readonly entryRequired: boolean
  /** Effective console endpoint: the stored one, an inherited environment one, or the row's own default. */
  readonly endpoint: string
  /** Absolute path of the credential document, shown so the file can be audited. */
  readonly storePath: string
  /** Whether a credential document exists, which is what the removal action deletes. */
  readonly stored: boolean
  /** Masked form of each stored token, keyed by the environment name it fills. */
  readonly fingerprints: Partial<Record<McpTokenName, string>>
  /** Token names this run inherits from the process environment rather than from the document. */
  readonly fromEnvironment: readonly McpEnvironmentName[]
}

/** Host-owned operations used by the welcome window. */
export interface WelcomeOperations {
  /** @returns account state after starting a login attempt. */
  startSignIn(): Promise<AccountView>
  /** @param id - attempt to cancel. @returns the settled state. */
  cancelSignIn(id: SignInAttemptId): Promise<AccountView>
  /** @param id - current waiting attempt whose authorization URL is copied to the system clipboard. */
  copySignInLink(id: SignInAttemptId): Promise<void>

  /**
   * Store the official provider's key before entering the workspace.
   * @param value - validated, trimmed API key.
   * @returns whether the write completed, without private error details.
   */
  saveApiKey(value: string): Promise<WelcomeSaveResult>
  /**
   * Enter the workspace without writing an onboarding-completion setting.
   * @returns completion after the workspace opens.
   */
  skip(): Promise<void>

  /**
   * Read first-run MCP state.
   * @returns masked stored tokens, whether the step is required, and where the document lives.
   */
  readMcp(): Promise<WelcomeMcpState>
  /**
   * Store MCP credentials and restart the Host so the MCP rows see them.
   * @param input - raw field values; an empty string keeps the stored entry.
   * @returns whether the values are stored and the Host restarted with them.
   */
  saveMcp(input: McpCredentialDraftInput): Promise<WelcomeSaveResult>
  /**
   * Delete the stored MCP credentials, which revokes them on the next Host start.
   * @returns whether no credential document remains.
   */
  clearMcp(): Promise<WelcomeSaveResult>
  /**
   * Leave the MCP step, recording that it was declined, and continue first run.
   * @returns completion after the workspace is visible, or after the settings window closes.
   */
  finishMcp(): Promise<void>
  /**
   * Ask the bundled engagement runner whether its tools are ready to run an engagement.
   * @returns the mapped doctor report, or a safe reason that never carries a secret.
   */
  readiness(): Promise<ReadinessResult>
}

/** The renderer receives localized copy, login operations, safe account snapshots, and the MCP step. */
export type WelcomeApi = DesktopLocale & WelcomeOperations & {
  /** Page this window opens on. */
  readonly initialPage: WelcomePage
  /** @param listener - safe account snapshot recipient. @returns subscription disposer. */
  onAccountState(listener: (state: AccountView) => void): () => void
}

/** Authentication facts supplied at cold start or after a completed sign-out. */
export interface WelcomeAuthentication {
  readonly loggedIn: boolean
  readonly hasApiKey: boolean
}

/**
 * Decide whether a startup or sign-out requires the welcome entry.
 * @param authentication - current account and independently stored API-key facts.
 * @returns true only when neither authentication route is configured.
 */
export function needsWelcome(authentication: WelcomeAuthentication): boolean {
  return !authentication.loggedIn && !authentication.hasApiKey
}
