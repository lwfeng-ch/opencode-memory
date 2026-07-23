/**
 * opencode-memory — MemoryCluster Types (v0.5.0)
 *
 * Three-level cluster model:
 * 1. "topic" — broad keyword similarity (TF-IDF + Jaccard)
 * 2. "claim" — exact subject/predicate match (from ClaimExtractor)
 * 3. "conflict" — direct consumer of ConflictGraph components
 */

export type ClusterLevel = "topic" | "claim" | "conflict"

export interface MemoryCluster {
  id: string
  level: ClusterLevel
  members: string[]
  confidence: number
  metadata: Record<string, unknown>
}

let clusterCounter = 0

export function generateClusterId(level: ClusterLevel): string {
  clusterCounter++
  return `${level}-${Date.now().toString(36)}-${clusterCounter.toString(36)}`
}