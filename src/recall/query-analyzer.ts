/**
 * opencode-memory — Query Intent Analyzer (v0.3.4 Phase 3)
 *
 * Rule-based query intent detection for historical recall expansion.
 * Determines whether a user query is asking about past/previous work
 * and should include archived memories.
 *
 * Deterministic only — no LLM calls. v0.5 may add a classifier.
 */

// ---------------------------------------------------------------------------
// Keywords that signal a historical query intent
// ---------------------------------------------------------------------------

const HISTORICAL_KEYWORDS = [
  // Chinese
  "以前", "之前", "上次", "曾经", "历史", "过去", "旧版本", "之前讨论",
  // English
  "previously", "before", "last time", "earlier", "past", "old version",
  "previous discussion", "previous", "prior", "formerly", "historical",
  // Mixed
  "之前我们", "以前我们", "之前讨论过", "以前讨论过",
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Determined recall scope based on query intent. */
export type RecallScope = 'active' | 'active+archived'

/** Result of query intent analysis. */
export interface QueryIntent {
  /** Whether the query signals a historical/previous reference. */
  scope: RecallScope
  /** The original query, unmodified. */
  query: string
  /** Which keyword(s) triggered the historical classification. */
  matchedKeywords: string[]
}

// ---------------------------------------------------------------------------
// QueryIntentAnalyzer
// ---------------------------------------------------------------------------

export class QueryIntentAnalyzer {
  /**
   * Analyze a user query and determine the recall scope.
   *
   * Rules:
   * - If the query contains any historical keyword → active+archived scope
   * - Otherwise → active-only scope (default)
   */
  analyze(query: string): QueryIntent {
    const queryLower = query.toLowerCase().trim()
    if (!queryLower) {
      return { scope: 'active', query, matchedKeywords: [] }
    }

    const matchedKeywords: string[] = []

    for (const keyword of HISTORICAL_KEYWORDS) {
      if (queryLower.includes(keyword)) {
        matchedKeywords.push(keyword)
      }
    }

    if (matchedKeywords.length > 0) {
      return { scope: 'active+archived', query, matchedKeywords }
    }

    return { scope: 'active', query, matchedKeywords: [] }
  }
}

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Quick check: does this query look historical?
 * Returns true if the query should include archived memories.
 */
export function isHistoricalQuery(query: string): boolean {
  const queryLower = query.toLowerCase().trim()
  if (!queryLower) return false
  return HISTORICAL_KEYWORDS.some(keyword => queryLower.includes(keyword))
}

/**
 * Get the archived multiplier based on recall scope.
 * active+archived: archived memories get 0.3x score
 * active: archived memories get 0x (excluded)
 */
export function archivedScoreMultiplier(scope: RecallScope): number {
  return scope === 'active+archived' ? 0.3 : 0
}