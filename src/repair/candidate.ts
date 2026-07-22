/**
 * opencode-memory — Repair Candidate Types (v0.3.3)
 *
 * Types for the candidate queue — repair candidates produced by scanners,
 * reviewed by humans, executed by RepairService.
 */

export type CandidateAction = "archive" | "delete"
export type CandidateRisk = "low" | "medium" | "high"
export type CandidateStatus = "pending" | "approved" | "rejected" | "executed"
export type CandidateType = "legacy_v1" | "stale_session" | "lifecycle_archive" | "lifecycle_delete"

export interface RepairCandidate {
  id: string
  type: CandidateType
  action: CandidateAction
  source: string
  reason: string
  metadata: {
    size: number
    createdAt: number
    lastModified: number
  }
  preview: {
    title: string
    description: string
    sections: string[]
  }
  risk: CandidateRisk
  status: CandidateStatus
  createdAt: number
  /**
   * Which memory scope this candidate originated from (filled by the caller
   * that wraps the scanner, e.g. repair-cli sets "project" or "user").
   * Optional for backward compatibility with single-scope callers.
   */
  scope?: "project" | "user"
}

export type RepairActionType = "archive" | "delete" | "restore"

export interface RepairAction {
  id: string
  type: RepairActionType
  filename: string
  timestamp: number
  approvedBy: string
  reason: string
  candidateId?: string
  result: "success" | "failure"
  error?: string
}

let candidateCounter = 0

export function generateCandidateId(): string {
  candidateCounter++
  return `cand_${Date.now().toString(36)}_${candidateCounter.toString(36)}`
}

export function generateActionId(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function assessRisk(confidence: string | undefined, daysSinceRecall: number | null): CandidateRisk {
  if (confidence === "explicit") return "low"
  if (daysSinceRecall !== null && daysSinceRecall < 30) return "low"
  if (daysSinceRecall !== null && daysSinceRecall < 180) return "medium"
  return "high"
}

// ---------------------------------------------------------------------------
// Merge Candidate (v0.3.4 Phase 2 — Similarity Scanner)
// ---------------------------------------------------------------------------

/** Reason for a merge candidate. */
export type MergeReason = 'semantic_duplicate' | 'feedback_duplicate' | 'near_duplicate'

/** Strategy for selecting which file to keep. */
export type MergeKeepStrategy = 'longer_description' | 'higher_confidence' | 'newer'

/** A candidate for merging two or more similar memories. */
export interface MergeCandidate {
  id: string
  type: 'merge'
  sourceFiles: string[]
  targetFile: string
  similarity: number
  reason: MergeReason
  confidence: 'high' | 'medium' | 'low'
  mergeStrategy: {
    keep: MergeKeepStrategy
  }
  scope: 'user' | 'project'
}
