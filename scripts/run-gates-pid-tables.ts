/**
 * Pure helpers over process-table rows: parse `pid ppid` output and walk a
 * snapshot into the descendants of one root.
 */

/** Parse `pid ppid` rows from a process-table dump. Both the POSIX `ps -axo
 * pid=,ppid=` output and the Windows PowerShell `Get-CimInstance Win32_Process`
 * projection emit one `pid ppid` pair per line.
 * @param output - the raw dump text.
 * @returns the parsed pid/ppid rows in line order; blank and malformed lines
 * are dropped.
 */
export function parsePidPpidLines(output: string): Array<[number, number]> {
  const rows: Array<[number, number]> = []
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/)
    if (match !== null) rows.push([Number(match[1]), Number(match[2])])
  }
  return rows
}

/**
 * Walk a process-table snapshot without revisiting duplicate or cyclic PID links.
 * @param root - process whose descendants are collected; excluded from the result.
 * @param rows - observed PID and parent PID pairs.
 * @returns distinct reachable descendants in breadth-first order.
 */
export function collectDescendants(root: number, rows: Array<[number, number]>): number[] {
  const byParent = new Map<number, number[]>()
  for (const [pid, ppid] of rows) {
    const children = byParent.get(ppid) ?? []
    children.push(pid)
    byParent.set(ppid, children)
  }
  const seen = new Set([root])
  const queue = [root]
  for (const parent of queue) {
    for (const pid of byParent.get(parent) ?? []) {
      if (seen.has(pid)) continue
      seen.add(pid)
      queue.push(pid)
    }
  }
  return queue.slice(1)
}
