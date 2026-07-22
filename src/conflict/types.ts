/**
 * opencode-memory — Conflict Resolution Types (v0.4.2)
 *
 * Claim-based conflict model: conflicts are detected at the claim level
 * (subject, predicate, value), not the file level. The ConflictGraph
 * models connected components of related conflicts.
 *
 * See: docs/superpowers/specs/v0.4.2/01-conflict-model.md
 */

import type { MemoryProvenance } from "../memory/provenance.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum similarity for candidate pair generation */
export const CANDIDATE_MIN_SIMILARITY = 0.6

/** Minimum similarity for duplicate detection */
export const DUPLICATE_MIN_SIMILARITY = 0.95

/** Minimum similarity for contradiction detection (same topic) */
export const CONTRADICTION_MIN_TOPIC_SIMILARITY = 0.7

/** Superseded keywords — content containing these signals a replacement */
export const SUPERSEDED_KEYWORDS = [
  "switched to", "migrated to", "now using", "no longer",
  "改用", "迁移到", "不再使用", "切换为",
  "upgraded to", "replaced by", "changed to",
] as const

/** Timestamp threshold for superseded detection (7 days) */
export const SUPERSEDED_TIMESTAMP_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictType = "contradiction" | "superseded" | "duplicate"
export type ConflictSeverity = "critical" | "warning" | "info"
export type ProposalAction = "keep_a" | "keep_b" | "merge" | "manual_review"

// ---------------------------------------------------------------------------
// MemoryClaim
// ---------------------------------------------------------------------------

export interface MemoryClaim {
  id: string
  subject: string
  predicate: string
  value: string
  sourceMemory: string
  sourceProvenance?: MemoryProvenance
}

// ---------------------------------------------------------------------------
// MemoryConflict
// ---------------------------------------------------------------------------

export interface MemoryConflict {
  id: string
  claimKey: string
  memories: string[]
  type: ConflictType
  confidence: number
  evidence: {
    similarity: number
    timestamps: number[]
    provenances: Array<{ source: string; confidence: number }>
  }
}

// ---------------------------------------------------------------------------
// ConflictGraph
// ---------------------------------------------------------------------------

export interface ConflictNode {
  id: string
  claims: MemoryClaim[]
}

export interface ConflictEdge {
  id: string
  source: string
  target: string
  type: ConflictType
  claimKey: string
  confidence: number
}

export interface ConflictComponent {
  id: string
  memories: string[]
  edges: ConflictEdge[]
  size: number
}

export interface ConflictGraph {
  nodes: ConflictNode[]
  edges: ConflictEdge[]
  components: ConflictComponent[]
}

// ---------------------------------------------------------------------------
// ConflictResolutionProposal
// ---------------------------------------------------------------------------

export interface ConflictResolutionProposal {
  conflictId: string
  recommendation: ProposalAction
  confidence: "high" | "medium" | "low"
  reasoning: {
    higherWorthiness?: string
    newerLifecycle?: string
    strongerProvenance?: string
  }
  affectedMemories: string[]
  approvedAt?: number
  approvedBy?: string
}

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export function determineSeverity(type: ConflictType, activeCount: number): ConflictSeverity {
  if (type === "contradiction" && activeCount >= 2) return "critical"
  if (type === "superseded") return "warning"
  if (type === "duplicate") return "info"
  return "warning"
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let claimCounter = 0

export function generateClaimId(): string {
  claimCounter++
  return `claim_${Date.now().toString(36)}_${claimCounter.toString(36)}`
}

export function generateConflictId(): string {
  return `conflict_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export function generateEdgeId(): string {
  return `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export function generateComponentId(): string {
  return `comp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export function formatClaimKey(subject: string, predicate: string): string {
  return `${subject}:${predicate}`
}