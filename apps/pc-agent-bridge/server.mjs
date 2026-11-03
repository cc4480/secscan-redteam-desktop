#!/usr/bin/env node
/**
 * Local-PC agent bridge (MCP Streamable HTTP).
 *
 * The Windows half of `host-exec/pc-agent.ts`: it exposes the closed tool set the
 * runner already gates (eyes = tier 0, hands = tier 1, robot = tier 2), returns an
 * action receipt for every call, and keeps an append-only audit log.
 *
 * Transport: POST /mcp with JSON-RPC (initialize, notifications/initialized,
 * tools/list, tools/call). GET /healthz for a liveness probe. Bearer auth is
 * required; the token must be at least 16 characters.
 *
 * Environment:
 *   PC_AGENT_PORT              default 8765
 *   PC_AGENT_TOKEN             required; bearer token shared with the runner
 *   PC_AGENT_ALLOW_DESTRUCTIVE "1" enables tier-2 tools for this session
 *   PC_AGENT_AUDIT_LOG         default ./pc-agent-audit.jsonl
 *
 * Usage: PC_AGENT_TOKEN=... node server.mjs
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PS1 = join(here, 'win.ps1')
const PORT = Number(process.env.PC_AGENT_PORT ?? 8765)
const TOKEN = process.env.PC_AGENT_TOKEN ?? ''
const ALLOW_DESTRUCTIVE = (process.env.PC_AGENT_ALLOW_DESTRUCTIVE ?? '').trim() === '1'
const AUDIT = process.env.PC_AGENT_AUDIT_LOG ?? join(here, 'pc-agent-audit.jsonl')
const SESSION = randomUUID()

// --- filesystem containment roots (H2) ---------------------------------------
const FS_ROOTS = (process.env.PC_AGENT_FS_ROOTS ?? process.env.PC_AGENT_FS_ROOT ?? homedir())
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(p => resolve(p))

function containedPath(p) {
  const resolved = resolve(String(p ?? ''))
  if (resolved.includes('\0')) throw Object.assign(new Error('invalid path'), { code: 'PATH_DENIED' })
  const lower = resolved.toLowerCase()
  const ok = FS_ROOTS.some(root => {
    const r = root.toLowerCase()
    return lower === r || lower.startsWith(r + '\\') || lower.startsWith(r + '/')
  })
  if (!ok) throw Object.assign(new Error(`path outside allowed roots: ${resolved}`), { code: 'PATH_DENIED' })
  return resolved
}

// --- destructive command denylist (H3) ---------------------------------------
const DESTRUCTIVE_PATTERNS = [
  /\bformat\b/i, /\bdiskpart\b/i, /\brm\s+-rf\s+\/\b/i, /\bdel\s+\/[sfq]/i,
  /\brd\s+\/s\b/i, /\bRemove-Item\b.*-Recurse/i, /\bmkfs\b/i, /\bdd\s+if=/i,
  /\bshutdown\b/i, /\breboot\b/i, /\breg\s+delete\b/i,
]
function isDestructiveCommand(cmd) {
  return DESTRUCTIVE_PATTERNS.some(re => re.test(String(cmd ?? '')))
}

// --- audit redaction (H4) ---------------------------------------------------
const SECRET_KEY_RE = /secret|token|password|passwd|api[_-]?key|credential|private[_-]?key/i
function redactValue(key, value) {
  if (key !== undefined && SECRET_KEY_RE.test(String(key))) return '[REDACTED]'
  if (typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9_\-]{24,}$/.test(value)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((v, i) => redactValue(String(i), v))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(k, v)
    return out
  }
  return value
}

if (TOKEN.length < 16) {
  console.error('pc-agent: PC_AGENT_TOKEN must be at least 16 characters')
  process.exit(2)
}

/** Hash one screenshot at low scale: cheap change detection for receipts. */
async function shotHash() {
  const reply = await ps({ op: 'hash' })
  return reply.shotHash
}

/** Run the PowerShell helper with one JSON request and parse its JSON reply. */
function ps(request) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Request', JSON.stringify(request)], { windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { err += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) return reject(Object.assign(new Error(`powershell exited ${String(code)}: ${err.slice(0, 800)}`), { code: 'PS_FAILED' }))
      try { resolvePromise(JSON.parse(out.replace(/^\uFEFF/u, '').trim())) } catch { reject(Object.assign(new Error(`bad JSON from powershell: ${out.slice(0, 300)}`), { code: 'PS_BAD_JSON' })) }
    })
  })
}

