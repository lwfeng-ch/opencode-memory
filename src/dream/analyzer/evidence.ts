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
  /** v0.5.1: Points to the fact record in fact/sessions/ */
  factId?: string
  /** v0.5.1: How many distinct sessions this memory was extracted from */
  factSessionCount?: number
  /** v0.5.1: Source type from provenance (user/session/extraction/feedback/migration) */
  sourceType: string
}

export interface EvidenceReport {
  clusterId: string
  members: EvidenceMember[]
  /** If one member significantly dominates all dimensions, its filename */
  dominant?: string
  /** v0.5.1: Cluster-level fact evidence summary */
  factEvidence?: {
    totalSessions: number
    sessionSpanDays: number
    hasDirectUserInput: boolean
  }
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
// Fact Summary (v0.5.1)
// ---------------------------------------------------------------------------

export interface FactSummary {
  sessionId: string
  factId: string
  messageCount: number
  toolCallCount: number
  durationMinutes: number
  gitBranch: string
  /** ISO timestamp of the fact record (created_at).
   *  Used to compute sessionSpanDays across cluster members. */
  timestamp?: string
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
  /** v0.5.1: factId extracted from provenance JSON or flat YAML frontmatter.
   *  Format: "memory://fact-session/{sessionId}". */
  factId?: string
}

export class EvidenceCollector {
  /**
   * Collect evidence for a single cluster.
   * For each member, aggregates governance signals from its memory metadata.
   *
   * @param factSummaries — v0.5.1: optional map of factId → FactSummary[]
   *   for enriching evidence with raw fact data.
   */
  collect(
    cluster: MemoryCluster,
    memories: MemoryFile[],
    factSummaries?: Map<string, FactSummary[]>,
  ): EvidenceReport {
    const memberMap = new Map(memories.map((m) => [m.filename, m]))
    const allFactIds = new Set<string>()

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
          sourceType: "unknown",
        }
      }

      const ts =
        mem.created ?? extractTimestamp(mem.provenance)
      const sourceType = extractSourceType(mem.provenance)
      const factId = mem.factId ?? mem.provenance?.source?.factId

      // Collect fact IDs for cluster-level factEvidence
      if (factId) allFactIds.add(factId)

      // Count distinct sessions from factSummaries
      let factSessionCount = 0
      if (factId && factSummaries) {
        const summaries = factSummaries.get(factId)
        if (summaries) {
          factSessionCount = summaries.length
        }
      }

      return {
        filename,
        worthiness: mem.worthiness,
        confidence: extractConfidence(mem.provenance, mem.confidence),
        usage: 0, // v0.5.0: placeholder, populated in v0.5.2
        feedback: 0, // v0.5.0: placeholder, populated in v0.5.2
        temporal: temporalValidity(ts) * (sourceType === "user" ? 1.0 : 0.9),
        factId,
        factSessionCount: factSessionCount > 0 ? factSessionCount : undefined,
        sourceType,
      }
    })

    // Detect dominant member
    const dominant = this.detectDominant(members)

    // Compute cluster-level factEvidence
    let factEvidence: EvidenceReport["factEvidence"] = undefined
    if (allFactIds.size > 0 && factSummaries) {
      const allSessions: FactSummary[] = []
      for (const fid of allFactIds) {
        const summaries = factSummaries.get(fid)
        if (summaries) allSessions.push(...summaries)
      }

      // Deduplicate by sessionId
      const seenSessions = new Set<string>()
      const uniqueSessions = allSessions.filter((s) => {
        if (seenSessions.has(s.sessionId)) return false
        seenSessions.add(s.sessionId)
        return true
      })

      // Compute time span from fact record timestamps
      let sessionSpanDays = 0
      const timestamps = uniqueSessions
        .map((s) => s.timestamp ? new Date(s.timestamp).getTime() : 0)
        .filter((t) => t > 0)
      if (timestamps.length >= 2) {
        const min = Math.min(...timestamps)
        const max = Math.max(...timestamps)
        sessionSpanDays = Math.round((max - min) / (24 * 60 * 60 * 1000))
      }
      // Check if any member has direct user input (sourceType === "user")
      const hasDirectUserInput = members.some((m) => m.sourceType === "user")

      factEvidence = {
        totalSessions: uniqueSessions.length,
        sessionSpanDays,
        hasDirectUserInput,
      }
    }

    return {
      clusterId: cluster.id,
      members,
      dominant,
      factEvidence,
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