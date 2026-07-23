/**
 * opencode-memory — EvidenceCollector (v0.5.0)
 *
 * Collects governance signals from memory metadata and aggregates them
 * per cluster. Each member receives:
 * - worthiness: from WorthinessScore (0-1)
 * - confidence: from MemoryProvenance (explicit=1.0, inferred=0.6, uncertain=0.3)
 * - usage: from recall events (v0.5.2+, currently 0)
 * - feedback: from recall metrics (v0.5.2+, currently 0)
 * - temporal: from temporalValidity() (0-1)
 *
 * If one member significantly dominates all dimensions, it is marked as "dominant".
 */

import type { MemoryCluster } from "../cluster/types.js"
import { temporalValidity } from "../../conflict/temporal.js"
import type { MemoryProvenance } from "../../memory/provenance.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidenceMember {
  filename: string
  worthiness: number
  confidence: number
  usage: number
  feedback: number
  temporal: number
}

export interface EvidenceReport {
  clusterId: string
  members: EvidenceMember[]
  /** If one member significantly dominates all dimensions, its filename */
  dominant?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a confidence level string to a numeric score.
 */
export function confidenceToScore(confidence: string): number {
  switch (confidence) {
    case "explicit":
      return 1.0
    case "inferred":
      return 0.6
    case "uncertain":
      return 0.3
    default:
      return 0.5
  }
}

/**
 * Extract the numeric confidence from MemoryProvenance or fall back to
 * the top-level confidence field.
 */
export function extractConfidence(
  provenance?: MemoryProvenance,
  confidence?: string,
): number {
  if (provenance?.extraction?.confidenceScore !== undefined) {
    return provenance.extraction.confidenceScore
  }
  return confidenceToScore(confidence ?? "inferred")
}

/**
 * Extract the source type string from MemoryProvenance.
 */
export function extractSourceType(provenance?: MemoryProvenance): string {
  return provenance?.source?.type ?? "unknown"
}

/**
 * Extract the created timestamp from MemoryProvenance.
 */
export function extractTimestamp(provenance?: MemoryProvenance): number {
  return provenance?.created?.timestamp ?? 0
}

// ---------------------------------------------------------------------------
// EvidenceCollector
// ---------------------------------------------------------------------------

export interface MemoryFile {
  filename: string
  content: string
  worthiness: number
  provenance?: MemoryProvenance
  confidence: string
  created?: number
}

export class EvidenceCollector {
  /**
   * Collect evidence for a single cluster.
   * For each member, aggregates governance signals from its memory metadata.
   */
  collect(cluster: MemoryCluster, memories: MemoryFile[]): EvidenceReport {
    const memberMap = new Map(memories.map((m) => [m.filename, m]))

    const members: EvidenceMember[] = cluster.members.map((filename) => {
      const mem = memberMap.get(filename)
      if (!mem) {
        return {
          filename,
          worthiness: 0,
          confidence: 0,
          usage: 0,
          feedback: 0,
          temporal: 0,
        }
      }

      const ts =
        mem.created ?? extractTimestamp(mem.provenance)
      const sourceType = extractSourceType(mem.provenance)

      return {
        filename,
        worthiness: mem.worthiness,
        confidence: extractConfidence(mem.provenance, mem.confidence),
        usage: 0, // v0.5.0: placeholder, populated in v0.5.2
        feedback: 0, // v0.5.0: placeholder, populated in v0.5.2
        temporal: temporalValidity(ts) * (sourceType === "user" ? 1.0 : 0.9),
      }
    })

    // Detect dominant member
    const dominant = this.detectDominant(members)

    return {
      clusterId: cluster.id,
      members,
      dominant,
    }
  }

  /**
   * Detect if one member significantly dominates all dimensions.
   * A member is dominant if its average score across all dimensions
   * is at least 0.3 higher than the next best member.
   */
  private detectDominant(members: EvidenceMember[]): string | undefined {
    if (members.length < 2) return undefined

    const avgScores = members.map((m) => ({
      filename: m.filename,
      avg:
        (m.worthiness +
          m.confidence +
          m.usage +
          m.feedback +
          m.temporal) /
        5,
    }))

    // Sort descending
    avgScores.sort((a, b) => b.avg - a.avg)

    const best = avgScores[0]
    const second = avgScores[1]

    if (best.avg - second.avg >= 0.3) {
      return best.filename
    }

    return undefined
  }
}