/** Run one local command and capture capped output. */
function run(command, args, timeoutMs = 30_000, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let out = ''
    const timer = setTimeout(() => { child.kill(); }, timeoutMs)
    child.stdout.on('data', chunk => { if (out.length < 64_000) out += chunk })
    child.stderr.on('data', chunk => { if (out.length < 64_000) out += chunk })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); resolvePromise({ code, output: out.slice(0, 64_000) }) })
    if (input !== undefined) { child.stdin.end(String(input)) }
  })
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

/** Wait until the UI stops changing for `quietMs`. */
async function waitIdle(quietMs = 400, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let last = await shotHash()
  let stableSince = Date.now()
  while (Date.now() < deadline) {
    await sleep(100)
    const next = await shotHash()
    if (next !== last) { last = next; stableSince = Date.now() } else if (Date.now() - stableSince >= quietMs) return { settled: true, hash: last }
  }
  return { settled: false, hash: last }
}

const TOOLS = {
  // --- tier 0: observation -------------------------------------------------
  system_info: { tier: 0, schema: {}, run: async () => ({ text: JSON.stringify(await ps({ op: 'system_info' })) }) },
  list_processes: { tier: 0, schema: {}, run: async () => {
    const result = await run('powershell.exe', ['-NoProfile', '-Command', 'Get-Process | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress'])
    return { text: result.output.trim() || '[]' }
  } },
  list_dir: { tier: 0, schema: { path: 'string' }, run: async ({ path }) => ({ text: JSON.stringify(readdirSync(containedPath(path)).slice(0, 500)) }) },
  read_file: { tier: 0, schema: { path: 'string' }, run: async ({ path }) => ({ text: readFileSync(containedPath(path), 'utf8').slice(0, 64_000) }) },
  screen_snapshot: { tier: 0, schema: { window: 'string', scale: 'number' }, run: async (args) => {
    const shot = await ps({ op: 'screenshot', window: args.window, scale: args.scale ?? 0.6 })
    return { text: JSON.stringify({ width: shot.width, height: shot.height, bounds: shot.bounds }), image: { mimeType: shot.mimeType, base64: shot.base64 } }
  } },
  ui_windows: { tier: 0, schema: {}, run: async () => ({ text: JSON.stringify(await ps({ op: 'windows' })) }) },
  ui_tree: { tier: 0, schema: { window: 'string', maxNodes: 'number' }, run: async (args) => ({ text: JSON.stringify(await ps({ op: 'tree', window: args.window, maxNodes: args.maxNodes })) }) },
  ui_describe: { tier: 0, schema: { ref: 'string' }, run: async () => ({ text: JSON.stringify({ error: { code: 'NOT_IMPLEMENTED', message: 'ui_describe needs the element map kept by a long-lived bridge session' } }) }) },
  ui_focused: { tier: 0, schema: {}, run: async () => ({ text: JSON.stringify(await ps({ op: 'focused' })) }) },
  state_hash: { tier: 0, schema: {}, run: async () => ({ text: JSON.stringify(await ps({ op: 'hash' })) }) },
  clipboard_get: { tier: 0, schema: {}, run: async () => {
    // A short-lived PowerShell cannot keep clipboard ownership; clip.exe writes
    // global memory that outlives the process, so set through it and read back
    // through an STA PowerShell on the same session.
    const result = await run('powershell.exe', ['-NoProfile', '-Sta', '-Command', '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()'])
    return { text: JSON.stringify({ text: result.output.replace(/^\uFEFF/u, '').trimEnd() }) }
  } },
  wait_idle: { tier: 0, schema: { quietMs: 'number', timeoutMs: 'number' }, run: async (args) => ({ text: JSON.stringify(await waitIdle(args.quietMs, args.timeoutMs)) }) },
  wait_window: { tier: 0, schema: { title: 'string', timeoutMs: 'number' }, run: async (args) => {
    const deadline = Date.now() + (args.timeoutMs ?? 15000)
    while (Date.now() < deadline) {
      const windows = await ps({ op: 'windows' })
      const found = (Array.isArray(windows) ? windows : [windows]).find(entry => String(entry?.title ?? '').includes(String(args.title ?? '')))
      if (found !== undefined) return { text: JSON.stringify({ found }) }
      await sleep(250)
    }
    throw Object.assign(new Error(`window not found: ${String(args.title)}`), { code: 'NOT_FOUND' })
  } },

  // --- tier 1: safe actions ------------------------------------------------
  ui_invoke: { tier: 1, schema: { ref: 'string' }, run: async () => ({ error: { code: 'NOT_IMPLEMENTED', message: 'ui_invoke needs the element map; use input_click with bounds from ui_tree' } }) },
  ui_set_value: { tier: 1, schema: { ref: 'string', text: 'string' }, run: async () => ({ error: { code: 'NOT_IMPLEMENTED', message: 'ui_set_value needs the element map; use clipboard_set + input_key ctrl+v' } }) },
  ui_toggle: { tier: 1, schema: { ref: 'string' }, run: async () => ({ error: { code: 'NOT_IMPLEMENTED', message: 'ui_toggle needs the element map' } }) },
  input_click: { tier: 1, schema: { x: 'number', y: 'number', button: 'string' }, run: async (args) => ({ text: JSON.stringify(await ps({ op: 'input', kind: 'click', x: args.x, y: args.y, button: args.button })) }) },
  input_type: { tier: 1, schema: { text: 'string' }, run: async (args) => ({ text: JSON.stringify(await ps({ op: 'input', kind: 'type', text: args.text })) }) },
  input_key: { tier: 1, schema: { combo: 'string' }, run: async (args) => ({ text: JSON.stringify(await ps({ op: 'input', kind: 'key', combo: args.combo })) }) },
  input_scroll: { tier: 1, schema: { delta: 'number' }, run: async (args) => ({ text: JSON.stringify(await ps({ op: 'input', kind: 'scroll', delta: args.delta })) }) },
  input_drag: { tier: 1, schema: {}, run: async () => ({ error: { code: 'NOT_IMPLEMENTED', message: 'input_drag is not implemented yet' } }) },
  window_focus: { tier: 1, schema: { title: 'string' }, run: async (args) => {
    const title = String(args.title ?? '').slice(0, 200).replace(/'/g, "''")
    const result = await run('powershell.exe', ['-NoProfile', '-Command', `$w = (Get-Process | Where-Object { $_.MainWindowTitle -like '*${title}*' } | Select-Object -First 1); if ($w) { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate($w.Id); 'ok' } else { 'not-found' }`])
    return { text: result.output.trim() }
  } },
  window_arrange: { tier: 1, schema: {}, run: async () => ({ error: { code: 'NOT_IMPLEMENTED', message: 'window_arrange is not implemented yet' } }) },
  window_close: { tier: 1, schema: { pid: 'number' }, run: async (args) => ({ text: JSON.stringify(await run('taskkill.exe', ['/PID', String(args.pid)])) }) },
  clipboard_set: { tier: 1, schema: { text: 'string' }, run: async (args) => {
    const result = await run('clip.exe', [], 10_000, String(args.text ?? ''))
    return { text: JSON.stringify({ ok: result.code === 0 }) }
  } },
  assert_element: { tier: 1, schema: { ref: 'string', value: 'string' }, run: async () => ({ text: JSON.stringify(await ps({ op: 'assert' })) }) },

  // --- tier 2: robot path --------------------------------------------------
  shell_exec: { tier: 2, schema: { command: 'string', cwd: 'string' }, run: async (args) => {
    if (isDestructiveCommand(args.command)) throw Object.assign(new Error('destructive command denied by pc-agent policy'), { code: 'POLICY_DENIED' })
    return { text: JSON.stringify(await run('cmd.exe', ['/d', '/s', '/c', String(args.command)], args.timeoutMs)) }
  } },
  shell_pwsh: { tier: 2, schema: { command: 'string' }, run: async (args) => {
    if (isDestructiveCommand(args.command)) throw Object.assign(new Error('destructive command denied by pc-agent policy'), { code: 'POLICY_DENIED' })
    return { text: JSON.stringify(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', String(args.command)], args.timeoutMs)) }
  } },
  proc_kill: { tier: 2, schema: { pid: 'number' }, run: async (args) => ({ text: JSON.stringify(await run('taskkill.exe', ['/PID', String(args.pid), '/F'])) }) },
  fs_write: { tier: 2, schema: { path: 'string', content: 'string' }, run: async (args) => { writeFileSync(containedPath(args.path), String(args.content ?? '')); return { text: JSON.stringify({ ok: true }) } } },
  fs_delete: { tier: 2, schema: { path: 'string' }, run: async (args) => { unlinkSync(containedPath(args.path)); return { text: JSON.stringify({ ok: true }) } } },
}

/** MCP tool descriptors derived from the table. */
function toolList() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: `${name} (tier ${String(tool.tier)}). Local-PC bridge tool.`,
    inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(tool.schema).map(([key, type]) => [key, { type }])) },
  }))
}

