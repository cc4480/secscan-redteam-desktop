/**
 * Local host mode collector (Q-RP-11).
 *
 * The properties pinned here are the mode's reason to exist: inventory is
 * collected through the paired pc-agent channel — no SMB/WinRM/SSH, no
 * target credentials — and collection fails closed when the machine's own
 * hostname is not the declared local target. The first pass is tier-0
 * read-only ops; the four enumeration blocks (volumes, accounts, patches,
 * software) come from tier-2 FIXED read-only PowerShell scripts through
 * the bridge's shell path, gated behind the same identity check. A block
 * whose script is declined, fails, or returns unparseable output is
 * recorded not collected — never fabricated, never partial.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { PC_AGENT_OBSERVE_TOOLS, pcAgentToolTier, type FetchLike, type PcAgentTool } from '../src/host-exec/pc-agent.js'
import {
  LOCAL_COLLECTOR_ID,
  LOCAL_INVENTORY_OPERATIONS,
  LOCAL_TIER2_BLOCKS,
  LOCAL_TIER2_TOOL,
  buildLocalEngagementInput,
  collectLocalInventory,
  localChannelFromEnv,
  localVerificationProof,
  toHostInventoryArtifact,
  writeHostInventoryArtifact,
  type LocalChannel,
} from '../src/local-host/index.js'
import { PC_AGENT_TOOLS, PC_OBSERVE_OPERATIONS } from '../src/tools/pc-agent.js'

const SYSTEM_INFO = JSON.stringify({
  system: 'Windows', release: '11', version: '10.0.26200', machine: 'AMD64',
  hostname: 'CHO-ZEN1', user: 'Cho-zen', cpu_percent: 12.5, mem_percent: 40,
})

type Tier2Name = keyof typeof LOCAL_TIER2_BLOCKS
type ShellFixtures = Partial<Record<Tier2Name, string | Error>>

/** Fixture stdout for the four fixed scripts (the software list carries a
 * duplicate hive row on purpose: the parser must count the program once). */
const SHELL_FIXTURES: Record<Tier2Name, string> = {
  volumes: JSON.stringify([
    { name: 'C:', fileSystem: 'NTFS', sizeBytes: 500107862016, freeBytes: 120440463360 },
    { name: 'D:', fileSystem: 'NTFS', sizeBytes: 2000398934016, freeBytes: 900000000000 },
  ]),
  accounts: JSON.stringify([
    { name: 'Cho-zen', kind: 'local user', enabled: true, groups: ['Administrators', 'Users'] },
    { name: 'looko', kind: 'local user', enabled: false, groups: ['Users'] },
  ]),
  patches: JSON.stringify([
    { id: 'KB5066133', installedOn: '2026-10-12' },
    { id: 'KB5065426', installedOn: '2026-09-09' },
  ]),
  software: JSON.stringify([
    { name: 'Docker Desktop', version: '4.34.0', publisher: 'Docker Inc.' },
    { name: 'Docker Desktop', version: '4.34.0', publisher: 'Docker Inc.' },
    { name: 'Git', version: '2.47.0' },
  ]),
}

interface RecordedCall { tool: string; args: Record<string, unknown> }

/**
 * A stub channel that answers the inventory ops and records every call.
 * `shell` answers the tier-2 scripts, keyed by matching the exact fixed
 * script text; `shellEnvelope` wraps shell answers in the bridge's
 * { returncode, stdout, stderr } envelope form.
 */
