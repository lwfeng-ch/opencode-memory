/**
 * opencode-memory — ClaimClusterBuilder (v0.5.0)
 *
 * Groups memories by exact (subject, predicate) claim pairs.
 * Uses ClaimExtractor from v0.4.2 — no re-detection, no LLM.
 *
 * Example: "user:preference" with values ["vscode", "cursor"] → 1 ClaimCluster
 */

import { ClaimExtractor } from "../../conflict/claim-extractor.js"
import type { MemoryClaim } from "../../conflict/types.js"
import { generateClusterId, type MemoryCluster } from "./types.js"

export interface ClaimClusterInput {
  filename: string
  content: string
}

export class ClaimClusterBuilder {
  private extractor: ClaimExtractor

  constructor() {
    this.extractor = new ClaimExtractor()
  }

  /**
   * Build claim-level clusters from memory files.
   * Extracts claims from each file, then groups by (subject, predicate).
   * Only groups with >= 2 members become clusters.
   */
  build(memories: ClaimClusterInput[]): MemoryCluster[] {
    if (memories.length < 2) return []

    // Extract claims per file
    const fileClaims = new Map<string, MemoryClaim[]>()
    for (const mem of memories) {
      const claims = this.extractor.extractClaims(mem.content, mem.filename)
      if (claims.length > 0) {
        fileClaims.set(mem.filename, claims)
      }
    }

    // Group by (subject, predicate) → set of unique filenames
    const claimGroups = new Map<string, Set<string>>()
    for (const [filename, claims] of fileClaims) {
      for (const claim of claims) {
        const key = `${claim.subject}:${claim.predicate}`
        const existing = claimGroups.get(key) ?? new Set<string>()
        existing.add(filename)
        claimGroups.set(key, existing)
      }
    }

    // Build clusters (only groups with >= 2 members)
    const clusters: MemoryCluster[] = []
    for (const [claimKey, filenames] of claimGroups) {
      if (filenames.size < 2) continue

      const [subject, predicate] = claimKey.split(":")
      const members = Array.from(filenames).sort()

      // Collect distinct values for metadata
      const values = new Set<string>()
      for (const filename of members) {
        const claims = fileClaims.get(filename) ?? []
        for (const c of claims) {
          if (c.subject === subject && c.predicate === predicate) {
            values.add(c.value)
          }
        }
      }

      clusters.push({
        id: generateClusterId("claim"),
        level: "claim",
        members,
        confidence: 0.8,
        metadata: {
          subject,
          predicate,
          values: Array.from(values),
          claimKey,
        },
      })
    }

    return clusters
  }
}