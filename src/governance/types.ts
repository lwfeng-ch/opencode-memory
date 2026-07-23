/**
 * opencode-memory — Governance Types (v0.5.3)
 */

// ---------------------------------------------------------------------------
// GovernanceConfig
// ---------------------------------------------------------------------------

export interface GovernanceConfig {
  /** Enable/disable autonomous governance. Default false (opt-in). */
  enabled: boolean
  /** Auto-execute low-risk candidates. Default false (review-only). */
  autoExecute: boolean
  /** Max candidates to auto-execute per run. Default 5. */
  maxAutoPerRun: number
  /** Min hours between governance runs. Default 24. */
  minHoursBetweenRuns: number
}

// ---------------------------------------------------------------------------
// ScheduledAction
// ---------------------------------------------------------------------------

export interface ScheduledAction {
  candidateId: string
  action: string
  filename: string
  result: "pending" | "committed" | "rolled_back" | "failed"
  riskScore: number
  error?: string
}

// ---------------------------------------------------------------------------
// GovernanceReport
// ---------------------------------------------------------------------------

export interface GovernanceReport {
  ranAt: string
  durationMs: number
  autoExecuted: number
  skipped: number
  actions: ScheduledAction[]
}