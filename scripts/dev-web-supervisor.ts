/** One long-lived stage process as the supervisor observes it. */
export interface StageHandle {
  /** Command label used in diagnostics. */
  readonly name: string
  /** Settles with the exit code, or null when a signal ended the stage. */
  readonly exited: Promise<number | null>
  /**
   * Deliver one signal; a no-op once the stage has exited.
   * @param signal - the signal to send.
   */
  kill(signal: NodeJS.Signals): void
}

/** How a requested stop reaches the stages. */
export interface StageStop {
  /** Signal sent to every live stage first; omitted when the terminal already delivered SIGINT to them. */
  readonly signal?: NodeJS.Signals | undefined
  /** Milliseconds to wait for exits before escalating to SIGTERM, and again before SIGKILL. */
  readonly graceMs: number
}

/**
 * Own the live stages: report a stage that exits before a stop was requested,
 * and on a requested stop signal, wait, and escalate until every stage has exited.
 */
export class StageSupervisor {
  private readonly live = new Set<StageHandle>()
  private stopping = false

  /**
   * @param onStale - receives the stage name and exit code when a stage exits before a stop was requested.
   */
  constructor(private readonly onStale: (stage: string, code: number | null) => void) {}

  /**
   * Track one started stage until it exits.
   * @param stage - the stage to supervise.
   */
  add(stage: StageHandle): void {
    this.live.add(stage)
    void stage.exited.then((code) => {
      this.live.delete(stage)
      if (!this.stopping) this.onStale(stage.name, code)
    })
  }

  /**
   * Stop every live stage and resolve once all of them have exited.
   * @param stop - initial signal and the grace period between escalation steps.
   */
  async stop(stop: StageStop): Promise<void> {
    this.stopping = true
    const escalation: (NodeJS.Signals | undefined)[] = [stop.signal]
    if (stop.signal !== 'SIGTERM') escalation.push('SIGTERM')
    for (const signal of escalation) {
      if (this.live.size === 0) return
      if (signal !== undefined) for (const stage of this.live) stage.kill(signal)
      await this.settled(stop.graceMs)
    }
    for (const stage of this.live) stage.kill('SIGKILL')
    await Promise.all([...this.live].map(stage => stage.exited))
  }

  private async settled(graceMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      Promise.all([...this.live].map(stage => stage.exited)),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, graceMs) }),
    ])
    clearTimeout(timer)
  }
}

/**
 * Grace period per escalation step. `dsh web` gives its plugin tree five seconds
 * to dispose after the first signal; escalating earlier would turn the graceful
 * drain into a forced exit.
 */
export const STOP_GRACE_MS = 6_000
