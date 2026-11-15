/** Command surface of the one-time V4 Session migration. */

import { availableParallelism, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { migrate } from './migrate-sessions-to-v4-run.ts'

const usage = `Usage: pnpm run migrate:sessions-to-v4 [--sessions-dir PATH] [--jobs N]

Publish V4 successors beside unchanged historical Session generations.
Defaults to ~/.dsh/sessions. Already-V4 Sessions are opened read-only.
No model or API key is used. Failures do not stop subsequent Sessions.
The text log and final JSON summary are saved in a private OS temporary directory.

Options:
  --sessions-dir PATH  Session root to migrate
  --jobs N             Concurrent Sessions, positive integer (default: CPU count capped at 16)
  --help              Show this help
`

/**
 * Parse the contributor-command arguments and run the migration.
 * @returns completion after the run assigns its process status.
 */
export async function main(): Promise<void> {
  try {
    const { values } = parseArgs({ options: { 'sessions-dir': { type: 'string' }, jobs: { type: 'string' }, help: { type: 'boolean' } }, strict: true })
    if (values.help) console.log(usage)
    else {
      const jobs = values.jobs === undefined ? Math.min(availableParallelism(), 16) : Number(values.jobs)
      if (!Number.isSafeInteger(jobs) || jobs < 1) {
        throw new Error('--jobs must be a positive safe integer')
      }
      process.exitCode = await migrate(resolve(values['sessions-dir'] ?? join(homedir(), '.dsh', 'sessions')), jobs)
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(usage)
    process.exitCode = 1
  }
}
