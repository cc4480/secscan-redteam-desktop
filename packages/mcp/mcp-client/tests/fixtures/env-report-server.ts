/**
 * MCP wire fixture that reports its own process environment, so client tests
 * can observe exactly which variables a stdio spawn delivered.
 */

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

function createEnvReportServer(): McpServer {
  const server = new McpServer(
    { name: 'env-report', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.registerTool('report_env', {
    title: 'Report Env',
    description: 'Reports whether a named variable is present in this process environment, and its value when present.',
    inputSchema: z.object({ name: z.string().describe('Environment variable name to report') }),
  }, async args => ({
    content: [{
      type: 'text',
      text: Object.hasOwn(process.env, args.name) ? `present:${process.env[args.name] ?? ''}` : 'absent',
    }],
  }))
  return server
}

serveStdio(createEnvReportServer)