function stubChannel(
  overrides: Partial<Record<PcAgentTool, string | Error>> = {},
  shell: ShellFixtures = {},
  shellEnvelope = false,
): { channel: LocalChannel; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const answers: Record<string, string> = {
    system_info: SYSTEM_INFO,
    // The real bridge's envelope form: { count, processes: [{ pid, exe, parent }] }.
    list_processes: '{"count": 2, "processes": [{"pid": 4, "exe": "System"}, {"pid": 900, "exe": "explorer.exe", "parent": 4}]}',
    list_dir: 'file-a.txt\nfile-b.txt',
  }
  const channel: LocalChannel = {
    async call(tool, args) {
      calls.push({ tool, args })
      if (tool === LOCAL_TIER2_TOOL) {
        const name = (Object.keys(LOCAL_TIER2_BLOCKS) as Tier2Name[])
          .find((key) => LOCAL_TIER2_BLOCKS[key].script === args['script'])
        const fixture = name === undefined ? undefined : shell[name]
        if (fixture instanceof Error) throw fixture
        if (typeof fixture === 'string') {
          return shellEnvelope
            ? JSON.stringify({ returncode: 0, stdout: fixture, stderr: '' })
            : fixture
        }
        throw new Error('stub has no answer for shell_pwsh')
      }
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
    // Tier-0 pass first, in order; the four tier-2 shell calls follow it.
    assert.deepEqual(calls.slice(0, 3).map((c) => c.tool), ['system_info', 'list_processes', 'list_dir'])
    assert.deepEqual(calls.slice(3).map((c) => c.tool), [LOCAL_TIER2_TOOL, LOCAL_TIER2_TOOL, LOCAL_TIER2_TOOL, LOCAL_TIER2_TOOL])
  })

  it('names the sections no tier answers as unsupported, with reasons', async () => {
    const { channel } = stubChannel()
    const inventory = await collectLocalInventory(channel, OPTS)
    for (const name of ['services', 'listeningPorts'] as const) {
      assert.equal(inventory.sections[name].status, 'unsupported', name)
      assert.match(inventory.sections[name].note ?? '', /no pc-agent op/u, name)
      assert.equal(inventory.sections[name].batteryCoverage, 'none', name)
    }
  })

  it('runs tier-0 reads first, then only the fixed tier-2 scripts — the no-network-services property', async () => {
    const { channel, calls } = stubChannel({}, SHELL_FIXTURES)
    await collectLocalInventory(channel, OPTS)
    assert.ok(calls.length > 0)
    const firstShell = calls.findIndex((c) => c.tool === LOCAL_TIER2_TOOL)
    assert.ok(firstShell > 0, 'the tier-2 pass runs after the tier-0 pass')
    for (const call of calls.slice(0, firstShell)) {
      assert.ok((LOCAL_INVENTORY_OPERATIONS as readonly string[]).includes(call.tool), call.tool)
      assert.ok((PC_AGENT_OBSERVE_TOOLS as readonly string[]).includes(call.tool as never), call.tool)
      assert.equal(pcAgentToolTier(call.tool), 0, call.tool)
    }
    const fixedScripts = Object.values(LOCAL_TIER2_BLOCKS).map((b) => b.script)
    for (const call of calls.slice(firstShell)) {
      assert.equal(call.tool, LOCAL_TIER2_TOOL, call.tool)
      assert.equal(pcAgentToolTier(call.tool), 2, 'the shell path is the bridge tier-2 op, used deliberately')
      assert.ok(fixedScripts.includes(call.args['script'] as string), 'only the fixed scripts are ever sent')
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

describe('local-host tier-2 blocks (fixed shell scripts)', () => {
  it('fills all four blocks from the scripts’ stdout and reconciles the artifact totals', async () => {
    const { channel } = stubChannel({}, SHELL_FIXTURES)
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.sections.volumes.status, 'collected')
    assert.deepEqual(inventory.sections.volumes.data?.map((v) => v.name), ['C:', 'D:'])
    assert.equal(inventory.sections.volumes.data?.[0]?.freeBytes, 120440463360)
    assert.equal(inventory.sections.users.status, 'collected')
    assert.deepEqual(inventory.sections.users.data?.[0]?.groups, ['Administrators', 'Users'])
    assert.equal(inventory.sections.users.data?.[1]?.enabled, false)
    assert.equal(inventory.sections.patches.status, 'collected')
    assert.deepEqual(inventory.sections.patches.data?.map((p) => p.id), ['KB5066133', 'KB5065426'])
    assert.equal(inventory.sections.installedSoftware.status, 'collected')
    // The duplicate hive row is one program, counted once.
    assert.deepEqual(inventory.sections.installedSoftware.data?.map((s) => s.name), ['Docker Desktop', 'Git'])
    assert.equal(inventory.sections.installedSoftware.data?.[1]?.publisher, undefined)

    const artifact = toHostInventoryArtifact(inventory)
    assert.equal(artifact.status, 'ok')
    if (artifact.status !== 'ok') return
    assert.deepEqual(artifact.inventory.totals, { volumes: 2, accounts: 2, patches: 2, software: 2, files: 0 })
    assert.deepEqual(artifact.inventory.volumes[0], { name: 'C:', fileSystem: 'NTFS', sizeBytes: 500107862016, freeBytes: 120440463360 })
    assert.deepEqual(artifact.inventory.accounts[0], { name: 'Cho-zen', kind: 'local user', enabled: true, groups: ['Administrators', 'Users'] })
    assert.deepEqual(artifact.inventory.patches[0], { id: 'KB5066133', installedOn: '2026-10-12' })
    assert.deepEqual(artifact.inventory.software[0], { name: 'Docker Desktop', version: '4.34.0', publisher: 'Docker Inc.' })
    assert.equal('publisher' in (artifact.inventory.software[1] ?? {}), false, 'an entry with no publisher omits the field')
    assert.match(artifact.inventory.patchLevel, /2 hotfixes/u)
    assert.match(artifact.inventory.patchLevel, /KB5066133/u)
  })

  it('sends exactly the fixed scripts — no interpolation, no extra arguments', async () => {
    const { channel, calls } = stubChannel({}, SHELL_FIXTURES)
    await collectLocalInventory(channel, OPTS)
    const shellCalls = calls.filter((c) => c.tool === LOCAL_TIER2_TOOL)
    assert.deepEqual(
      shellCalls.map((c) => c.args),
      (['volumes', 'accounts', 'patches', 'software'] as const).map((name) => ({
        script: LOCAL_TIER2_BLOCKS[name].script,
        timeout_s: LOCAL_TIER2_BLOCKS[name].timeoutS,
      })),
    )
    for (const block of Object.values(LOCAL_TIER2_BLOCKS)) {
      assert.equal(block.script.includes(OPTS.declaredHostname), false, 'a fixed script carries no target data')
      assert.equal(block.script.includes(OPTS.operatorName), false, 'a fixed script carries no engagement data')
    }
  })

  it('unwraps the bridge envelope form of a shell result', async () => {
    const { channel } = stubChannel({}, SHELL_FIXTURES, true)
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.sections.volumes.status, 'collected')
    assert.equal(inventory.sections.volumes.data?.length, 2)
    assert.equal(inventory.sections.patches.status, 'collected')
    assert.equal(inventory.sections.installedSoftware.status, 'collected')
  })

  it('accepts a single-object result — ConvertTo-Json unrolls a one-row array', async () => {
    const single = JSON.stringify({ name: 'C:', fileSystem: 'NTFS', sizeBytes: 100, freeBytes: 40 })
    const { channel } = stubChannel({}, { ...SHELL_FIXTURES, volumes: single })
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.sections.volumes.status, 'collected')
    assert.deepEqual(inventory.sections.volumes.data?.map((v) => v.name), ['C:'])
  })

  it('a declined consent prompt fails only that block; the artifact records it not collected', async () => {
    const declined = new Error('denied by local approval (or timed out)')
    const { channel } = stubChannel({}, { ...SHELL_FIXTURES, accounts: declined })
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.sections.users.status, 'failed')
    assert.match(inventory.sections.users.note ?? '', /not collected/u)
    assert.match(inventory.sections.users.note ?? '', /denied by local approval/u)
    assert.equal(inventory.sections.volumes.status, 'collected')
    assert.equal(inventory.sections.patches.status, 'collected')
    assert.equal(inventory.sections.installedSoftware.status, 'collected')
    const artifact = toHostInventoryArtifact(inventory)
    assert.equal(artifact.status, 'ok')
    if (artifact.status !== 'ok') return
    assert.deepEqual(artifact.inventory.accounts, [])
    assert.equal(artifact.inventory.totals.accounts, 0)
    assert.equal(artifact.inventory.totals.volumes, 2)
    assert.match(artifact.inventory.patchLevel, /2 hotfixes/u, 'the collected patch block still summarizes')
  })

  it('a nonzero exit or a bridge timeout fails the block, honestly', async () => {
    const exited = JSON.stringify({ returncode: 3, stdout: '', stderr: 'boom' })
    const timedOut = JSON.stringify({ timed_out: true, stdout: '', stderr: '' })
    const { channel } = stubChannel({}, { ...SHELL_FIXTURES, volumes: exited, patches: timedOut })
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.sections.volumes.status, 'failed')
    assert.match(inventory.sections.volumes.note ?? '', /not collected/u)
    assert.match(inventory.sections.volumes.note ?? '', /exited 3/u)
    assert.equal(inventory.sections.patches.status, 'failed')
    assert.match(inventory.sections.patches.note ?? '', /timed out/u)
    assert.equal(inventory.sections.users.status, 'collected')
    const artifact = toHostInventoryArtifact(inventory)
    assert.equal(artifact.status, 'ok')
    if (artifact.status !== 'ok') return
    assert.match(artifact.inventory.patchLevel, /not collected/u)
    assert.equal(artifact.inventory.totals.patches, 0)
  })

  it('truncated (unparseable) output fails the block rather than counting a partial list', async () => {
    const truncated = '[{"id": "KB5066133", "installedOn": "2026-10-1'
    const { channel } = stubChannel({}, { ...SHELL_FIXTURES, patches: truncated })
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.sections.patches.status, 'failed')
    assert.match(inventory.sections.patches.note ?? '', /not collected/u)
    assert.equal(inventory.sections.volumes.status, 'collected')
    assert.equal(inventory.sections.installedSoftware.status, 'collected')
  })

  it('the identity gate aborts before any tier-2 call on a hostname mismatch', async () => {
    const foreign = JSON.stringify({ ...JSON.parse(SYSTEM_INFO), hostname: 'SOMEONE-ELSE' })
    const { channel, calls } = stubChannel({ system_info: foreign }, SHELL_FIXTURES)
    const inventory = await collectLocalInventory(channel, OPTS)
    assert.equal(inventory.target.hostnameMatch, false)
    assert.equal(calls.length, 1, 'no tier-0 continuation and no tier-2 call after a failed identity gate')
    assert.equal(calls.some((c) => c.tool === LOCAL_TIER2_TOOL), false)
    assert.equal(inventory.sections.volumes.status, 'failed')
    assert.equal(inventory.sections.patches.status, 'failed')
  })
})

