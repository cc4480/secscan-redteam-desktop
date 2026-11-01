/**
 * Web research tool definitions (deep-research-osint execution layer).
 *
 * Named research_* rather than web_*: the PC bridge already offers the
 * fleet tools literally named web_search/web_fetch when it is
 * connected, and a catalog must never carry two tools under one name.
 * These are the runner-native pair the research skill's contract
 * assumes — available with no bridge, no extra service, and no key.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";

export const RESEARCH_SEARCH_TOOL: JsonSchemaTool = {
  name: "research_search",
  description:
    "Search the public web for engagement research: CVE records, vendor advisories, patch notes, product/version facts, exploit write-ups. Returns citable results — a stable index per result plus title, exact URL, publication date when the source carries one, and snippet. Put date bounds in the `since` parameter (yyyy-mm-dd), never baked into the query text, unless a date is part of the entity's identity (a CVE id, a release name). Copy indices and URLs exactly into citations; a claim with no result behind it is UNVERIFIED. General technology research (a CVE, a product, a technique) is unbounded; a query naming a target host is checked against the engagement record and refused when that host is out of scope.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query. One question per call; run parallel calls for parallel sub-questions." },
      since: { type: "string", description: "Optional lower date bound, yyyy-mm-dd. Results known to predate it are omitted; undated results are kept and stamped undated." },
      limit: { type: "number", description: "Max results to return (1-10, default 8)." },
    },
    required: ["query"],
  },
};

export const RESEARCH_FETCH_TOOL: JsonSchemaTool = {
  name: "research_fetch",
  description:
    "Fetch one web page and return its readable text, stamped with the source URL and the retrieval time — use it on research_search results and on primary sources (an advisory, CVE record, changelog, or write-up) when the snippet is not enough to cite. Downloads and extracted text are capped and the caps are flagged in the output; oversized results remain readable back in full through read_spill. A fetch aimed at a target host is scope-checked against the engagement record exactly like a search naming it.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The exact http/https URL to read, copied from a search result or a primary source." },
    },
    required: ["url"],
  },
};

export const RESEARCH_TOOLS: JsonSchemaTool[] = [RESEARCH_SEARCH_TOOL, RESEARCH_FETCH_TOOL];
