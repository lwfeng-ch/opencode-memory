/**
 * opencode-memory — Quality Dimension Analysis Functions (v0.3.1)
 *
 * Pure functions for each quality dimension:
 *   - checkCompleteness: frontmatter field coverage
 *   - checkConsistency:  duplicate detection (shouldMerge)
 *   - checkFreshness:    age + recall usage tracking
 *   - checkNoise:        placeholder/garbage/generic name detection
 *   - checkRetrievability: recall count distribution
 *
 * All functions are pure: no I/O, no side effects.
 * Called by quality-score.ts (DefaultMemoryQualityEvaluator).
 */

import { computeFingerprint, jaccardSimilarity } from "./fingerprint.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A memory object with all fields needed for quality scoring. */
export interface QualityMemory {
  filename: string
  content: string
  name?: string
  description?: string | null
  type?: string
  scope?: string
  confidence?: string
  recallCount: number
  lastRecalledAt: string | null
  mtimeMs: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000
const STALE_DAYS = 180

const GENERIC_NAMES = new Set([
  "Explicit Feedback",
  "Untitled",
  "Memory",
  "New Memory",
  "Unnamed",
  "",
])

const PLACEHOLDER_PATTERNS = [
  /^TODO:/i,
  /^PLACEHOLDER/i,
  /^fill in/i,
  /^test content/i,
  /^\s*$/,
]

// ---------------------------------------------------------------------------
// Dimension 1: Completeness (weight 20%)
// ---------------------------------------------------------------------------

/**
 * Check if all memories have complete frontmatter fields.
 * Required fields: name, description, type, scope, confidence.
 * Returns 0-100 score (percentage of complete memories).
 */
export function checkCompleteness(memories: QualityMemory[]): number {
  if (memories.length === 0) return 100
  let complete = 0
  for (const m of memories) {
    if (m.name && m.name.trim().length > 0 &&
        m.description && m.description.trim().length > 0 &&
        m.type && m.scope && m.confidence) {
      complete++
    }
  }
  return Math.round((complete / memories.length) * 100)
}

// ---------------------------------------------------------------------------
// Dimension 2: Consistency (weight 25%)
// ---------------------------------------------------------------------------

/**
 * Check for duplicate memories using semantic fingerprint.
 * Uses computeFingerprint() + jaccardSimilarity() >= 0.8 to detect semantic duplicates.
 *
 * Optimization: pre-compute fingerprints once (avoid re-parsing on every comparison),
 * then bucket by keyword count. Only memories in buckets where Jaccard >= 0.8 is
 * mathematically possible are compared.
 *
 * For sets A (size s) and B (size s+k), Jaccard = |A∩B| / |A∪B|.
 * Max Jaccard = s / (s+k) (when A ⊆ B). For this to be >= 0.8: k <= floor(s/4).
 * So for bucket size s, we check buckets in range [s - floor(s/4), s + floor(s/4)].
 * When s < 4, floor(s/4) = 0, so we check adjacent buckets too (k=1 still possible at s=4).
 * To be safe, minimum range is ±1.
 *
 * Returns 0-100 score (100 = no duplicates, lower = more duplicates).
 */
export function checkConsistency(memories: QualityMemory[]): number {
  if (memories.length < 2) return 100

  // Pre-compute fingerprints to avoid redundant parsing
  const fingerprints = memories.map((m) => ({
    fp: computeFingerprint(m.content),
    size: 0,
  }))
  for (const f of fingerprints) f.size = f.fp.size

  // Bucket by fingerprint size
  const buckets = new Map<number, number[]>()
  for (let i = 0; i < fingerprints.length; i++) {
    const sz = fingerprints[i].size
    if (!buckets.has(sz)) buckets.set(sz, [])
    buckets.get(sz)!.push(i)
  }

  let duplicatePairs = 0
  const compared = new Set<string>() // dedup pair counting

  const sortedSizes = [...buckets.keys()].sort((a, b) => a - b)
  for (let si = 0; si < sortedSizes.length; si++) {
    const sz = sortedSizes[si]
    const indices = buckets.get(sz)!

    // Calculate max size difference where Jaccard >= 0.8 is possible
    // k <= floor(s/4), but minimum range ±1 for small sets
    const maxK = Math.max(1, Math.floor(sz / 4))

    // Same bucket comparisons
    for (let bi = 0; bi < indices.length; bi++) {
      for (let bj = bi + 1; bj < indices.length; bj++) {
        if (jaccardSimilarity(fingerprints[indices[bi]].fp, fingerprints[indices[bj]].fp) >= 0.8) {
          duplicatePairs++
        }
      }
    }

    // Cross-bucket comparisons: check all buckets within [sz+1, sz+maxK]
    for (let sj = si + 1; sj < sortedSizes.length; sj++) {
      const nextSz = sortedSizes[sj]
      if (nextSz > sz + maxK) break // no more possible buckets
      const nextIndices = buckets.get(nextSz)!
      for (const i of indices) {
        for (const j of nextIndices) {
          const pairKey = i < j ? `${i}-${j}` : `${j}-${i}`
          if (compared.has(pairKey)) continue
          compared.add(pairKey)
          if (jaccardSimilarity(fingerprints[i].fp, fingerprints[j].fp) >= 0.8) {
            duplicatePairs++
          }
        }
      }
    }
  }

  const maxPairs = (memories.length * (memories.length - 1)) / 2
  const penalty = maxPairs > 0 ? (duplicatePairs / maxPairs) * 100 : 0
  return Math.max(0, Math.round(100 - penalty))
}

// ---------------------------------------------------------------------------
// Dimension 3: Freshness (weight 15%)
// ---------------------------------------------------------------------------

/**
 * Check memory freshness based on age, recall count, and confidence.
 * - Explicit memories are never stale (confidence = "explicit")
 * - Recent + recalled = fresh (1.0)
 * - Recent OR recalled = semi-fresh (0.5)
 * - Old + never recalled = stale (0.0)
 * Returns 0-100 score.
 */
export function checkFreshness(memories: QualityMemory[], now: number = Date.now()): number {
  if (memories.length === 0) return 100
  const staleMs = STALE_DAYS * DAY_MS
  let freshScore = 0

  for (const m of memories) {
    const ageMs = now - m.mtimeMs
    const isRecent = ageMs < staleMs
    const isRecalled = m.recallCount > 0
    const isExplicit = m.confidence === "explicit"

    if (isExplicit) {
      freshScore += 1.0
    } else if (isRecent && isRecalled) {
      freshScore += 1.0
    } else if (isRecent || isRecalled) {
      freshScore += 0.5
    }
    // else: stale + never recalled = 0
  }

  return Math.round((freshScore / memories.length) * 100)
}

// ---------------------------------------------------------------------------
// Dimension 4: Noise (weight 20%)
// ---------------------------------------------------------------------------

/**
 * Check for noise: placeholder content, generic names, empty/short bodies.
 * Returns 0-100 score (100 = no noise, lower = more noise).
 */
export function checkNoise(memories: QualityMemory[]): number {
  if (memories.length === 0) return 100
  let clean = 0

  for (const m of memories) {
    let isNoise = false

    // Check generic name
    if (m.name && GENERIC_NAMES.has(m.name)) {
      isNoise = true
    }

    // Check placeholder content
    if (PLACEHOLDER_PATTERNS.some((p) => p.test(m.content))) {
      isNoise = true
    }

    // Check very short content (< 10 chars after trim)
    if (m.content.trim().length < 10) {
      isNoise = true
    }

    if (!isNoise) clean++
  }

  return Math.round((clean / memories.length) * 100)
}

// ---------------------------------------------------------------------------
// Dimension 5: Retrievability (weight 20%)
// ---------------------------------------------------------------------------

/**
 * Check retrievability based on recall count distribution.
 * Memories with recallCount > 0 are "retrievable" (have been used).
 * Returns 0-100 score (percentage of recalled memories).
 */
export function checkRetrievability(memories: QualityMemory[]): number {
  if (memories.length === 0) return 100
  let recalled = 0
  for (const m of memories) {
    if (m.recallCount > 0) recalled++
  }
  return Math.round((recalled / memories.length) * 100)
}
