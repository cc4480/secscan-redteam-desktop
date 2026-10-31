/**
 * Vocabulary shared by the MCP credential store and the welcome window's MCP step.
 *
 * It is a separate module because the store is Node-only while the welcome
 * contract is compiled into the sandboxed renderer as well; both read the same
 * environment names, and a rename has to break both at once rather than silently
 * leave the setup step writing a name the bundled patch does not read.
 */

/**
 * Environment names the bundled red-team patch reads from the Host process
 * environment: the SecScan MCP client row builds its `Authorization` header -
 * and the runner row its URL - from `process.env` at composition time, while
 * the Seclayer row names `SECLAYER_API_KEY` in its `secretEnv` list and the
 * MCP client resolves that name from the same environment when the child
 * spawns. A rename here breaks the store, the form, and the patch together
 * rather than silently leaving one of them reading a name nothing supplies.
 */
export const MCP_ENVIRONMENT_NAMES = ['SECSCAN_MCP_TOKEN', 'REDTEAM_UI_TOKEN', 'REDTEAM_MCP_URL', 'SECLAYER_API_KEY'] as const

/** Environment name the credential document is able to supply. */
export type McpEnvironmentName = typeof MCP_ENVIRONMENT_NAMES[number]

/** Environment names that carry a bearer token rather than a setting. */
export const MCP_TOKEN_NAMES = ['SECSCAN_MCP_TOKEN', 'SECLAYER_API_KEY', 'REDTEAM_UI_TOKEN'] as const

/** Token-carrying environment name; these are masked for display and protected at rest. */
export type McpTokenName = typeof MCP_TOKEN_NAMES[number]

/**
 * Names that select the engagement console the runner row talks to.
 *
 * A value in either one - exported for a run, or stored in this installation's
 * credential document - describes a console the application did not start, so the
 * bundled engagement runner stays off and the value is never overwritten.
 */
export const REDTEAM_CONSOLE_ENVIRONMENT_NAMES = ['REDTEAM_UI_TOKEN', 'REDTEAM_MCP_URL'] as const satisfies readonly McpEnvironmentName[]

/** Console MCP endpoint the bundled patch already falls back to when nothing is configured. */
export const DEFAULT_REDTEAM_MCP_URL = 'http://127.0.0.1:8787/mcp'

/** Raw field values of the setup form; an empty string means "keep what is stored". */
export interface McpCredentialDraftInput {
  readonly secscan: string
  /** The value in the Seclayer API key field. */
  readonly seclayer: string
  readonly runner: string
  readonly endpoint: string
}
