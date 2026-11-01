/**
 * Tool-call guard for the fleet: two checks the runner applies before any
 * dispatch.
 *
 * `validateCallShape` is JSON validation of one model-issued call against the
 * registered tool definitions. Its defects feed the bounded repair loop, so a
 * defect is always a call-shape problem (unknown tool, missing argument,
 * wrong primitive type, enum violation) with a path-qualified message the
 * model can act on — never a policy judgement.
 *
 * `guardToolCall` is the scope gate for tools that generate traffic. A
 * traffic call whose host does not resolve, or resolves outside the verified
 * engagement record, is denied fail-closed. Denial is a result string in the
 * runner's dispatch convention, never a throw, so the engagement continues
 * with the denial visible to the model instead of dying on an exception.
 */
import type { VerifiedEngagementRecord } from './types.js'

/** One registered tool definition, reduced to the fields validation needs. */
export interface ToolDef {
  /** Tool name as the model issues it. */
  name: string
  /** JSON-Schema-style parameter declaration. */
  parameters: {
    /** Argument names that must be present. */
    required?: string[]
    /** Per-argument schema: primitive `type` and/or a string `enum`. */
    properties?: Record<string, { type?: string; enum?: string[] }>
  }
}

/** One model-issued tool call. */
export interface ToolCall {
  /** Tool name. */
  name: string
  /** Argument values by name, as parsed from the model's JSON. */
  arguments: Record<string, unknown>
}

/** Outcome of {@link validateCallShape}: valid, or one specific defect. */
export type CallShapeResult = { ok: true } | { ok: false; defect: string }

/** Outcome of {@link guardToolCall}: allowed, or denied with its result text. */
export type ToolCallGuardResult =
  | { allow: true }
  | { allow: false; result: string; reason: string }

/**
 * Describes a value's runtime type for defect messages.
 * @param value - the offending argument value.
 * @returns `null`, `array`, or the `typeof` result.
 */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Checks a value against one declared primitive schema type. Type names the
 * guard does not recognise impose no check.
 * @param declared - the schema `type` string.
 * @param value - the argument value.
 * @returns true when the value satisfies the declared type.
 */
function matchesDeclaredType(declared: string, value: unknown): boolean {
  switch (declared) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'null':
      return value === null
    default:
      return true
  }
}

/**
 * Validates one call against the registered tool definitions: the tool must
 * exist, every required argument must be present (an explicit `undefined`
 * counts as missing), each present argument must satisfy its declared
 * primitive type, and a string argument with an `enum` must be a member.
 * @param tools - the registered tool definitions.
 * @param call - the model-issued call.
 * @returns `{ ok: true }`, or the first defect found, path-qualified.
 */
export function validateCallShape(tools: ToolDef[], call: ToolCall): CallShapeResult {
  const tool = tools.find((candidate) => candidate.name === call.name)
  if (!tool) {
    return { ok: false, defect: `call "${call.name}": unknown tool "${call.name}"` }
  }
  const args = call.arguments
  for (const requiredName of tool.parameters.required ?? []) {
    if (!(requiredName in args) || args[requiredName] === undefined) {
      return {
        ok: false,
        defect: `call "${call.name}": missing required argument "arguments.${requiredName}"`,
      }
    }
  }
  for (const [argName, schema] of Object.entries(tool.parameters.properties ?? {})) {
    const value = args[argName]
    if (value === undefined) continue
    if (schema.type !== undefined && !matchesDeclaredType(schema.type, value)) {
      return {
        ok: false,
        defect:
          `call "${call.name}": argument "arguments.${argName}" must be ${schema.type}, ` +
          `got ${describeValue(value)}`,
      }
    }
    if (schema.enum !== undefined && (typeof value !== 'string' || !schema.enum.includes(value))) {
      const allowed = schema.enum.map((entry) => JSON.stringify(entry)).join(', ')
      return {
        ok: false,
        defect:
          `call "${call.name}": argument "arguments.${argName}" must be one of ${allowed}, ` +
          `got ${JSON.stringify(value) ?? describeValue(value)}`,
      }
    }
  }
  return { ok: true }
}

/**
 * Normalises a hostname candidate: case-folds, strips brackets, a numeric
 * port suffix, and a trailing root dot.
 * @param raw - the candidate hostname text.
 * @returns the normalised hostname, or null when nothing usable remains or
 * the text contains characters a hostname cannot.
 */
