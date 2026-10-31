/**
 * Local host mode collector (Q-RP-11).
 *
 * The properties pinned here are the mode's reason to exist: inventory is
 * collected through the paired pc-agent channel with read-only (tier-0)
 * calls only — no SMB/WinRM/SSH, no target credentials — and collection
 * fails closed when the machine's own hostname is not the declared local
 * target. Sections the channel has no op for are named unsupported, never
 * fabricated.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PC_AGENT_OBSERVE_TOOLS, pcAgentToolTier, type FetchLike, type PcAgentTool } from '../src/host-exec/pc-agent.js'
import {
  LOCAL_INVENTORY_OPERATIONS,
  buildLocalEngagementInput,
  collectLocalInventory,
  localChannelFromEnv,
  localVerificationProof,
  type LocalChannel,
} from '../src/local-host/index.js'
import { PC_AGENT_TOOLS, PC_OBSERVE_OPERATIONS } from '../src/tools/pc-agent.js'

const SYSTEM_INFO = JSON.stringify({
  system: 'Windows', release: '11', version: '10.0.26200', machine: 'AMD64',
  hostname: 'CHO-ZEN1', user: 'Cho-zen', cpu_percent: 12.5, mem_percent: 40,
})

interface RecordedCall { tool: string; args: Record<string, unknown> }

/** A stub channel that answers the inventory ops and records every call. */
function stubChannel(overrides: Partial<Record<PcAgentTool, string | Error>> = {}): { channel: LocalChannel; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const answers: Record<string, string> = {
    system_info: SYSTEM_INFO,
    list_processes: '[{"pid": 4, "name": "System"}, {"pid": 900, "name": "explorer.exe"}]',
    list_dir: 'file-a.txt\nfile-b.txt',
  }
  const channel: LocalChannel = {
    async call(tool, args) {
      calls.push({ tool, args })
      const override = overrides[tool]
      if (override instanceof Error) throw override
      if (typeof override === 'string') return override
      const answer = answers[tool]
      if (answer === undefined) throw new Error(`stub has no answer for ${tool}`)
      return answer
    },
  }
  return { channel, calls }
}

const OPTS = { declaredHostname: 'CHO-ZEN1', operatorName: 'Carlos', channelUrl: 'https://pc.secscan.info', dirPaths: ['C:\\Users\\Cho-zen'], now: () => new Date('2026-10-31T21:22:00.000Z') }

describe('local-host collector', () => {
  it('collects system, processes and filesystem through the channel', async () => {
    const { channel, calls } = stubChannel()
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.mode, 'local')
    assert.equal(inventory.version, 1)
    assert.equal(inventory.collectedAt, '2026-10-31T21:22:00.000Z')
    assert.equal(inventory.target.hostnameMatch, true)
    assert.equal(inventory.target.collectedHostname, 'CHO-ZEN1')
    assert.equal(inventory.sections.system.status, 'collected')
    assert.equal(inventory.sections.system.data?.hostname, 'CHO-ZEN1')
    assert.equal(inventory.sections.system.data?.cpuPercent, 12.5)
    assert.equal(inventory.sections.processes.status, 'collected')
    assert.equal(inventory.sections.filesystem.status, 'collected')
    assert.equal(inventory.sections.filesystem.data?.[0]?.path, 'C:\\Users\\Cho-zen')
    assert.deepEqual(calls.map((c) => c.tool), ['system_info', 'list_processes', 'list_dir'])
  })

  it('names the sections the channel cannot answer as unsupported, with reasons', async () => {
    const { channel } = stubChannel()
    const inventory = await collectLocalInventory(channel, OPTS)
    for (const name of ['users', 'installedSoftware', 'services', 'listeningPorts', 'patches'] as const) {
      assert.equal(inventory.sections[name].status, 'unsupported', name)
      assert.match(inventory.sections[name].note ?? '', /no pc-agent op/u, name)
      assert.equal(inventory.sections[name].batteryCoverage, 'none', name)
    }
  })

  it('uses only tier-0 inventory operations — the no-network-services property', async () => {
    const { channel, calls } = stubChannel()
    await collectLocalInventory(channel, OPTS)
    assert.ok(calls.length > 0)
    for (const call of calls) {
      assert.ok((LOCAL_INVENTORY_OPERATIONS as readonly string[]).includes(call.tool), call.tool)
      assert.ok((PC_AGENT_OBSERVE_TOOLS as readonly string[]).includes(call.tool as never), call.tool)
      assert.equal(pcAgentToolTier(call.tool), 0, call.tool)
    }
  })

  it('aborts after system_info when the collected hostname is not the declared target', async () => {
    const foreign = JSON.stringify({ ...JSON.parse(SYSTEM_INFO), hostname: 'SOMEONE-ELSE' })
    const { channel, calls } = stubChannel({ system_info: foreign })
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.target.hostnameMatch, false)
    assert.equal(inventory.target.collectedHostname, 'SOMEONE-ELSE')
    assert.equal(calls.length, 1, 'collection must stop at the identity gate')
    assert.equal(inventory.sections.processes.status, 'failed')
    assert.match(inventory.sections.processes.note ?? '', /does not match/u)
  })

  it('aborts when system_info itself fails — identity cannot be established', async () => {
    const { channel, calls } = stubChannel({ system_info: new Error('bridge down') })
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.target.hostnameMatch, false)
    assert.equal(inventory.target.collectedHostname, null)
    assert.equal(calls.length, 1)
    assert.equal(inventory.sections.system.status, 'failed')
    assert.match(inventory.sections.system.note ?? '', /identity not established/u)
  })

  it('keeps collecting other sections when one post-identity op fails', async () => {
    const { channel } = stubChannel({ list_processes: new Error('denied') })
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.target.hostnameMatch, true)
    assert.equal(inventory.sections.processes.status, 'failed')
    assert.equal(inventory.sections.filesystem.status, 'collected')
    assert.equal(inventory.sections.system.status, 'collected')
  })
})

