/**
 * Seam type shim — NOT a vendored copy.
 *
 * storedXss.ts and redTeam/weakSessionToken.ts import the
 * InjectableTarget type from "./crawler.js" / "../crawler.js". The
 * crawler itself is skip-set (the fleet's own recon supplies
 * discovered targets as tool arguments), so only its target contract
 * is declared here, copied from the source interface. Both consumers
 * use the binding purely as a type; the emitted JS drops the import.
 */
export type HttpMethod = "GET" | "POST";

export interface InjectableTarget {
  url: string; // absolute URL (for GET targets, includes the query string)
  method: HttpMethod;
  params: string[]; // parameter names available to fuzz
  source: "query" | "form" | "script" | "openapi";
  // POST body encoding. Defaults to form-urlencoded; "json" makes the fuzzer send
  // an application/json body (for API endpoints that only accept JSON).
  contentType?: "form" | "json";
  // For a "form" target, the page the <form> was found on.
  discoveredOnPage?: string;
}
