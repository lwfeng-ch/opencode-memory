/**
 * opencode-memory — LifecycleValidator (v0.4.1)
 *
 * Evaluates the lifecycle validity of a memory: status appropriateness,
 * archive/restore stability, and oscillation detection.
 *
 * See: docs/superpowers/specs/v0.4.1/04-lifecycle-validator.md
 */

import type { ProvenanceEvent } from "../../memory/provenance.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LifecycleValidityInput {
  status: "active" | "archived"
  recallCount: number
  lastRecalledAt: string | null
  archivedAt: string | number | null
  mtimeMs: number
  history?: ProvenanceEvent[]
}

export interface LifecycleValidityResult {
  score: number
  status: "active" | "archived"
  stability: number
  oscillationDetected: boolean
  oscillationCount: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000
const now = () => Date.now()

// ---------------------------------------------------------------------------
// Status Appropriateness
// ---------------------------------------------------------------------------

export function evaluateStatusAppropriateness(input: {
  status: "active" | "archived"
  recallCount: number
  lastRecalledAt: string | null
  archivedAt: string | number | null
}): number {
  if (input.status === "active") {
    if (input.recallCount > 0 && input.lastRecalledAt) {
      const daysSinceRecall = (now() - new Date(input.lastRecalledAt).getTime()) / DAY_MS
      if (daysSinceRecall < 30) return 1.0
      if (daysSinceRecall < 180) return 0.8
    }
    // Active but never recalled or very old recall
    return 0.5
  }

  // Archived
  const archivedTime = input.archivedAt
    ? (typeof input.archivedAt === "number" ? input.archivedAt : Date.parse(String(input.archivedAt)))
    : null
  if (!archivedTime) return 0.5 // archived but no timestamp — suspicious

  const daysSinceArchive = (now() - archivedTime) / DAY_MS
  if (daysSinceArchive < 90) return 0.8
  if (daysSinceArchive < 180) return 0.5
  return 0.3
}

// ---------------------------------------------------------------------------
// Stability / Oscillation Detection
// ---------------------------------------------------------------------------

export function evaluateStability(
  history?: ProvenanceEvent[],
): { score: number; oscillationDetected: boolean; oscillationCount: number } {
  if (!history || history.length === 0) {
    return { score: 1.0, oscillationDetected: false, oscillationCount: 0 }
  }

  const archiveRestoreEvents = history.filter(
    (e) => e.action === "archived" || e.action === "restored",
  )
  const oscillationCount = archiveRestoreEvents.length

  // No archive/restore events — stable
  if (oscillationCount === 0) {
    return { score: 1.0, oscillationDetected: false, oscillationCount: 0 }
  }

  // 1 event — single archive or restore, no oscillation
  if (oscillationCount === 1) {
    return { score: 1.0, oscillationDetected: false, oscillationCount: 1 }
  }

  // 2-3 events — some oscillation
  if (oscillationCount <= 3) {
    return { score: 0.8, oscillationDetected: true, oscillationCount }
  }

  // 4+ events — significant oscillation
  // Check for same-day oscillation
  const sameDay = hasSameDayOscillation(archiveRestoreEvents)
  if (sameDay) {
    return { score: 0.5, oscillationDetected: true, oscillationCount }
  }

  return { score: 0.6, oscillationDetected: true, oscillationCount }
}

function hasSameDayOscillation(events: ProvenanceEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    const diff = events[i].timestamp - events[i - 1].timestamp
    if (diff > 0 && diff < DAY_MS) {
      // Check if the pair is archive→restore or restore→archive
      const prev = events[i - 1].action
      const curr = events[i].action
      if (
        (prev === "archived" && curr === "restored") ||
        (prev === "restored" && curr === "archived")
      ) {
        return true
      }
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Overall Lifecycle Validity
// ---------------------------------------------------------------------------

export function computeLifecycleValidity(
  input: LifecycleValidityInput,
): LifecycleValidityResult {
  const statusScore = evaluateStatusAppropriateness(input)
  const stability = evaluateStability(input.history)

  const score = statusScore * 0.7 + stability.score * 0.3

  return {
    score: Math.round(score * 100) / 100,
    status: input.status,
    stability: stability.score,
    oscillationDetected: stability.oscillationDetected,
    oscillationCount: stability.oscillationCount,
  }
}