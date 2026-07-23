/**
 * opencode-memory — Safe Execution Types (v0.5.2)
 *
 * Transaction types for safe memory governance operations.
 * Every mutation goes through Snapshot → Validate → Execute → Commit/Rollback.
 */

// ---------------------------------------------------------------------------
// RiskAssessment
// ---------------------------------------------------------------------------

export interface RiskAssessment {
  /** 0-1, 1 = highest risk */
  score: number
  /** 0-1, how many files affected relative to total */
  impact: number
  /** 0-1, from candidate or provenance */
  confidence: number
  /** Number of files that may be affected */
  blastRadius: number
  /** How reversible is this operation */
  reversibility: "easy" | "partial" | "hard"
  /** Fact-layer evidence from v0.5.1 */
  factEvidence: {
    hasDirectUserInput: boolean
    totalSessions: number
  }
  /** True if score < auto-execute threshold */
  autoExecutable: boolean
  /** Human-readable risk label */
  label: "low" | "medium" | "high"
}

// ---------------------------------------------------------------------------
// TransactionSnapshot
// ---------------------------------------------------------------------------

export interface TransactionSnapshot {
  id: string
  timestamp: number
  operation: "archive" | "delete" | "restore"
  filename: string
  /** Relative to .memory-backup/safe-execution/ */
  backupPath: string
  /** Original file content before mutation */
  originalContent: string
  /** SHA-256 of original content */
  checksum: string
}

// ---------------------------------------------------------------------------
// TransactionContext
// ---------------------------------------------------------------------------

export type TransactionStatus = "pending" | "committed" | "rolled_back" | "failed"

export interface TransactionContext {
  snapshot: TransactionSnapshot
  riskAssessment: RiskAssessment
  candidateId?: string
  status: TransactionStatus
  committedAt?: number
  rolledBackAt?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let txCounter = 0

export function generateSnapshotId(): string {
  txCounter++
  return `snap_${Date.now().toString(36)}_${txCounter.toString(36)}`
}

export function generateTransactionId(): string {
  txCounter++
  return `tx_${Date.now().toString(36)}_${txCounter.toString(36)}`
}