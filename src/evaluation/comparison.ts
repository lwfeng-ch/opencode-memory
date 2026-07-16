/**
 * opencode-memory — Semantic Comparator
 *
 * v0.3.0: SemanticComparator<T> interface, TokenJaccardComparator, ArrayOverlapComparator
 * v0.3.1: DefaultMemoryComparator — 3-layer text comparison + field-weighted memory comparison
 *
 * Three-layer algorithm for compareText:
 *   Layer 1 (20%): Token Jaccard — word-level set overlap (CJK bigram tokens)
 *   Layer 2 (50%): TF-IDF keyword Jaccard — weighted keyword set overlap
 *   Layer 3 (30%): Character bigram Jaccard — fine-grained substring overlap
 *
 * Field-weighted algorithm for compareMemory:
 *   content (50%), description (20%), type (20%), name (10%)
 */

import type { EvaluationResult } from "./types.js"
import { jaccardSimilarity } from "./fingerprint.js"

// ---------------------------------------------------------------------------
// v0.3.0: Existing SemanticComparator<T> interface + implementations
// ---------------------------------------------------------------------------

/**
 * Generic semantic comparator interface.
 * Used by benchmark/executor/golden.ts to compare
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

// ---------------------------------------------------------------------------
// v0.3.1: Enhanced comparison types + DefaultMemoryComparator
// ---------------------------------------------------------------------------

/** A memory object with comparable fields. */
export interface ComparableMemory {
  name?: string
  description?: string
  content: string
  type?: string
}

/** Result of comparing two memory objects. */
export interface ComparisonResult {
  /** Overall similarity score 0.0–1.0 */
  score: number
  /** Per-field similarity scores */
  fields: {
    content: number
    name: number
    description: number
    type: number
  }
  /** Whether score >= threshold (default 0.8) */
  passed: boolean
}

/** Interface for the enhanced v0.3.1 comparator. */
export interface MemoryComparator {
  compareText(a: string, b: string): number
  compareMemory(expected: ComparableMemory, actual: ComparableMemory): ComparisonResult
}

// ---------------------------------------------------------------------------
// Tokenization helpers (CJK-aware)
// ---------------------------------------------------------------------------