function normalizeHostname(raw: string): string | null {
  let host = raw.trim().toLowerCase()
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close < 0) return null
    host = host.slice(1, close)
  } else {
    const colon = host.lastIndexOf(':')
    if (colon > 0 && /^\d+$/.test(host.slice(colon + 1))) {
      host = host.slice(0, colon)
    }
  }
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (host === '' || /[\s/?#@]/.test(host)) return null
  return host
}

/**
 * Extracts a normalised hostname from a host-or-URL text value: URL text is
 * parsed as a URL, bare text is treated as a hostname.
 * @param raw - the text value from a `host` or `url` argument.
 * @returns the hostname, or null when unparseable.
 */
function hostnameFromText(raw: string): string | null {
  const text = raw.trim()
  if (text === '') return null
  if (text.includes('://')) {
    try {
      const parsed = new URL(text)
      return parsed.hostname === '' ? null : normalizeHostname(parsed.hostname)
    } catch {
      return null
    }
  }
  const hostPart = text.split('/')[0] ?? ''
  return normalizeHostname(hostPart)
}

/**
 * Resolves the target host of a call's arguments: `args.host` when it is a
 * non-empty string (a hostname or URL), otherwise `args.url` parsed as a
 * URL. A present-but-unusable `host` fails closed to null rather than
 * falling through to `url`.
 * @param args - the call arguments.
 * @returns the normalised hostname, or null when none resolves.
 */
export function hostOf(args: Record<string, unknown>): string | null {
  const host = args.host
  if (typeof host === 'string' && host.trim() !== '') {
    return hostnameFromText(host)
  }
  const url = args.url
  if (typeof url === 'string' && url.trim() !== '') {
    try {
      const parsed = new URL(url.trim())
      return parsed.hostname === '' ? null : normalizeHostname(parsed.hostname)
    } catch {
      return null
    }
  }
  return null
}

/**
 * Whether `host` equals `pattern` or is a subdomain of it. Both inputs must
 * already be normalised.
 * @param host - the candidate hostname.
 * @param pattern - the scope entry hostname.
 * @returns true on an exact or subdomain match.
 */
function hostMatchesPattern(host: string, pattern: string): boolean {
  return host === pattern || host.endsWith(`.${pattern}`)
}

/**
 * Parses a dotted-quad IPv4 address into its 32-bit value.
 * @param host - the normalised candidate hostname.
 * @returns the address value, or null when `host` is not a valid IPv4 address.
 */
function parseIPv4(host: string): number | null {
  const octets = host.split('.')
  if (octets.length !== 4) return null
  let value = 0
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null
    const part = Number(octet)
    if (part > 255) return null
    value = value * 256 + part
  }
  return value
}

/**
 * Parses an IPv4 CIDR scope entry (`a.b.c.d/n`, 0 <= n <= 32) into its
 * masked network value and mask. IPv6 CIDR entries are not supported: they
 * do not parse here and fall back to hostname matching, as does any entry
 * whose address or prefix is invalid.
 * @param raw - the scope entry text (a bare CIDR or a URL carrying one).
 * @returns the masked network and mask, or null when `raw` is not a valid
 * IPv4 CIDR entry.
 */
function parseIPv4Cidr(raw: string): { network: number; mask: number } | null {
  const text = raw.trim().toLowerCase()
  let addressText = text
  let prefixText: string | undefined
  if (text.includes('://')) {
    try {
      const parsed = new URL(text)
      addressText = parsed.hostname
      prefixText = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname
    } catch {
      return null
    }
  } else {
    const slash = text.indexOf('/')
    if (slash < 0) return null
    addressText = text.slice(0, slash)
    prefixText = text.slice(slash + 1)
  }
  if (prefixText === undefined || !/^\d{1,2}$/.test(prefixText)) return null
  const prefix = Number(prefixText)
  if (prefix > 32) return null
  const address = parseIPv4(addressText)
  if (address === null) return null
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return { network: (address & mask) >>> 0, mask }
}

/**
 * Whether a normalised host matches one scope entry: a valid IPv4 CIDR
 * entry matches IPv4 hosts by masked network equality (a hostname never
 * matches a CIDR entry); any other entry matches by exact host or
 * subdomain.
 * @param host - the normalised candidate hostname.
 * @param entry - the raw scope entry (target or out-of-scope).
 * @returns true when the entry covers the host.
 */
function hostMatchesEntry(host: string, entry: string): boolean {
  const cidr = parseIPv4Cidr(entry)
  if (cidr !== null) {
    const address = parseIPv4(host)
    if (address === null) return false
    return (address & cidr.mask) >>> 0 === cidr.network
  }
  const pattern = hostnameFromText(entry)
  return pattern !== null && hostMatchesPattern(host, pattern)
}

/**
 * Whether a host is inside the verified engagement record: an exact match
 * or a subdomain of any target, and not an exact match or subdomain of any
 * `outOfScope` entry. Deny beats allow. Targets and exclusions may be bare
 * hosts or URLs; both are normalised before matching, as is the host. A
 * target or exclusion may instead be an IPv4 CIDR entry, which matches
 * IPv4 hosts by masked network equality.
 * @param rec - the verified engagement record.
 * @param host - the candidate host (hostname or URL text).
 * @returns true when the host is in scope.
 */
export function hostInScope(rec: VerifiedEngagementRecord, host: string): boolean {
  const normalized = hostnameFromText(host)
  if (normalized === null) return false
  for (const denied of rec.outOfScope ?? []) {
    if (hostMatchesEntry(normalized, denied)) return false
  }
  for (const target of rec.targets) {
    if (hostMatchesEntry(normalized, target)) return true
  }
  return false
}

/**
 * The scope gate the runner applies before dispatch. Non-traffic tools are
 * always allowed. A traffic tool is allowed only when its arguments resolve
 * to a host inside the verified record; otherwise the call is denied
 * fail-closed with a `DENIED by scope gate: <reason>` result string.
 * @param rec - the verified engagement record.
 * @param call - the model-issued call.
 * @param opts - `trafficTools`: the tool names that generate traffic.
 * @returns `{ allow: true }`, or the denial with its dispatch result text.
 */
export function guardToolCall(
  rec: VerifiedEngagementRecord,
  call: ToolCall,
  opts: { trafficTools: string[] },
): ToolCallGuardResult {
  if (!opts.trafficTools.includes(call.name)) return { allow: true }
  const host = hostOf(call.arguments)
  if (host === null) {
    const reason =
      `tool "${call.name}" does not resolve to a target host ` +
      `(no usable "host" or "url" argument)`
    return { allow: false, result: `DENIED by scope gate: ${reason}`, reason }
  }
  if (!hostInScope(rec, host)) {
    const reason =
      `host "${host}" is not within the verified targets of engagement "${rec.engagementId}"`
    return { allow: false, result: `DENIED by scope gate: ${reason}`, reason }
  }
  return { allow: true }
}
