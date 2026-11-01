# @secscan/redteam-console-share

Host half of the console merge (Q-CONSOLE-MERGE Phase 0): the data channel that carries the RedTeam runner console's surface into the SecScan RedTeam chat client, on the Host's own origin.

The runner console (loopback, port 8787 by default) is token-gated and the browser holds neither its endpoint nor its token. The desktop supervisor installs both into the Host process's environment at launch (`REDTEAM_MCP_URL`, `REDTEAM_UI_TOKEN`); the desktop bundle's patch row (`redteam-console-share` in `packages/redteam/desktop-bundle/cordis.patch.yml`) hands them to this plugin as configuration. The plugin registers one prefix route, `/redteam-console`, on the composition's `webServer`:

- `/redteam-console/api/*` — a streaming proxy of the console's `/api/*` surface (engagement views, the SSE event feed, scope tallies, Foundry state and actions, abort/escalate/reverify posts), with the console bearer attached inside the Host process. Responses stream; nothing buffers, so the feed stays live.
- `/redteam-console/arsenal` — a POST bridge to the console's `/mcp` endpoint for exactly the three read-only Arsenal tools (`arsenal_search`, `arsenal_browse`, `arsenal_recommend`). The console exposes the Arsenal index only as MCP tools; the bridge keeps the browser from ever speaking MCP or holding the token. Any other tool name is refused before anything is sent.

Security: every request first passes the composition `connection` service's `requestRejection` fence (Host/Origin check plus browser authentication), the same fence the open-in-app routes use. The proxy forwards only `/api/` paths, drops the browser's own `authorization`/`cookie` headers, and attaches only the console bearer. The token never appears in a browser-visible URL, header, response, or log line.

The browser half is `@deepseek-ai/dsh-client-ui-redteam-console`, which imports the shared route constants and payload types from this package's `./shared` subpath.

## Model Experience

None. This plugin contributes no model-visible content: no prompts, tools, or session events. It moves operator-visible console data between the Host and the browser only.

## Invariant

No `./invariant` subpath is published: this package owns no relation that two independent observations could disagree about — its routes are registrations disposed with the plugin fiber (proven by the composition test's disposal case), and the console remains the single authority for every value the proxy forwards.

## Known Limitations and Deferred Work

- The proxy forwards the console's `/api/*` namespace as a whole; which surfaces the chat renders is a client-side scope decision (Layers & Gates and Benchmark stay diagnostics-only on the console's own pages by product ruling, and no chat panel is built for them).
- A console that is down answers 502 `console-unavailable`; the client surfaces that as the console being offline rather than retrying here.
