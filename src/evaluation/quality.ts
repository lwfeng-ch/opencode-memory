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

import { shouldMerge } from "./fingerprint.js"

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
 * Uses shouldMerge() (TF-IDF Jaccard > 0.8) to detect semantic duplicates.
 * Returns 0-100 score (100 = no duplicates, lower = more duplicates).
 */
export function checkConsistency(memories: QualityMemory[]): number {
  if (memories.length < 2) return 100
  let duplicatePairs = 0
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      if (shouldMerge(memories[i].content, memories[j].content)) {
        duplicatePairs++
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
