/**
 * Tool guard behavior: call-shape validation defects (the repair loop's
 * input), hostname resolution, scope matching against the verified record,
 * and the fail-closed traffic gate whose denial is a result string.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guardToolCall, hostInScope, hostOf, validateCallShape, } from '../src/tool-guard.js';
const TOOLS = [
    {
        name: 'http_probe',
        parameters: {
            required: ['url'],
            properties: {
                url: { type: 'string' },
                method: { type: 'string', enum: ['GET', 'POST'] },
                port: { type: 'integer' },
                timeout: { type: 'number' },
                followRedirects: { type: 'boolean' },
                headers: { type: 'object' },
                tags: { type: 'array' },
            },
        },
    },
    { name: 'note', parameters: { properties: { text: { type: 'string' } } } },
];
const REC = {
    engagementId: 'eng-test-1',
    operator: 'test-operator',
    owner: 'test-owner',
    proofMethod: 'dns-txt',
    recordId: 'rec-test-1',
    verifiedAt: '2026-11-01T00:00:00.000Z',
    targets: ['example.com'],
    accessLevel: 'verified-domain',
    roe: 'test roe',
    sessionsAllowed: true,
};
const TRAFFIC = { trafficTools: ['http_probe'] };
describe('validateCallShape', () => {
    it('accepts a fully valid call', () => {
        const result = validateCallShape(TOOLS, {
            name: 'http_probe',
            arguments: {
                url: 'https://example.com/', method: 'GET', port: 443, timeout: 1.5,
                followRedirects: true, headers: {}, tags: ['a'],
            },
        });
        assert.deepEqual(result, { ok: true });
    });
    it('accepts a call with only the required arguments', () => {
        assert.deepEqual(validateCallShape(TOOLS, { name: 'http_probe', arguments: { url: 'https://example.com/' } }), { ok: true });
    });
    it('rejects an unknown tool, naming the tool', () => {
        const result = validateCallShape(TOOLS, { name: 'nmap_scan', arguments: {} });
        assert.equal(result.ok, false);
        if (!result.ok)
            assert.match(result.defect, /unknown tool "nmap_scan"/);
    });
    it('rejects a missing required argument with its path', () => {
        const result = validateCallShape(TOOLS, { name: 'http_probe', arguments: {} });
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.match(result.defect, /missing required argument "arguments\.url"/);
        }
    });
    it('treats an explicitly undefined required argument as missing', () => {
        const result = validateCallShape(TOOLS, {
            name: 'http_probe',
            arguments: { url: undefined },
        });
        assert.equal(result.ok, false);
        if (!result.ok)
            assert.match(result.defect, /missing required argument/);
    });
    it('rejects a wrong primitive type with path, expected, and actual', () => {
        const result = validateCallShape(TOOLS, {
            name: 'http_probe',
            arguments: { url: 42 },
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.match(result.defect, /"arguments\.url" must be string, got number/);
        }
    });
    it('rejects a non-integer for an integer argument', () => {
        const result = validateCallShape(TOOLS, {
            name: 'http_probe',
            arguments: { url: 'https://example.com/', port: 44.3 },
        });
        assert.equal(result.ok, false);
        if (!result.ok)
            assert.match(result.defect, /"arguments\.port" must be integer/);
    });
    it('rejects an array where an object is declared', () => {
        const result = validateCallShape(TOOLS, {
            name: 'http_probe',
            arguments: { url: 'https://example.com/', headers: ['x'] },
        });
        assert.equal(result.ok, false);
        if (!result.ok)
            assert.match(result.defect, /"arguments\.headers" must be object, got array/);
    });
    it('rejects an enum violation, listing the allowed values', () => {
        const result = validateCallShape(TOOLS, {
            name: 'http_probe',
            arguments: { url: 'https://example.com/', method: 'DELETE' },
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.match(result.defect, /"arguments\.method" must be one of "GET", "POST", got "DELETE"/);
        }
    });
    it('accepts an enum member', () => {
        assert.deepEqual(validateCallShape(TOOLS, {
            name: 'http_probe',
            arguments: { url: 'https://example.com/', method: 'POST' },
        }), { ok: true });
    });
});
describe('hostOf', () => {
    it('reads a bare host argument', () => {
        assert.equal(hostOf({ host: 'Example.COM' }), 'example.com');
    });
    it('parses the host out of a url argument', () => {
        assert.equal(hostOf({ url: 'https://app.example.com:8443/login?next=/' }), 'app.example.com');
    });
    it('prefers the host argument over the url argument', () => {
        assert.equal(hostOf({ host: 'a.example.com', url: 'https://b.example.com/' }), 'a.example.com');
    });
    it('returns null for an unparseable url', () => {
        assert.equal(hostOf({ url: 'not a url' }), null);
    });
    it('returns null when neither argument is usable', () => {
        assert.equal(hostOf({}), null);
        assert.equal(hostOf({ host: 42, url: '' }), null);
    });
});
describe('hostInScope', () => {
    it('allows the exact target host', () => {
        assert.equal(hostInScope(REC, 'example.com'), true);
    });
    it('allows a subdomain of a target', () => {
        assert.equal(hostInScope(REC, 'deep.app.example.com'), true);
    });
    it('denies a lookalike that shares a suffix without a label boundary', () => {
        assert.equal(hostInScope(REC, 'evil-example.com'), false);
        assert.equal(hostInScope(REC, 'notexample.com'), false);
    });
    it('denies a host that merely contains the target as a subdomain', () => {
        assert.equal(hostInScope(REC, 'example.com.evil.com'), false);
    });
    it('normalises case, trailing dot, and port before matching', () => {
        assert.equal(hostInScope(REC, 'APP.Example.com.'), true);
        assert.equal(hostInScope(REC, 'example.com:8443'), true);
    });
    it('normalises targets given as URLs', () => {
        const rec = { ...REC, targets: ['https://example.com/base/path'] };
        assert.equal(hostInScope(rec, 'app.example.com'), true);
    });
    it('denies a subdomain of an outOfScope entry even under an allowed target', () => {
        const rec = { ...REC, outOfScope: ['internal.example.com'] };
        assert.equal(hostInScope(rec, 'internal.example.com'), false);
        assert.equal(hostInScope(rec, 'vault.internal.example.com'), false);
        assert.equal(hostInScope(rec, 'public.example.com'), true);
    });
});
describe('guardToolCall', () => {
    it('allows a traffic call to the exact target host', () => {
        assert.deepEqual(guardToolCall(REC, { name: 'http_probe', arguments: { host: 'example.com' } }, TRAFFIC), { allow: true });
    });
    it('allows a traffic call to a target subdomain given by url', () => {
        assert.deepEqual(guardToolCall(REC, { name: 'http_probe', arguments: { url: 'https://app.example.com/login' } }, TRAFFIC), { allow: true });
    });
    it('denies a lookalike host with the scope-gate result string', () => {
        const result = guardToolCall(REC, { name: 'http_probe', arguments: { host: 'evil-example.com' } }, TRAFFIC);
        assert.equal(result.allow, false);
        if (!result.allow) {
            assert.equal(result.result, `DENIED by scope gate: ${result.reason}`);
            assert.match(result.reason, /"evil-example\.com"/);
        }
    });
    it('denies a traffic call with no resolvable host, fail-closed', () => {
        const result = guardToolCall(REC, { name: 'http_probe', arguments: {} }, TRAFFIC);
        assert.equal(result.allow, false);
        if (!result.allow)
            assert.match(result.result, /^DENIED by scope gate: /);
    });
    it('denies a traffic call whose url is unparseable', () => {
        const result = guardToolCall(REC, { name: 'http_probe', arguments: { url: '::::' } }, TRAFFIC);
        assert.equal(result.allow, false);
    });
    it('denies a traffic call into an outOfScope subdomain', () => {
        const rec = { ...REC, outOfScope: ['internal.example.com'] };
        const result = guardToolCall(rec, { name: 'http_probe', arguments: { host: 'vault.internal.example.com' } }, TRAFFIC);
        assert.equal(result.allow, false);
    });
    it('allows a non-traffic tool regardless of its arguments', () => {
        assert.deepEqual(guardToolCall(REC, { name: 'note', arguments: { text: 'evil-example.com' } }, TRAFFIC), { allow: true });
        assert.deepEqual(guardToolCall(REC, { name: 'note', arguments: {} }, TRAFFIC), { allow: true });
    });
    it('never throws on a denial', () => {
        assert.doesNotThrow(() => guardToolCall(REC, { name: 'http_probe', arguments: { host: 'other.org' } }, TRAFFIC));
    });
});
describe('hostInScope CIDR entries', () => {
    const CIDR_REC = { ...REC, targets: ['10.0.0.0/24'] };
    it('allows an IPv4 host inside the target range', () => {
        assert.equal(hostInScope(CIDR_REC, '10.0.0.7'), true);
        assert.equal(hostInScope(CIDR_REC, '10.0.0.0'), true);
        assert.equal(hostInScope(CIDR_REC, '10.0.0.255'), true);
    });
    it('denies an IPv4 host outside the target range', () => {
        assert.equal(hostInScope(CIDR_REC, '10.0.1.7'), false);
        assert.equal(hostInScope(CIDR_REC, '9.255.255.255'), false);
    });
    it('treats a /32 entry as exactly one address', () => {
        const rec = { ...REC, targets: ['10.0.0.7/32'] };
        assert.equal(hostInScope(rec, '10.0.0.7'), true);
        assert.equal(hostInScope(rec, '10.0.0.8'), false);
    });
    it('treats a /0 entry as every IPv4 address, and no hostname', () => {
        const rec = { ...REC, targets: ['0.0.0.0/0'] };
        assert.equal(hostInScope(rec, '203.0.113.9'), true);
        assert.equal(hostInScope(rec, 'example.com'), false);
    });
    it('lets an outOfScope CIDR deny beat an allowed host entry', () => {
        const rec = { ...REC, targets: ['10.0.0.7'], outOfScope: ['10.0.0.0/24'] };
        assert.equal(hostInScope(rec, '10.0.0.7'), false);
    });
    it('lets an outOfScope CIDR deny carve out part of an allowed CIDR', () => {
        const rec = { ...REC, targets: ['10.0.0.0/16'], outOfScope: ['10.0.0.0/24'] };
        assert.equal(hostInScope(rec, '10.0.0.7'), false);
        assert.equal(hostInScope(rec, '10.0.1.7'), true);
    });
    it('never matches a hostname against a CIDR entry', () => {
        assert.equal(hostInScope(CIDR_REC, 'example.com'), false);
        assert.equal(hostInScope(CIDR_REC, 'app.example.com'), false);
    });
    it('falls back to hostname matching for an invalid CIDR entry', () => {
        const rec = { ...REC, targets: ['10.0.0.0/33'] };
        assert.equal(hostInScope(rec, '10.0.0.0'), true);
        assert.equal(hostInScope(rec, '10.0.0.7'), false);
    });
    it('applies CIDR scope through the traffic gate', () => {
        assert.deepEqual(guardToolCall(CIDR_REC, { name: 'http_probe', arguments: { host: '10.0.0.7' } }, TRAFFIC), { allow: true });
        const denied = guardToolCall(CIDR_REC, { name: 'http_probe', arguments: { url: 'http://10.0.1.7/' } }, TRAFFIC);
        assert.equal(denied.allow, false);
    });
});
