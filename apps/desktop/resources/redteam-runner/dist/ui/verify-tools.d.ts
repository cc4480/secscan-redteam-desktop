/**
 * Fleet-facing domain-ownership tools.
 *
 * The engagement fleet can only be trusted to test what it proved it owns, and
 * proving it is a DNS challenge this app issues itself — so the fleet needs the
 * two calls that drive that challenge, `verify_domain_start` and
 * `verify_domain_check`, plus the read-only `verify_domain_list`. Without them
 * the operator has to leave the chat to authorize a target, which in practice
 * means the chat runs unverified.
 *
 * Nothing here consults an external service. `start` mints a token and records
 * it locally; `check` reads the operator's TXT record through the system
 * resolver and records the domain as verified on a match. Both fail closed.
 *
 * These are the ONLY tools in this package that reach the verifier, so the
 * authority they add is exactly "prove ownership", never "assert ownership".
 */
import type { ToolDef } from './mcp-tools.js';
/**
 * The three ownership tools, in the shape the console's MCP endpoint serves.
 * @returns tool definitions registered alongside the cockpit and engagement tools.
 */
export declare const VERIFY_TOOLS: ToolDef[];
