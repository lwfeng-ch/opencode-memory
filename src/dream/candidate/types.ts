/**
 * opencode-memory — ConsolidationCandidate Types (v0.5.0)
 *
 * A ConsolidationCandidate represents a potential governance action
 * discovered by the Discovery Engine. It is a proposal, not an execution.
 *
 * CandidateAction:
 * - "merge": combine two or more memories into one
 * - "archive": move to archive (low worthiness / superseded)
 * - "split": mark as conflicting (cannot be auto-resolved)
 * - "keep": no action needed (vital for proving governance is not needed)
 */

import type { EvidenceReport } from "../analyzer/evidence.js"

export type CandidateAction = "merge" | "archive" | "split" | "keep"

export interface ConsolidationCandidate {
  id: string
  clusterId: string
  action: CandidateAction
  targets: string[]
  evidence: EvidenceReport
  expectedGain: number
  riskHint: number
  confidence: number
}

let candidateCounter = 0

export function generateCandidateId(): string {
  candidateCounter++
  return `cand_${Date.now().toString(36)}_${candidateCounter.toString(36)}`
}