/** Route patterns, rule vocabulary, and the roots the browser-route gate scans. */

import { resolve } from 'node:path'

/** Repository root every scanned path resolves against. */
export const repositoryRoot = resolve(import.meta.dirname, '..')

/** Gate name prefixed to every diagnostic and discovery failure. */
export const GATE = 'verify-client-route-resolution'

/** App-owned route prefixes; a foreign path (`/assets/x`) is not governed here. */
export const APP_ROUTE_PREFIX = '(?:api|plugins|open-in-app)(?:/|$)'

/** A root-absolute or protocol-relative app route literal. */
export const ROOT_ABSOLUTE_ROUTE = new RegExp(`^/{1,2}${APP_ROUTE_PREFIX}`)

/** An absolute or protocol-relative app route literal on any origin or scheme. */
export const ABSOLUTE_ROUTE = new RegExp(`^(?:[A-Za-z][A-Za-z\\d+.-]*:)?//[^/]+/${APP_ROUTE_PREFIX}`)

/** A relative app route reference (`api/x`, `./plugins/x`). */
export const RELATIVE_APP_ROUTE = new RegExp(`^(?:\\./)*${APP_ROUTE_PREFIX}`)

/** A shared host route key: the absolute pathname a route is registered under. */
export const HOST_ROUTE_KEY = /(?:^|_)(?:PATH|ENDPOINT)$/

/** Request constructors whose first argument addresses a resource. */
export const REQUEST_CONSTRUCTORS: Record<string, true> = { Request: true, EventSource: true, WebSocket: true, URL: true }

/** Assigned properties and JSX attributes that address a resource. */
export const REQUEST_PROPERTIES: Record<string, true> = { href: true, src: true }

/** Fields a browser resolves against its own document. */
export const REFERENCE_FIELDS: Record<string, true> = { url: true, src: true, href: true, initialUrl: true }

/**
 * Static producer of browser references: the node half composes the boot graph
 * the browser resolves against its document. No request-target position in
 * browser code sees those values, so its reference fields are checked directly.
 */
export const REFERENCE_PRODUCERS = [
  'packages/client/modules/src/index.ts',
]

/** Rule that produced a violation, for diagnostics and for the gate's own coverage. */
export type RouteResolutionRule = 'request-target' | 'location-base' | 'host-route-key' | 'reference-producer'

/** What a scanned file is: browser face, or a static producer of browser references. */
export type RouteGateFace = 'browser' | 'reference-producer'

/** Repair instruction printed beside a violation, keyed by the rule that reported it. */
export const HINT: Record<RouteResolutionRule, string> = {
  'request-target': 'write the route document-relative (api/x)',
  'location-base': 'resolve the route against document.baseURI, not against a location read',
  'host-route-key': 'strip the leading slash before the browser uses this key (KEY.slice(1))',
  'reference-producer': 'emit the browser reference document-relative (plugins/x)',
}

/** One app-owned route reached from a place that binds it to one mount. */
export interface RouteResolutionViolation {
  /** One-based source column. */
  column: number
  /** Repository-relative source path. */
  file: string
  /** One-based source line. */
  line: number
  /** The offending expression, as written. */
  pattern: string
  /** Rule that recognized the route. */
  rule: RouteResolutionRule
}

/** A location expression: `location`, optionally behind its owning global. */
export const LOCATION_EXPRESSION = /^(?:(?:window|self|globalThis|document|top|parent|frames)\.)?(?:defaultView\.)?location$/
