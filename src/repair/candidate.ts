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
