/**
 * DestinationFilter-guarded fetcher — the arsenal module's ONLY network seam
 * (spec §6). Every outbound request from the ingest write path — README
 * fetches and every redirect hop — passes through {@link fetchTextChecked}.
 * No other file in `src/arsenal/` may import a network API (spec §12.12).
 *
 * Policy (spec §6.1, evaluated per request and per redirect hop):
 *   1. `https:` only; every other scheme is denied.
 *   2. No embedded URL credentials; no Authorization header is ever sent —
 *      only a descriptive User-Agent and `Accept: text/plain, text/markdown`.
 *   3. The host is resolved once; if ANY resulting address is loopback,
 *      private, link-local, unspecified, multicast, or otherwise
 *      non-global/reserved, the fetch is denied. The transport then connects
 *      to a PINNED address from that same checked answer (with the original
 *      host preserved for Host/SNI/certificate validation), so the address
 *      validated is the address used — no resolve-twice TOCTOU window.
 *   4. Redirects are followed manually, max 3 hops, each hop re-running the
 *      full policy. A redirect to a denied destination denies the whole fetch.
 *   5. Bounds: 15 s per request, 4 MiB body cap, text-ish content types only.
 *   6. Denials are data for the caller: typed errors, never a crash of the
 *      surrounding refresh (spec §6.1.6 is honored by `ingest.ts`, which
 *      records `{url, reason}` per collection and continues).
 *
 * The resolver and the transport are injected seams
 * (`fetchTextChecked(url, { resolve, transport })`) so tests never touch DNS
 * or the network. The defaults are the real DNS lookup and a `node:https`
 * transport whose `lookup` is pinned to the checked address.
 */

import { defaultResolve, defaultTransport } from './fetch-guard-defaults.js'
import { fetchOneHop } from './fetch-guard-hop.js'
import {
  DestinationDeniedError,
  type ArsenalResolveFn,
  type ArsenalTransportFn,
  type FetchTextCheckedOptions,
  type FetchTextResult,
} from './fetch-guard-types.js'

export { DestinationDeniedError, FetchFailedError } from './fetch-guard-types.js'
export type {
  ArsenalResolveFn,
  ArsenalTransportFn,
  ArsenalTransportRequest,
  ArsenalTransportResponse,
  DenyReason,
  FetchTextCheckedOptions,
  FetchTextResult,
} from './fetch-guard-types.js'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3

/**
 * Fetch a public README over https, under the DestinationFilter policy.
 * The only network function the arsenal module exports (spec §6.2).
 *
 * @param url - the URL to fetch (first hop; redirects are followed manually).
 * @param opts - injected seams and bound overrides (tests inject both seams).
 * @returns the decoded body text, the final URL, and the redirect hop count.
 * @throws {DestinationDeniedError} when policy refuses any hop's destination.
 * @throws {FetchFailedError} when an allowed destination fails operationally.
 */
export async function fetchTextChecked(
  url: string,
  opts: FetchTextCheckedOptions = {},
): Promise<FetchTextResult> {
  const resolve: ArsenalResolveFn = opts.resolve ?? defaultResolve
  const transport: ArsenalTransportFn = opts.transport ?? defaultTransport
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS

  let current = url
  let hops = 0
  for (;;) {
    const outcome = await fetchOneHop(current, hops, {
      resolve,
      transport,
      timeoutMs,
      maxBodyBytes,
    })
    if (outcome.kind === 'final') {
      return { text: outcome.text, finalUrl: current, hops }
    }
    if (hops >= maxRedirects) {
      throw new DestinationDeniedError(
        current,
        'too-many-redirects',
        hops,
        `redirect #${hops + 1} exceeds the ${maxRedirects}-hop limit`,
      )
    }
    hops += 1
    current = outcome.location
  }
}