/** One call: tier gate, receipt, audit. */
async function callTool(name, args) {
  const tool = TOOLS[name]
  if (tool === undefined) return { ok: false, error: { code: 'NOT_FOUND', message: `unknown tool: ${name}` } }
  if (tool.tier === 2 && !ALLOW_DESTRUCTIVE) {
    return { ok: false, error: { code: 'POLICY_DENIED', message: `${name} is destructive; set PC_AGENT_ALLOW_DESTRUCTIVE=1 to enable` } }
  }
  const started = Date.now()
  const before = tool.tier >= 1 ? await shotHash().catch(() => undefined) : undefined
  try {
    const outcome = await tool.run(args ?? {})
    const after = tool.tier >= 1 ? await shotHash().catch(() => undefined) : undefined
    const receipt = {
      tool: name, ok: outcome.error === undefined,
      ...outcome.error === undefined ? {} : { error: outcome.error },
      ...before === undefined ? {} : { before: { shotHash: before } },
      ...after === undefined ? {} : { after: { shotHash: after } },
      ...before === undefined || after === undefined ? {} : { changed: before !== after },
      durationMs: Date.now() - started,
    }
    return { ok: receipt.ok, content: outcome, receipt }
  } catch (error) {
    return { ok: false, error: { code: error.code ?? 'FAILED', message: error instanceof Error ? error.message : String(error) }, receipt: { tool: name, ok: false, error: { code: error.code ?? 'FAILED' }, durationMs: Date.now() - started } }
  }
}