const PUNCT_SPLIT = /[\s,.!?,;:。，！？、；：·\-_\/\\()（）\[\]"'`]+/
const CJK_RANGE = /[\u4e00-\u9fff]/

/**
 * Tokenize text into a set of tokens.
 * English: word-level (split by whitespace/punctuation).
 * CJK: 2-character bigrams + whole chunks.
 */
function tokenize(text: string): Set<string> {
  const lower = text.toLowerCase()
  const chunks = lower.split(PUNCT_SPLIT).filter((w) => w.length > 0)
  const tokens = new Set<string>()

  for (const chunk of chunks) {
    if (CJK_RANGE.test(chunk)) {
      // CJK chunk: add 2-char bigrams + whole chunk
      for (let i = 0; i < chunk.length - 1; i++) {
        tokens.add(chunk.substring(i, i + 2))
      }
      tokens.add(chunk)
    } else {
      tokens.add(chunk)
    }
  }
  return tokens
}

const COMPARATOR_STOP_WORDS = new Set([
  "the", "this", "that", "with", "from", "have", "will", "your", "been",
  "they", "were", "what", "when", "which", "into", "some", "them", "than",
  "only", "also", "then", "very", "just", "does", "here", "there",
  "about", "after", "before", "between", "through", "during",
  "user", "agent", "session", "memory", "file", "function",
  "is", "are", "was", "were", "a", "an", "the", "to", "of", "in", "for",
  "and", "or", "not", "but", "on", "at", "by", "it", "as",
])

/**
 * Extract TF-IDF-style keywords from text (CJK-aware).
 * English: words > 3 chars, not stop words.
 * CJK: 2-char bigrams.
 */
function extractKeywordsForComparison(text: string): Set<string> {
  const lower = text.toLowerCase()
  const chunks = lower.split(PUNCT_SPLIT).filter((w) => w.length > 0)
  const keywords = new Set<string>()

  for (const chunk of chunks) {
    if (CJK_RANGE.test(chunk)) {
      // CJK: extract 2-char bigrams as keywords
      for (let i = 0; i < chunk.length - 1; i++) {
        keywords.add(chunk.substring(i, i + 2))
      }
    } else if (chunk.length > 3 && !COMPARATOR_STOP_WORDS.has(chunk)) {
      keywords.add(chunk)
    }
  }
  return keywords
}

/**
 * Extract character-level bigrams from text.
 * Works for both English and CJK.
 */
function extractBigrams(text: string): Set<string> {
  const cleaned = text.toLowerCase().replace(PUNCT_SPLIT, "")
  const bigrams = new Set<string>()
  for (let i = 0; i < cleaned.length - 1; i++) {
    bigrams.add(cleaned.substring(i, i + 2))
  }
  return bigrams
}

// ---------------------------------------------------------------------------
// DefaultMemoryComparator — 3-layer text + field-weighted memory comparison
// ---------------------------------------------------------------------------

/**
 * Default implementation of MemoryComparator.
 *
 * compareText uses a 3-layer weighted algorithm:
 *   Layer 1 (20%): Token Jaccard — word/bigram-level set overlap
 *   Layer 2 (50%): TF-IDF keyword Jaccard — weighted keyword overlap
 *   Layer 3 (30%): Character bigram Jaccard — fine-grained substring overlap
 *
 * compareMemory applies compareText to each field with weights:
 *   content 50%, description 20%, type 20%, name 10%
 *
 * Pass threshold: 0.8 (configurable)
 */
export class DefaultMemoryComparator implements MemoryComparator {
  private readonly threshold: number

  constructor(threshold: number = 0.8) {
    this.threshold = threshold
  }

  compareText(a: string, b: string): number {
    // Edge cases
    if (!a && !b) return 0
    if (!a || !b) return 0
    if (a === b) return 1.0

    const lowerA = a.toLowerCase()
    const lowerB = b.toLowerCase()
    if (lowerA === lowerB) return 1.0

    // Layer 1: Token Jaccard (20%)
    const tokensA = tokenize(lowerA)
    const tokensB = tokenize(lowerB)
    const layer1 = jaccardSimilarity(tokensA, tokensB)

    // Layer 2: TF-IDF keyword Jaccard (50%)
    const keywordsA = extractKeywordsForComparison(lowerA)
    const keywordsB = extractKeywordsForComparison(lowerB)
    const layer2 = jaccardSimilarity(keywordsA, keywordsB)

    // Layer 3: Character bigram Jaccard (30%)
    const bigramsA = extractBigrams(lowerA)
    const bigramsB = extractBigrams(lowerB)
    const layer3 = jaccardSimilarity(bigramsA, bigramsB)

    return layer1 * 0.2 + layer2 * 0.5 + layer3 * 0.3
  }

  compareMemory(expected: ComparableMemory, actual: ComparableMemory): ComparisonResult {
    // Content: use compareText (highest weight)
    const contentScore = this.compareText(expected.content, actual.content)

    // Name: use compareText if both present, else direct match
    const nameScore = expected.name != null && actual.name != null
      ? this.compareText(expected.name, actual.name)
      : (expected.name === actual.name ? 1.0 : 0)

    // Description: use compareText if both present, else direct match
    const descriptionScore = expected.description != null && actual.description != null
      ? this.compareText(expected.description, actual.description)
      : (expected.description === actual.description ? 1.0 : 0)

    // Type: exact match only
    const typeScore = expected.type != null && actual.type != null
      ? (expected.type === actual.type ? 1.0 : 0)
      : (expected.type === actual.type ? 1.0 : 0)

    const fields = {
      content: contentScore,
      name: nameScore,
      description: descriptionScore,
      type: typeScore,
    }

    // Weighted: content 50%, description 20%, type 20%, name 10%
    // Round to 10 decimal places to avoid floating-point precision issues
    const rawScore = contentScore * 0.5 + descriptionScore * 0.2 + typeScore * 0.2 + nameScore * 0.1
    const score = Math.round(rawScore * 1e10) / 1e10

    return {
      score,
      fields,
      passed: score >= this.threshold,
    }
  }
}
