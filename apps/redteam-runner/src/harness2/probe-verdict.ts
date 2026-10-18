/**
 * Harness2 probe verdict math (H2-P2b).
 *
 * Split out of probe.ts to stay inside the repo's 300-line file budget. Pure
 * functions only: the probe feeds in the measured per-run metrics and this
 * module decides whether the candidate layer measured better.
 *
 * Decision rule (also documented in probe.ts, the user-facing statement):
 *   primary   = vulnsFound higher
 *   tie-break = falsePositives lower, then steps lower
 *   consistency: the deciding metric may not move the wrong way on any target.
 * Deltas are signed so POSITIVE IS ALWAYS BETTER (computed as base - candidate
 * for the cost metrics, candidate - base for vulnsFound).
 */
import type { ProbeVerdict, RunMetrics } from "./contract.js";

/** One measured run, tagged with the probe target it ran against. */
export interface RunSample {
  readonly targetIndex: number;
  readonly metrics: RunMetrics;
}

export interface ProbeDecision {
  readonly better: boolean;
  readonly reason: string;
}

type DecisionMetric = "vulnsFound" | "falsePositives" | "steps";
type MetricKey = DecisionMetric | "tokensIn" | "tokensOut";

/** Decision order: primary, then the two tie-breaks. */
const DECISION_ORDER: readonly { key: DecisionMetric; higherIsBetter: boolean }[] = [
  { key: "vulnsFound", higherIsBetter: true },
  { key: "falsePositives", higherIsBetter: false },
  { key: "steps", higherIsBetter: false },
];

export const EPSILON = 1e-9;

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function meanOf(runs: readonly RunSample[], key: MetricKey): number {
  return mean(runs.map((run) => run.metrics[key]));
}

/** Keep float noise out of the recorded deltas. */
export function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Compare the two measured sides. Pure and exported so the adoption rule is
 * testable on its own. `targetCount` enables the per-target consistency rule.
 */
export function decideProbe(base: readonly RunSample[], candidate: readonly RunSample[], targetCount: number): ProbeDecision {
  for (const { key, higherIsBetter } of DECISION_ORDER) {
    const baseMean = meanOf(base, key);
    const candidateMean = meanOf(candidate, key);
    const improvement = higherIsBetter ? candidateMean - baseMean : baseMean - candidateMean;
    if (improvement > EPSILON) {
      for (let index = 0; index < targetCount; index++) {
        const baseTarget = meanOf(base.filter((run) => run.targetIndex === index), key);
        const candidateTarget = meanOf(candidate.filter((run) => run.targetIndex === index), key);
        const targetImprovement = higherIsBetter ? candidateTarget - baseTarget : baseTarget - candidateTarget;
        if (targetImprovement < -EPSILON) {
          return {
            better: false,
            reason: `inconsistent direction: candidate is worse on ${key} for probe target #${index + 1}`,
          };
        }
      }
      return {
        better: true,
        reason: `candidate is better on ${key}: mean ${round(candidateMean)} vs base ${round(baseMean)} (${round(improvement)})`,
      };
    }
    if (improvement < -EPSILON) {
      return { better: false, reason: `candidate is worse on ${key}: mean ${round(candidateMean)} vs base ${round(baseMean)}` };
    }
  }
  return { better: false, reason: "no measurable improvement: vulnsFound, falsePositives and steps all tie" };
}

/** All-zero deltas, for a probe that was discarded before measuring anything. */
export function zeroDeltas(): ProbeVerdict["deltas"] {
  return { vulnsFound: 0, falsePositives: 0, steps: 0, tokensIn: 0, tokensOut: 0 };
}

/** A discarded verdict that spent nothing (used by the N < 2 refusal). */
export function discardedVerdict(proposalId: string, reason: string): ProbeVerdict {
  return {
    proposalId,
    adopted: false,
    deltas: zeroDeltas(),
    baseRuns: 0,
    candidateRuns: 0,
    reason: `discarded: ${reason}`,
    tokensSpent: 0,
  };
}