/** Append one audit record; failure to audit never fails the call. */
function audit(record) {
  try { appendFileSync(AUDIT, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`) } catch { /* audit is best effort */ }
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(payload)
}

const server = (await import('node:http')).createServer(async (req, res) => {
  if (req.url === '/healthz') return send(res, 200, { ok: true, session: SESSION })
  if (req.url !== '/mcp' || req.method !== 'POST') return send(res, 404, { error: 'not found' })
  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' })
  let body = ''
  for await (const chunk of req) { body += chunk; if (body.length > 8_000_000) { return send(res, 413, { error: 'too large' }) } }
  let rpc
  try { rpc = JSON.parse(body) } catch { return send(res, 400, { error: 'bad json' }) }
  const id = rpc.id
  if (rpc.method === 'notifications/initialized' || rpc.method === 'notifications/cancelled') return send(res, 202, undefined, { 'mcp-session-id': SESSION })
  if (rpc.method === 'initialize') {
    return send(res, 200, { jsonrpc: '2.0', id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'secscan-pc-agent', version: '0.1.0' } } }, { 'mcp-session-id': SESSION })
  }
  if (rpc.method === 'tools/list') return send(res, 200, { jsonrpc: '2.0', id, result: { tools: toolList() } })
  if (rpc.method === 'tools/call') {
    const name = rpc.params?.name
    const args = rpc.params?.arguments ?? {}
    const outcome = await callTool(name, args)
    audit({ session: SESSION, tool: name, args: redactValue(undefined, args), ok: outcome.ok, receipt: outcome.receipt })
    const content = []
    if (outcome.content?.image !== undefined) {
      content.push({ type: 'image', data: outcome.content.image.base64, mimeType: outcome.content.image.mimeType })
    }
    // The runner's client parses a receipt out of the text result, so an action
    // ships `{ receipt, result }`; an observe call ships its plain text.
    const text = outcome.receipt === undefined
      ? String(outcome.content?.text ?? '')
      : JSON.stringify({ receipt: outcome.receipt, result: outcome.content?.text ?? null })
    content.push({ type: 'text', text })
    return send(res, 200, { jsonrpc: '2.0', id, result: { content, isError: !outcome.ok } })
  }
  return send(res, 200, { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${String(rpc.method)}` } })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`pc-agent bridge on http://127.0.0.1:${String(PORT)}/mcp (destructive ${ALLOW_DESTRUCTIVE ? 'ENABLED' : 'disabled'})`)
})
