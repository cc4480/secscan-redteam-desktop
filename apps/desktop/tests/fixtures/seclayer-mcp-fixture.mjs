/**
 * Test fixture standing in for @seclayer/mcp in Loader composition tests.
 * Same stdio contract (discover fallback, initialize, tools/list,
 * tools/call) and the same startup behavior the composition asserts: the
 * process exits before serving when SECLAYER_API_KEY is not set in its
 * environment, and serves the three Seclayer tools when it is. No key
 * material is involved; any non-empty value counts as "a key was seated".
 */
import { createInterface } from 'node:readline'

if (!process.env.SECLAYER_API_KEY) {
  console.error('seclayer-mcp fixture: SECLAYER_API_KEY is not set')
  process.exit(1)
}

const TOOLS = [
  {
    name: 'seclayer_scan',
    description: 'Start a Seclayer scan of a URL.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'seclayer_list_scans',
    description: 'List the Seclayer scans on the account.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'seclayer_get_report',
    description: 'Fetch the report for a Seclayer scan.',
    inputSchema: { type: 'object', properties: { scanId: { type: 'string' } }, required: ['scanId'] },
  },
]

process.stdin.once('end', () => process.exit(0))

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  const request = JSON.parse(line)
  if (request.id === undefined) return
  if (request.method === 'server/discover') {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' },
    })}\n`)
    return
  }
  const result = request.method === 'initialize'
    ? {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'seclayer-mcp', version: '1.0.0' },
      }
    : request.method === 'tools/list'
      ? { tools: TOOLS }
      : request.method === 'tools/call'
        ? { content: [{ type: 'text', text: 'fixture result' }] }
        : {}
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
})
