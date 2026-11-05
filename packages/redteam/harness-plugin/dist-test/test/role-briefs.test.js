import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { FleetBriefError, assembledBrief, defaultFleetAgentsDir, fleetAgentsDirCandidates, fleetBriefs, loadRoleFile, promptFileFor, } from '../src/role-briefs.js';
function fixtureDir(files) {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-briefs-'));
    for (const [name, text] of Object.entries(files)) {
        writeFileSync(join(dir, name), text);
    }
    return dir;
}
describe('role-briefs loader', () => {
    it('walks the candidate layouts in order and resolves the real agents directory', () => {
        const candidates = fleetAgentsDirCandidates();
        assert.equal(candidates.length, 4);
        const resolved = defaultFleetAgentsDir();
        assert.ok(candidates.includes(resolved));
        assert.match(readFileSync(join(resolved, '_shared-base.md'), 'utf8'), /shared base/i);
    });
    it('fails loud when no candidate holds the shared base', () => {
        const empty = fixtureDir({});
        assert.throws(() => loadRoleFile('recon.md', empty), FleetBriefError);
        assert.throws(() => loadRoleFile('recon.md', empty), /unreadable/);
    });
    it('fails loud on an empty role file', () => {
        const dir = fixtureDir({ '_shared-base.md': 'base\n', 'recon.md': '  \n' });
        assert.throws(() => loadRoleFile('recon.md', dir), FleetBriefError);
        assert.throws(() => loadRoleFile('recon.md', dir), /empty/);
    });
    it('reduces profile promptFile paths to basenames — no agents/agents doubling', () => {
        assert.equal(promptFileFor('recon'), 'recon.md');
        assert.equal(promptFileFor('coordinator'), 'coordinator.md');
        const dir = fixtureDir({ '_shared-base.md': 'BASE', 'recon.md': 'RECON' });
        assert.equal(assembledBrief('recon', dir), 'BASE\n\nRECON');
    });
    it('throws on an unknown member name', () => {
        assert.throws(() => promptFileFor('nobody'), FleetBriefError);
        assert.throws(() => assembledBrief('nobody'), /unknown fleet member/);
    });
    it('assembles shared base + exactly one blank line + the trimmed role file', () => {
        const dir = defaultFleetAgentsDir();
        const base = readFileSync(join(dir, '_shared-base.md'), 'utf8').trim();
        const recon = readFileSync(join(dir, 'recon.md'), 'utf8').trim();
        assert.equal(assembledBrief('recon'), `${base}\n\n${recon}`);
        assert.equal(assembledBrief('coordinator').startsWith(base), true);
    });
    it('fleetBriefs returns all five members and the identical cached map on a second call', () => {
        const first = fleetBriefs();
        assert.deepEqual([...first.keys()].sort(), ['architect', 'coordinator', 'exploiter', 'recon', 'reporter']);
        for (const brief of first.values()) {
            assert.match(brief, /The playbook is a floor, not a ceiling/);
        }
        assert.equal(fleetBriefs(), first);
    });
});
