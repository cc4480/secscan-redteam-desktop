/**
 * Secret redaction for the event log (v0.33.0).
 *
 * The event stream is the primary audit record, and its raw args/results must
 * never carry a live credential to disk. Two mechanisms, both applied at write
 * time and both pure/testable:
 *
 *   1. KEY-based: any object key that looks like a secret name (token, secret,
 *      password, passwd, pwd, key, credential, authorization, api_key, apikey)
 *      is replaced with "<redacted>" — regardless of depth.
 *   2. VALUE-based: every string is scanned for the literal secrets this
 *      process knows about (from the environment) and any occurrence is
 *      replaced with "<redacted>". This catches secrets embedded inside a
 *      free-form `result` string, which key-based redaction alone cannot.
 *
 * The lesson is from AlterEgo's event log, where redaction was top-level-only
 * and nested secrets (`args.token`, `args.nested.password`) reached disk in
 * cleartext. This port is deliberately recursive on both axes.
 */
/**
 * Collect the literal secret values present in the environment, for value-based
 * redaction. Returns [] when none are set. Values shorter than 6 characters are
 * dropped: masking a 2-char string would corrupt ordinary text.
 */
export declare function collectSecrets(env?: NodeJS.ProcessEnv): string[];
/**
 * Recursively redact a value: secret-named keys are replaced, and any known
 * secret literal is masked wherever it appears in a string. Returns a new value;
 * primitives pass through unchanged.
 */
export declare function redact<T>(value: T, secrets?: string[]): T;
