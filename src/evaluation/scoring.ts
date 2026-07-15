/**
 * opencode-memory — Memory Scoring (extracted from recall.ts)
 *
 * Keyword-matching score for memory relevance.
 * Used by recall's Stage 1 rule filter, Audit's StalenessAnalyzer,
 * and Benchmark's Recall Suite.
 *
 * Dependency direction: evaluation → runtime (recall imports this, not reverse)
 */

import type { MemoryHeader } from "../config.js"
import { memoryAgeDays } from "../staleness.js"

/**
 * Type-keyword map for the type bonus in Stage 1 scoring.
 * Each entry maps a set of trigger words to a memory type.
 */
const TYPE_KEYWORDS: Array<{ words: string[]; type: string }> = [
  { words: ["user", "role"], type: "user" },
  { words: ["feedback", "correct", "stop"], type: "feedback" },
  { words: ["project", "deadline"], type: "project" },
  { words: ["reference", "url", "link"], type: "reference" },
]

/**
 * Score a memory header against the query.
 *
 * Three additive components:
 *   1. Keyword overlap — count of query words (>2 chars) that appear in
 *      the header's description or filename (case-insensitive)
 *   2. Type bonus — +2 when query contains type-related trigger words
 *      matching the memory's type
 *   3. Recency bonus — max(0, 3 - floor(ageDays / 7)), decays over 3 weeks
 *
 * Freshness bonus is protected by `keywordScore > 0 || typeBonus > 0` —
 * no keyword match = no recency boost (prevents flooding with unrelated new files).
 */
export function scoreMemory(query: string, header: MemoryHeader): number {
  const queryLower = query.toLowerCase()

  // --- Keyword overlap ---
  const queryWords = queryLower
    .split(/\s+/)
    .filter((w) => w.length > 2)
  const descriptionLower = header.description?.toLowerCase() ?? ""
  const filenameLower = header.filename.toLowerCase()

  let keywordScore = 0
  for (const word of queryWords) {
    if (descriptionLower.includes(word) || filenameLower.includes(word)) {
      keywordScore++
    }
  }

  // --- Type bonus ---
  let typeBonus = 0
  if (header.type !== undefined) {
    for (const entry of TYPE_KEYWORDS) {
      if (entry.type === header.type && entry.words.some((w) => queryLower.includes(w))) {
        typeBonus += 2
      }
    }
  }

  // --- Recency bonus — only applies when there's at least some keyword/type relevance ---
  let recencyBonus = 0
  if (keywordScore > 0 || typeBonus > 0) {
    const ageDays = memoryAgeDays(header.mtimeMs)
    recencyBonus = Math.max(0, 3 - Math.floor(ageDays / 7))
  }

  return keywordScore + typeBonus + recencyBonus
}

/**
 * Score an array of memory headers against a query.
 * Returns array of { header, score } sorted by score descending.
 */
export function scoreMemories(
  query: string,
  headers: MemoryHeader[],
): Array<{ header: MemoryHeader; score: number }> {
  return headers
    .map((header) => ({ header, score: scoreMemory(query, header) }))
    .sort((a, b) => b.score - a.score)
}
