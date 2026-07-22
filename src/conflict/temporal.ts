/**
 * opencode-memory — Temporal Ranking (v0.4.3)
 *
 * Temporal validity computation for conflict ranking. Replaces the
 * hard `user > extraction` priority with a combination of source trust
 * and temporal decay, classified by memory type.
 *
 * See: docs/superpowers/specs/v0.4.3/03-temporal-ranking.md
 */

// ---------------------------------------------------------------------------
// TemporalClass
// ---------------------------------------------------------------------------

export type TemporalClass = "preference" | "fact" | "workflow" | "session"

export const TEMPORAL_DECAY: Record<TemporalClass, { fast: number; medium: number; slow: number }> = {
  preference: { fast: 180, medium: 365, slow: 730 },  // 慢衰减
  fact:       { fast: 90,  medium: 180, slow: 365 },   // 中衰减
  workflow:   { fast: 30,  medium: 90,  slow: 180 },   // 快衰减
  session:    { fast: 7,   medium: 30,  slow: 90 },    // 极快衰减
}

// ---------------------------------------------------------------------------
// Temporal Validity
// ---------------------------------------------------------------------------

/**
 * Compute temporal validity score based on memory age and type.
 * Defaults to "fact" if no temporal class is specified.
 */
export function temporalValidity(
  timestamp: number,
  temporalClass?: TemporalClass,
): number {
  const effectiveClass = temporalClass ?? "fact"
  const now = Date.now()
  const ageDays = (now - timestamp) / (24 * 60 * 60 * 1000)
  const decay = TEMPORAL_DECAY[effectiveClass]

  if (ageDays < decay.fast) return 1.0
  if (ageDays < decay.medium) return 0.8
  if (ageDays < decay.slow) return 0.5
  return 0.3
}

// ---------------------------------------------------------------------------
// Adjusted Source Trust
// ---------------------------------------------------------------------------

/**
 * Compute source trust adjusted by temporal validity.
 * Old user claims are discounted; recent extraction claims are boosted.
 */
export function adjustedSourceTrust(
  sourceType: string,
  temporalScore: number,
): number {
  const base =
    sourceType === "user" ? 1.0
    : sourceType === "feedback" ? 1.0
    : sourceType === "extraction" ? 0.8
    : sourceType === "session" ? 0.6
    : sourceType === "migration" ? 0.4
    : 0.5

  // 旧 user 声明降权
  if (sourceType === "user" && temporalScore < 0.5) return base * 0.8
  // 近期 extraction 提权
  if (sourceType === "extraction" && temporalScore >= 0.8) return base * 1.1

  return base
}

// ---------------------------------------------------------------------------
// Updated ConflictRankingInput
// ---------------------------------------------------------------------------

export interface ConflictRankingInput {
  provenanceConfidence: number
  lifecycleValidity: number
  worthinessScore: number
  timestamp: number
  sourceType: string
  temporalScore: number
  temporalClass?: TemporalClass
  label: string
}

/**
 * Rank candidates using combined source trust + temporal validity.
 * Replaces the hard user > extraction priority.
 */
export function rankCandidates(memories: ConflictRankingInput[]): ConflictRankingInput[] {
  return [...memories].sort((a, b) => {
    // 1. Combined source + temporal score
    const trustA = adjustedSourceTrust(a.sourceType, a.temporalScore)
    const trustB = adjustedSourceTrust(b.sourceType, b.temporalScore)
    if (Math.abs(trustA - trustB) > 0.15) {
      return trustB - trustA
    }

    // 2. Provenance confidence
    if (Math.abs(a.provenanceConfidence - b.provenanceConfidence) > 0.1) {
      return b.provenanceConfidence - a.provenanceConfidence
    }

    // 3. Worthiness score
    if (Math.abs(a.worthinessScore - b.worthinessScore) > 0.05) {
      return b.worthinessScore - a.worthinessScore
    }

    // 4. Newer timestamp
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