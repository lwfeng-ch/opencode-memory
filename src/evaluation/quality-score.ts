/**
 * opencode-memory — Memory Quality Score (v0.3.4 Phase 1)
 *
 * Lifecycle-aware quality evaluation:
 *   Active Quality (5 dimensions) — only status=active files
 *   Archive Hygiene (4 dimensions) — archived file integrity
 *   Quality Gate Score — activeQuality × coverageRatio
 *
 * Backward-compatible: overall field = gateScore
 */

import type { QualityMemory } from "./quality.js"
import type { QualityReportV2, ActiveQualityReport, ArchiveHygieneReport } from "./types.js"
import {
  checkCompleteness,
  checkConsistency,
  checkFreshness,
  checkNoise,
  checkRetrievability,
  checkArchiveIndexConsistency,
  checkArchiveFrontmatter,
  checkArchiveFileExists,
  checkArchiveCorruption,
} from "./quality.js"

// Re-export
export type { QualityMemory } from "./quality.js"

// ---------------------------------------------------------------------------
// Types (v2 extends v1 for backward compat)
// ---------------------------------------------------------------------------

/** @deprecated Use QualityReportV2 instead. Maintained for backward compat. */
export interface QualityReport {
  overall: number
  dimensions: {
    completeness: number
    consistency: number
    freshness: number
    noise: number
    retrievability: number
  }
}

export type { QualityReportV2 }

/** Interface for memory quality evaluators. */
export interface MemoryQualityEvaluator {
  evaluate(memories: QualityMemory[]): QualityReportV2
}

// ---------------------------------------------------------------------------
// Dimension weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  completeness: 0.20,
  consistency: 0.25,
  freshness: 0.15,
  noise: 0.20,
  retrievability: 0.20,
} as const

const ARCHIVE_WEIGHTS = {
  indexConsistency: 0.40,
  frontmatter: 0.25,
  fileExists: 0.20,
  corruption: 0.15,
} as const

// ---------------------------------------------------------------------------
// DefaultMemoryQualityEvaluator
// ---------------------------------------------------------------------------

/**
 * Default implementation of MemoryQualityEvaluator.
 *
 * v0.3.4 Phase 1: Lifecycle-aware evaluation — partitions memories by
 * status field, computes Active Quality (5 dims) and Archive Hygiene (4 dims)
 * separately, then combines into a Quality Gate Score.
 *
 * Backward-compatible: `overall` field = gateScore.
 */
export class DefaultMemoryQualityEvaluator implements MemoryQualityEvaluator {
  evaluate(memories: QualityMemory[]): QualityReportV2 {
    const now = Date.now()

    // Partition by lifecycle status
    const active = memories.filter(m => !m.status || m.status === 'active')
    const archived = memories.filter(m => m.status === 'archived')

    // Active quality (5 dimensions)
    const activeDims = {
      completeness: checkCompleteness(active),
      consistency: checkConsistency(active),
      freshness: checkFreshness(active, now),
      noise: checkNoise(active),
      retrievability: checkRetrievability(active),
    }

    const activeScore = Math.round(
      activeDims.completeness * WEIGHTS.completeness +
      activeDims.consistency * WEIGHTS.consistency +
      activeDims.freshness * WEIGHTS.freshness +
      activeDims.noise * WEIGHTS.noise +
      activeDims.retrievability * WEIGHTS.retrievability,
    )

    const activeQuality: ActiveQualityReport = {
      score: activeScore,
      count: active.length,
      dimensions: activeDims,
    }

    // Archive hygiene (4 dimensions)
    const archiveDims = {
      indexConsistency: checkArchiveIndexConsistency(archived),
      frontmatter: checkArchiveFrontmatter(archived),
      fileExists: checkArchiveFileExists(archived),
      corruption: checkArchiveCorruption(archived),
    }

    const archiveScore = archived.length > 0
      ? Math.round(
          archiveDims.indexConsistency * ARCHIVE_WEIGHTS.indexConsistency +
          archiveDims.frontmatter * ARCHIVE_WEIGHTS.frontmatter +
          archiveDims.fileExists * ARCHIVE_WEIGHTS.fileExists +
          archiveDims.corruption * ARCHIVE_WEIGHTS.corruption,
        )
      : 100

    const archiveHygiene: ArchiveHygieneReport = {
      score: archiveScore,
      count: archived.length,
      dimensions: archiveDims,
    }

    // Quality Gate Score
    const total = active.length + archived.length
    const coverageRatio = total > 0 ? active.length / total : 1
    const gateScore = Math.round(activeScore * coverageRatio * 10) / 10

    return {
      activeQuality,
      archiveHygiene,
      gateScore,
      overall: gateScore,
    }
  }
}