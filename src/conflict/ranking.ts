/**
 * opencode-memory — Conflict Ranking Adapter (v0.4.2)
 *
 * Ranks conflicting memories by trustworthiness. Does NOT compute a new
 * score — only consumes and sorts existing scores from v0.4.1.
 *
 * Priority order:
 * 1. Source type: user > extraction
 * 2. ProvenanceConfidence (gap > 0.1)
 * 3. LifecycleValidity (gap > 0.1)
 * 4. WorthinessScore (gap > 0.05)
 * 5. Timestamp: newer > older
 *
 * See: docs/superpowers/specs/v0.4.2/04-resolution-engine.md
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConflictRankingInput {
  provenanceConfidence: number
  lifecycleValidity: number
  worthinessScore: number
  timestamp: number
  sourceType: string
  label: string
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Rank conflicting memories by trustworthiness.
 * Returns a new sorted array (does not mutate input).
 */
export function rankCandidates(memories: ConflictRankingInput[]): ConflictRankingInput[] {
  return [...memories].sort((a, b) => {
    // 1. Source type: user overrides everything
    if (a.sourceType === "user" && b.sourceType !== "user") return -1
    if (b.sourceType === "user" && a.sourceType !== "user") return 1

    // 2. Provenance confidence
    if (Math.abs(a.provenanceConfidence - b.provenanceConfidence) > 0.1) {
      return b.provenanceConfidence - a.provenanceConfidence
    }

    // 3. Lifecycle validity
    if (Math.abs(a.lifecycleValidity - b.lifecycleValidity) > 0.1) {
      return b.lifecycleValidity - a.lifecycleValidity
    }

    // 4. Worthiness score
    if (Math.abs(a.worthinessScore - b.worthinessScore) > 0.05) {
      return b.worthinessScore - a.worthinessScore
    }

    // 5. Newer timestamp
    return b.timestamp - a.timestamp
  })
}

/**
 * Get the best candidate from a ranked list.
 */
export function getBestCandidate(memories: ConflictRankingInput[]): ConflictRankingInput | undefined {
  if (memories.length === 0) return undefined
  return rankCandidates(memories)[0]
}