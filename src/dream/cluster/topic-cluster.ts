/**
 * opencode-memory — TopicClusterBuilder (v0.5.0)
 *
 * Groups memories by broad topic similarity using TF-IDF keyword extraction
 * and Jaccard similarity. Reuses evaluation/fingerprint.ts — no new algorithm.
 *
 * Topic clusters are "fuzzy" — they capture semantic relatedness, not exact
 * claim matches. This is the third level of the 3-level cluster hierarchy.
 *
 * Threshold: Jaccard similarity >= 0.4 → same topic (v0.5.0 hardcoded)
 */

import { computeFingerprint, jaccardSimilarity } from "../../evaluation/fingerprint.js"
import { generateClusterId, type MemoryCluster } from "./types.js"

export interface TopicClusterInput {
  filename: string
  content: string
}

export class TopicClusterBuilder {
  private threshold: number

  constructor(threshold: number = 0.3) {
    this.threshold = threshold
  }

  /**
   * Build topic-level clusters from memory files.
   * Uses pairwise Jaccard similarity on TF-IDF keyword fingerprints.
   * Only groups with >= 2 members become clusters.
   */
  build(memories: TopicClusterInput[]): MemoryCluster[] {
    if (memories.length < 2) return []

    // Pre-compute fingerprints
    const fingerprints = memories.map((m) => ({
      filename: m.filename,
      fp: computeFingerprint(m.content),
    }))

    // Build adjacency: pairwise Jaccard >= threshold
    const adjacency = new Map<string, Set<string>>()
    for (const f of fingerprints) {
      adjacency.set(f.filename, new Set<string>())
    }

    for (let i = 0; i < fingerprints.length; i++) {
      for (let j = i + 1; j < fingerprints.length; j++) {
        const sim = jaccardSimilarity(fingerprints[i].fp, fingerprints[j].fp)
        if (sim >= this.threshold) {
          adjacency.get(fingerprints[i].filename)!.add(fingerprints[j].filename)
          adjacency.get(fingerprints[j].filename)!.add(fingerprints[i].filename)
        }
      }
    }

    // Find connected components (BFS)
    const visited = new Set<string>()
    const clusters: MemoryCluster[] = []

    for (const f of fingerprints) {
      if (visited.has(f.filename)) continue

      // BFS
      const component: string[] = []
      const queue = [f.filename]
      visited.add(f.filename)

      while (queue.length > 0) {
        const current = queue.shift()!
        component.push(current)

        const neighbors = adjacency.get(current) ?? new Set()
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor)
            queue.push(neighbor)
          }
        }
      }

      // Only output clusters with >= 2 members
      if (component.length >= 2) {
        // Compute average similarity as confidence
        let totalSim = 0
        let pairCount = 0
        for (let i = 0; i < component.length; i++) {
          for (let j = i + 1; j < component.length; j++) {
            const fpi = fingerprints.find((f) => f.filename === component[i])!.fp
            const fpj = fingerprints.find((f) => f.filename === component[j])!.fp
            totalSim += jaccardSimilarity(fpi, fpj)
            pairCount++
          }
        }
        const avgSim = pairCount > 0 ? totalSim / pairCount : 0

        // Extract common keywords for topic
        const allKeywords = new Map<string, number>()
        for (const fname of component) {
          const fp = fingerprints.find((f) => f.filename === fname)!.fp
          for (const kw of fp) {
            allKeywords.set(kw, (allKeywords.get(kw) ?? 0) + 1)
          }
        }
        const commonKeywords = Array.from(allKeywords.entries())
          .filter(([, count]) => count >= 2)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([kw]) => kw)

        clusters.push({
          id: generateClusterId("topic"),
          level: "topic",
          members: component.sort(),
          confidence: Math.round(avgSim * 100) / 100,
          metadata: {
            similarity: Math.round(avgSim * 100) / 100,
            keywords: commonKeywords,
            memberCount: component.length,
            threshold: this.threshold,
          },
        })
      }
    }

    return clusters.sort((a, b) => b.confidence - a.confidence)
  }
}