/**
 * Node half of the RedTeam console client package: inert. Every contribution
 * is browser-side (the Watch tab type and its body), registered by
 * `./client`; the package is listed in node contexts only so the Loader can
 * resolve the package name.
 */

/** No-op node entry: the browser half carries the whole plugin. */
export function apply(): void {}
