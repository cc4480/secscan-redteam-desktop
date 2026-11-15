/** Weighted longest-processing-time assignment of instrumented files to partitions. */

/**
 * Weight assigned to a file with no recorded duration. One millisecond keeps
 * the LPT assignment purely duration-driven once history exists, while a
 * first run (no cache at all) degrades to an even file-count split.
 */
export const UNKNOWN_FILE_WEIGHT = 1

/**
 * Assign files to partitions by longest-processing-time: heavier files are
 * seeded first into the currently lightest partition, so recorded durations
 * (and the import/environment cost that scales with a partition's file set)
 * spread instead of piling into whichever shard the hash lands them in. A
 * min-heap over the buckets keeps each placement at O(log partitions).
 * @returns one file list per partition, every partition non-empty.
 */
export function assignWeightedPartitions(
  files: readonly string[],
  weights: ReadonlyMap<string, number>,
  partitions: number,
): string[][] {
  if (files.length === 0) return Array.from({ length: partitions }, () => [])
  const weighted = files
    .map(file => ({ file, weight: weights.get(file) ?? UNKNOWN_FILE_WEIGHT }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file))
  const buckets = Array.from({ length: partitions }, () => ({ sum: 0, files: [] as string[] }))
  // Min-heap of bucket indices ordered by (sum, file count); equal sums pick
  // the leaner bucket so a duration-sparse inventory still balances file count.
  const heap = buckets.map((_, index) => index)
  for (const { file, weight } of weighted) {
    const top = heap[0]
    if (top === undefined) throw new Error('coverage partitions: partition heap index is out of bounds.')
    const bucket = buckets[top]
    if (bucket === undefined) throw new Error('coverage partitions: partition bucket is missing.')
    bucket.sum += weight
    bucket.files.push(file)
    siftDown(buckets, heap, 0)
  }
  return buckets.map(bucket => bucket.files)
}

/** Restore the min-heap property after the root bucket grew heavier. */
function siftDown(
  buckets: Array<{ sum: number; files: string[] }>,
  heap: number[],
  index: number,
): void {
  const size = heap.length
  for (;;) {
    const left = 2 * index + 1
    const right = 2 * index + 2
    let smallest = index
    let smallestBucket = bucketAt(buckets, heap, index)
    const leftBucket = left < size ? bucketAt(buckets, heap, left) : undefined
    const rightBucket = right < size ? bucketAt(buckets, heap, right) : undefined
    if (leftBucket !== undefined && smallestBucket !== undefined && bucketLess(leftBucket, smallestBucket)) {
      smallest = left
      smallestBucket = leftBucket
    }
    if (rightBucket !== undefined && smallestBucket !== undefined && bucketLess(rightBucket, smallestBucket)) {
      smallest = right
    }
    if (smallest === index) return
    const moved = heap[index]
    const replacement = heap[smallest]
    if (moved === undefined || replacement === undefined) return
    heap[index] = replacement
    heap[smallest] = moved
    index = smallest
  }
}

/** Read the bucket at a heap position, or undefined when the index is absent. */
function bucketAt(
  buckets: Array<{ sum: number; files: string[] }>,
  heap: number[],
  index: number,
): { sum: number; files: string[] } | undefined {
  const bucketIndex = heap[index]
  return bucketIndex === undefined ? undefined : buckets[bucketIndex]
}

/** Order buckets by total weight, then by file count, then by nothing (stable). */
function bucketLess(
  left: { sum: number; files: string[] } | undefined,
  right: { sum: number; files: string[] } | undefined,
): boolean {
  if (left === undefined || right === undefined) return left !== undefined
  if (left.sum !== right.sum) return left.sum < right.sum
  return left.files.length < right.files.length
}

/** Sum of a partition's file weights; unknown weights count as one. */
export function partitionWeight(files: readonly string[], weights: ReadonlyMap<string, number>): number {
  return files.reduce((sum, file) => sum + (weights.get(file) ?? UNKNOWN_FILE_WEIGHT), 0)
}