describe('local-host artifact (pair contract)', () => {
  it('maps a successful collection onto the ok form with real system rows', async () => {
    const { channel } = stubChannel()
    const inventory = await collectLocalInventory(channel, OPTS)
    const artifact = toHostInventoryArtifact(inventory)
    assert.equal(artifact.status, 'ok')
    if (artifact.status !== 'ok') return
    assert.equal(artifact.inventory.hostname, 'CHO-ZEN1')
    assert.equal(artifact.inventory.collector, LOCAL_COLLECTOR_ID)
    const os = artifact.inventory.system.find((row) => row.label === 'OS')
    assert.equal(os?.value, 'Windows')
    // Required blocks whose tier-2 collection did not run (the stub has no
    // shell answers) are present, empty, and reconciled at zero.
    assert.deepEqual(artifact.inventory.volumes, [])
    assert.deepEqual(artifact.inventory.accounts, [])
    assert.deepEqual(artifact.inventory.patches, [])
    assert.deepEqual(artifact.inventory.software, [])
    assert.deepEqual(artifact.inventory.totals, { volumes: 0, accounts: 0, patches: 0, software: 0, files: 0 })
    assert.match(artifact.inventory.patchLevel, /not collected/iu)
    // The tier-0 process list rides along as the optional processes block,
    // mapped from the bridge's envelope rows (exe -> name, parent dropped).
    assert.deepEqual(artifact.inventory.processes, [
      { name: 'System', pid: 4 },
      { name: 'explorer.exe', pid: 900 },
    ])
    // Optional blocks the collector cannot fill are omitted, not emptied.
    assert.equal('filesystem' in artifact.inventory, false)
    assert.equal('sensitive' in artifact.inventory, false)
    assert.equal('defender' in artifact.inventory, false)
  })

  it('omits the processes block when the process section did not collect', async () => {
    const { channel } = stubChannel({ list_processes: new Error('denied') })
    const inventory = await collectLocalInventory(channel, OPTS)
    const artifact = toHostInventoryArtifact(inventory)
    assert.equal(artifact.status, 'ok')
    if (artifact.status !== 'ok') return
    assert.equal('processes' in artifact.inventory, false)
  })

  it('maps a failed identity gate onto the failed form', async () => {
    const { channel } = stubChannel({ system_info: new Error('bridge down') })
    const inventory = await collectLocalInventory(channel, OPTS)
    const artifact = toHostInventoryArtifact(inventory)
    assert.equal(artifact.status, 'failed')
    if (artifact.status !== 'failed') return
    assert.equal(artifact.hostname, 'CHO-ZEN1')
    assert.match(artifact.error, /identity not established/u)
  })

  it('writes host-inventory.json into the engagement directory', async () => {
    const { channel } = stubChannel()
    const inventory = await collectLocalInventory(channel, OPTS)
    const dir = await mkdtemp(join(tmpdir(), 'rp11-artifact-'))
    try {
      const path = await writeHostInventoryArtifact(dir, inventory)
      assert.equal(path, join(dir, 'host-inventory.json'))
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { status?: string }
      assert.equal(parsed.status, 'ok')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('local-host scope posture', () => {
  it('scopes the engagement to exactly the local hostname', () => {
    const input = buildLocalEngagementInput({ hostname: 'CHO-ZEN1', operatorName: 'Carlos' })
    assert.equal(input.target, 'CHO-ZEN1')
    assert.equal(input.localHost, true, "the builder sets B's localHost marker on the engagement input")
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
