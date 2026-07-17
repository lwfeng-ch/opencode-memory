/**
 * opencode-memory — Repeat Controller
 *
 * Controls how many times each benchmark suite is executed.
 * Key insight: non-deterministic suites (LLM generation) need multiple
 * runs for statistical credibility; deterministic suites need only 1.
 */

/** Policy for repeating a benchmark suite. */
export interface RepeatPolicy {
  suite: string
  runs: number
  /** Human-readable explanation for why this suite is repeated N times */
  reason: string
}

/**
 * Default repeat policies based on suite determinism.
 *
 * - LLM generation suites (extraction, dedup, conflict): 3 runs for stats
 * - Deterministic suites (recall, forgetting): 1 run (no variance)
 */
export const DEFAULT_REPEAT_POLICIES: RepeatPolicy[] = [
  {
    suite: "extraction_pipeline",
    runs: 3,
    reason:
      "LLM generation variance — same input may produce different memory types",
  },
  {
    suite: "recall",
    runs: 1,
    reason: "Ranking is deterministic when embedding model is fixed",
  },
  {
    suite: "dedup",
    runs: 3,
    reason: "Semantic merge judgment has variance",
  },
  {
    suite: "conflict",
    runs: 3,
    reason: "Conflict resolution involves semantic judgment",
  },
  {
    suite: "forgetting",
    runs: 1,
    reason: "Deletion strategy should not be stochastic",
  },
]

/**
 * Controls repeat count per suite.
 * Defaults to built-in policies; can be overridden via constructor.
 */
export class RepeatController {
  private policies: Map<string, RepeatPolicy>

  constructor(policies: RepeatPolicy[] = DEFAULT_REPEAT_POLICIES) {
    this.policies = new Map(policies.map((p) => [p.suite, p]))
  }

  /** Get repeat count for a suite. Returns 1 for unknown suites. */
  getRepeatCount(suite: string): number {
    return this.policies.get(suite)?.runs ?? 1
  }

  /** Get the full policy for a suite, or undefined if unknown. */
  getPolicy(suite: string): RepeatPolicy | undefined {
    return this.policies.get(suite)
  }
}