describe('local-host scope posture', () => {
  it('scopes the engagement to exactly the local hostname', () => {
    const input = buildLocalEngagementInput({ hostname: 'CHO-ZEN1', operatorName: 'Carlos' })
    assert.equal(input.target, 'CHO-ZEN1')
    assert.deepEqual(input.roe.scope, ['CHO-ZEN1'])
    assert.deepEqual(input.targets, ['windows'])
    assert.match(input.roe.notes ?? '', /LOCAL MODE/u)
    assert.match(input.roe.notes ?? '', /no network services/iu)
  })

  it('records possession as the ownership basis and claims no service verification', () => {
    const proof = localVerificationProof('CHO-ZEN1', 'Carlos')
    assert.match(proof, /operator possession/iu)
    assert.match(proof, /paired the pc-agent bridge/u)
    assert.match(proof, /none is claimed/u)
  })

  it('exposes the inventory ops on the model-facing pc_observe surface', () => {
    for (const operation of ['system_info', 'list_processes', 'list_dir', 'read_file']) {
      assert.ok((PC_OBSERVE_OPERATIONS as readonly string[]).includes(operation), operation)
    }
    const observe = PC_AGENT_TOOLS.find((tool) => tool.name === 'pc_observe')
    const schema = observe?.parameters as { properties?: { operation?: { enum?: string[] }; path?: unknown } } | undefined
    for (const operation of ['system_info', 'list_processes', 'list_dir', 'read_file']) {
      assert.ok(schema?.properties?.operation?.enum?.includes(operation), `schema enum: ${operation}`)
    }
    assert.ok(schema?.properties?.path !== undefined, 'list_dir/read_file need a path argument in the schema')
  })
})

describe('local-host live channel (env-gated)', () => {
  it('builds the real pc-agent client from env, or reports unconfigured honestly', async () => {
    const savedUrl = process.env['REDTEAM_PC_AGENT_URL']
    const savedToken = process.env['REDTEAM_PC_AGENT_TOKEN']
    delete process.env['REDTEAM_PC_AGENT_URL']
    delete process.env['REDTEAM_PC_AGENT_TOKEN']
    try {
      assert.equal(localChannelFromEnv(), undefined, 'no bridge config must mean no channel, never a fallback')

      // The real client code path (handshake + tools/call) against a local
      // stub transport: this is the live-channel proof the sandbox allows —
      // no real bridge runs on this Linux VM.
      process.env['REDTEAM_PC_AGENT_URL'] = 'http://127.0.0.1:8765/mcp'
      process.env['REDTEAM_PC_AGENT_TOKEN'] = 'x'.repeat(24)
      const fetchImpl: FetchLike = async (_url, init) => {
        const body = JSON.parse(init.body) as { method?: string; params?: { name?: string } }
        const respond = (text: string, headers: Record<string, string> = {}) => ({
          ok: true, status: 200,
          headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
          text: async () => text,
        })
        if (body.method === 'initialize') return respond(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { 'mcp-session-id': 's1' })
        if (body.method === 'notifications/initialized') return respond('')
        const payload = body.params?.name === 'system_info' ? SYSTEM_INFO : body.params?.name === 'list_processes' ? '[]' : 'entry'
        return respond(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: payload }] } }))
      }
      const channel = localChannelFromEnv(process.env, fetchImpl)
      assert.ok(channel !== undefined)
      const inventory = await collectLocalInventory(channel, OPTS)
      assert.equal(inventory.target.hostnameMatch, true)
      assert.equal(inventory.sections.system.status, 'collected')
      assert.equal(inventory.channel.url, 'https://pc.secscan.info', 'the record carries the caller-supplied channel URL')
    } finally {
      if (savedUrl === undefined) delete process.env['REDTEAM_PC_AGENT_URL']
      else process.env['REDTEAM_PC_AGENT_URL'] = savedUrl
      if (savedToken === undefined) delete process.env['REDTEAM_PC_AGENT_TOKEN']
      else process.env['REDTEAM_PC_AGENT_TOKEN'] = savedToken
    }
  })
})
