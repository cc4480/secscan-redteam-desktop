/**
 * Test-only preload (wired via --import in the package.json test script,
 * so it runs before any test file imports the router): test processes
 * must never consult the operator's LIVE machine state.
 *
 * Two vectors, both rooted in the environment:
 *  1. The fleet credential pool restores `llm-pool-state.json` from
 *     REDTEAM_HOME (or cwd). A billing-dead mark recorded by a real
 *     engagement would otherwise halt every runEngagement-based test
 *     with a 'blocked' close that has nothing to do with the scenario.
 *  2. The memory store (and anything else rooted at REDTEAM_HOME)
 *     would otherwise open the live engagements tree, where a manifest
 *     mismatch fails tests that never asked for live state.
 *
 * So: a fresh per-process REDTEAM_HOME under the OS tmp dir, plus pool
 * persistence off entirely (in-memory only). Product behavior on live
 * runs is untouched.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.REDTEAM_HOME = mkdtempSync(join(tmpdir(), 'redteam-test-home-'))
process.env.REDTEAM_LLM_POOL_PERSIST = 'off'
