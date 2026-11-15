/** Bounded worker pool over the discovered V4 migration inputs. */

/**
 * Run bounded Session jobs, then retry deferred inputs once after every initial job settles.
 * An unexpected visit rejection drains active workers and aborts the retry pass.
 * @param count - Number of discovered inputs.
 * @param jobs - Positive number of concurrent initial operations.
 * @param visit - Attempt an input; return true to defer its first attempt until the serial retry pass.
 * @returns Completion after all active operations have settled, including on unexpected rejection.
 */
export async function runMigrationJobs(
  count: number,
  jobs: number,
  visit: (index: number, retry: boolean) => Promise<boolean>,
): Promise<void> {
  let next = 0
  const deferred: number[] = []
  const workers = Array.from({ length: Math.min(jobs, count) }, async () => {
    while (next < count) {
      const index = next++
      if (await visit(index, false)) deferred.push(index)
    }
  })
  const results = await Promise.allSettled(workers)
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  for (const index of deferred.sort((a, b) => a - b)) await visit(index, true)
}
