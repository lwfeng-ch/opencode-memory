/**
 * opencode-memory — Semantic Comparator
 *
 * Generic comparator for Golden file comparison (v0.3.1).
 * v0.3.0: TokenJaccardComparator (literal token overlap, no external API)
 * v0.3.1: EmbeddingComparator (vector similarity via API) — placeholder
 */

import type { EvaluationResult } from "./types.js"

/**
 * Generic semantic comparator interface.
 * Used by benchmark/executor/golden.ts (v0.3.1) to compare
 * expected vs actual LLM outputs.
 */
export interface SemanticComparator<T = unknown> {
  compare(expected: T, actual: T): EvaluationResult
}

/**
 * Token-level Jaccard comparator.
 * Splits strings into token sets and computes Jaccard similarity.
 * No external API needed — works fully offline.
 */
export class TokenJaccardComparator implements SemanticComparator<string> {
  compare(expected: string, actual: string): EvaluationResult {
    const expectedTokens = new Set(expected.toLowerCase().split(/\s+/).filter((t) => t.length > 0))
    const actualTokens = new Set(actual.toLowerCase().split(/\s+/).filter((t) => t.length > 0))

    const intersection = [...expectedTokens].filter((t) => actualTokens.has(t))
    const union = new Set([...expectedTokens, ...actualTokens])

    const score = union.size > 0 ? intersection.length / union.size : 0

    return {
      score,
      details: {
        hit: intersection,
        miss: [...expectedTokens].filter((t) => !actualTokens.has(t)),
      },
    }
  }
}

/**
 * Array comparator — compares two arrays for set overlap.
 * Useful for Recall@K comparison where expected/actual are filename arrays.
 */
export class ArrayOverlapComparator<T> implements SemanticComparator<T[]> {
  compare(expected: T[], actual: T[]): EvaluationResult {
    const expectedSet = new Set(expected)
    const actualSet = new Set(actual)

    const hit = [...expectedSet].filter((e) => actualSet.has(e))
    const miss = [...expectedSet].filter((e) => !actualSet.has(e))

    const score = expectedSet.size > 0 ? hit.length / expectedSet.size : 0

    return {
      score,
      details: { hit, miss },
    }
  }
}
