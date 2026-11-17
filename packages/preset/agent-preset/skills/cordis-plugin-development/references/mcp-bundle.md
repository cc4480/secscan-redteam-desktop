# Connect an MCP server

Read `templates/mcp/` with the file-read tool and write its files into your bundle directory. A configuration-only bundle's manifest needs a unique name, version, and `dsh.bundle.patch`, but no Host/Client entry files. Edit `templates/mcp/cordis.patch.yml` to insert the installed `@deepseek-ai/dsh-mcp-client` with `serverName`, transport configuration, and `failOnStartupError: true`.

For Streamable HTTP, set `transport: streamable-http` and `url`. Install the bundle through `plugin_manager`, then call a newly available `mcp__<serverName>__<tool>` tool to verify the connection. For stdio, use `transport: stdio`, `command`, and optional `args`, `env`, and `cwd`; `Config.listConfigs` on the installed row returns the complete client schema. Ambient credentials are scrubbed; reference existing credentials with Loader `!!js` rather than copying secrets into conversation text. Repair the same bundle on failure instead of creating duplicates.
