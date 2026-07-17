/**
 * opencode-memory — Semantic Comparator
 *
 * v0.3.0: SemanticComparator<T> interface, TokenJaccardComparator, ArrayOverlapComparator
 * v0.3.1: DefaultMemoryComparator — 3-layer text comparison + field-weighted memory comparison
 * v0.3.2: HybridComparator — 4-layer (3-layer + Embedding 35%) with fallback to 3-layer
 *
 * Hybrid-4Layer algorithm for compareText (when embedding available):
 *   Layer 1 (15%): Token Jaccard — word-level set overlap (CJK bigram tokens)
 *   Layer 2 (35%): TF-IDF keyword Jaccard — weighted keyword set overlap
 *   Layer 3 (15%): Character bigram Jaccard — fine-grained substring overlap
 *   Layer 4 (35%): Embedding cosine similarity — semantic equivalence
 *
 * Legacy-3Layer algorithm (embedding unavailable or failed):
 *   Layer 1 (20%): Token Jaccard
 *   Layer 2 (50%): TF-IDF keyword Jaccard
 *   Layer 3 (30%): Character bigram Jaccard
 *
 * Field-weighted algorithm for compareMemory:
 *   content (50%), description (20%), type (20%), name (10%)
 *   content uses compareText (contains embedding signal)
 *   type uses exact match (1 or 0)
 *   name, description use lexical 3-layer only
 */

import type { EvaluationResult } from "./types.js"
import { jaccardSimilarity } from "./fingerprint.js"
import type { EmbeddingProvider } from "../llm/provider.js"

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
// v0.3.2: TextComparisonResult — per-layer breakdown for explainability
// ---------------------------------------------------------------------------

/** Per-layer breakdown of text comparison. */
export interface TextComparisonResult {
  /** Weighted final score (0-1) */
  score: number
  /** Per-layer scores for explainability */
  breakdown: {
    tokenJaccard: number
    tfidf: number
    bigram: number
    /** Present only if embedding was used (hybrid-4layer mode) */
    embedding?: number
  }
}

// ---------------------------------------------------------------------------
// v0.3.1+ Enhanced comparison types
// ---------------------------------------------------------------------------

/** A memory object with comparable fields. */
export interface ComparableMemory {
  name?: string
  description?: string
  content: string
  type?: string
  /** Optional metadata — NOT used in score calculation (v0.3.2) */
  metadata?: {
    scope?: string
    confidence?: string
    source?: string
  }
}

/** Result of comparing two memory objects. */
export interface ComparisonResult {
  /** Overall similarity score 0.0–1.0 */
  score: number
  /** Per-field results */
  fields: {
    /** Content uses TextComparisonResult (contains embedding breakdown) */
    content: TextComparisonResult
    /** Name uses lexical score only */
    name: number
    /** Description uses lexical score only */
    description: number
    /** Type uses exact match (1 or 0) */
    type: number
  }
  /** Whether score >= threshold */
  passed: boolean
  /** Comparator mode used for this comparison */
  mode: "hybrid-4layer" | "legacy-3layer"
}

/** Interface for the enhanced comparator (v0.3.2: async for embedding support). */
export interface MemoryComparator {
  /** Compare two text strings. Returns breakdown. */
  compareText(a: string, b: string): Promise<TextComparisonResult>
  /** Compare two memory objects. Field-weighted. */
  compareMemory(expected: ComparableMemory, actual: ComparableMemory): Promise<ComparisonResult>
}

// ---------------------------------------------------------------------------
// Tokenization helpers (CJK-aware) — unchanged from v0.3.1
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
// v0.3.2: cosineSimilarity — pure function for embedding comparison
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two equal-length vectors. Returns 0-1.
 * @throws Error if dimensions mismatch
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`)
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0
  return dot / denom
}

// ---------------------------------------------------------------------------
// DefaultMemoryComparator — Hybrid-4Layer (v0.3.2) + fallback to 3-layer
// ---------------------------------------------------------------------------

/**
 * Default implementation of MemoryComparator (v0.3.2: Hybrid-4Layer).
 *
 * compareText uses a 3-layer or 4-layer weighted algorithm:
 *   - 4-layer (embedding available): Token 15% + TF-IDF 35% + Bigram 15% + Embedding 35%
 *   - 3-layer (fallback):             Token 20% + TF-IDF 50% + Bigram 30%
 *
 * compareMemory applies field-weighted comparison:
 *   content (50%, uses compareText), type (20%, exact match),
 *   description (20%, lexical), name (10%, lexical)
 *
 * Embedding fallback: if EmbeddingProvider throws, falls back to 3-layer.
 * Telemetry: embedding failures should be logged (caller responsibility).
 *
 * @param thresholdOrOpts - number for backward compat (v0.3.1 style),
 *                          or { embeddingProvider?, threshold? } for v0.3.2
 */
export class DefaultMemoryComparator implements MemoryComparator {
  private readonly threshold: number
  private readonly embeddingProvider?: EmbeddingProvider

  // Weight configurations (reported in comparator metadata)
  static readonly HYBRID_WEIGHTS = {
    tokenJaccard: 0.15,
    tfidf: 0.35,
    bigram: 0.15,
    embedding: 0.35,
  }
  static readonly LEGACY_WEIGHTS = {
    tokenJaccard: 0.20,
    tfidf: 0.50,
    bigram: 0.30,
  }
  static readonly FIELD_WEIGHTS = {
    content: 0.50,
    description: 0.20,
    type: 0.20,
    name: 0.10,
  }

  constructor(
    thresholdOrOpts?: number | { embeddingProvider?: EmbeddingProvider; threshold?: number },
  ) {
    if (typeof thresholdOrOpts === "number") {
      this.threshold = thresholdOrOpts
    } else if (thresholdOrOpts && typeof thresholdOrOpts === "object") {
      this.threshold = thresholdOrOpts.threshold ?? 0.8
      this.embeddingProvider = thresholdOrOpts.embeddingProvider
    } else {
      this.threshold = 0.8
    }
  }

  async compareText(a: string, b: string): Promise<TextComparisonResult> {
    // Edge cases
    if (!a && !b) return { score: 0, breakdown: { tokenJaccard: 0, tfidf: 0, bigram: 0 } }
    if (!a || !b) return { score: 0, breakdown: { tokenJaccard: 0, tfidf: 0, bigram: 0 } }
    if (a === b) {
      return {
        score: 1.0,
        breakdown: this.embeddingProvider
          ? { tokenJaccard: 1, tfidf: 1, bigram: 1, embedding: 1 }
          : { tokenJaccard: 1, tfidf: 1, bigram: 1 },
      }
    }

    const lowerA = a.toLowerCase()
    const lowerB = b.toLowerCase()
    if (lowerA === lowerB) {
      return {
        score: 1.0,
        breakdown: this.embeddingProvider
          ? { tokenJaccard: 1, tfidf: 1, bigram: 1, embedding: 1 }
          : { tokenJaccard: 1, tfidf: 1, bigram: 1 },
      }
    }

    // 3-layer lexical (always succeeds, synchronous computation)
    const tokenJaccard = this.computeTokenJaccard(lowerA, lowerB)
    const tfidf = this.computeTfidfJaccard(lowerA, lowerB)
    const bigram = this.computeBigramJaccard(lowerA, lowerB)

    const lw = DefaultMemoryComparator.LEGACY_WEIGHTS
    const lexicalScore =
      tokenJaccard * lw.tokenJaccard +
      tfidf * lw.tfidf +
      bigram * lw.bigram

    // Embedding (optional, may fail)
    if (this.embeddingProvider) {
      try {
        const [embA, embB] = await this.embeddingProvider.embed([a, b])
        const embeddingScore = cosineSimilarity(embA, embB)

        // Recompute with hybrid weights
        const hw = DefaultMemoryComparator.HYBRID_WEIGHTS
        const hybridScore =
          tokenJaccard * hw.tokenJaccard +
          tfidf * hw.tfidf +
          bigram * hw.bigram +
          embeddingScore * hw.embedding

        return {
          score: hybridScore,
          breakdown: { tokenJaccard, tfidf, bigram, embedding: embeddingScore },
        }
      } catch {
        // Embedding failed — fallback to 3-layer
        // Caller should emit telemetry { event: "embedding_failed", ... }
      }
    }

    // Fallback: 3-layer only
    return {
      score: lexicalScore,
      breakdown: { tokenJaccard, tfidf, bigram },
    }
  }

  async compareMemory(
    expected: ComparableMemory,
    actual: ComparableMemory,
  ): Promise<ComparisonResult> {
    // Content: use compareText (highest weight, contains embedding signal)
    const contentResult = await this.compareText(expected.content, actual.content)

    // Name: lexical 3-layer (no embedding — too short for embedding to help)
    const nameScore = expected.name != null && actual.name != null
      ? this.lexical3Layer(expected.name, actual.name)
      : (expected.name === actual.name ? 1.0 : 0)

    // Description: lexical 3-layer
    const descriptionScore = expected.description != null && actual.description != null
      ? this.lexical3Layer(expected.description, actual.description)
      : (expected.description === actual.description ? 1.0 : 0)

    // Type: exact match only
    const typeScore = expected.type != null && actual.type != null
      ? (expected.type === actual.type ? 1.0 : 0)
      : (expected.type === actual.type ? 1.0 : 0)

    const fields = {
      content: contentResult,
      name: nameScore,
      description: descriptionScore,
      type: typeScore,
    }

    // Weighted: content 50%, description 20%, type 20%, name 10%
    const w = DefaultMemoryComparator.FIELD_WEIGHTS
    const rawScore =
      contentResult.score * w.content +
      descriptionScore * w.description +
      typeScore * w.type +
      nameScore * w.name
    const score = Math.round(rawScore * 1e10) / 1e10

    const mode = contentResult.breakdown.embedding !== undefined
      ? "hybrid-4layer"
      : "legacy-3layer"

    return {
      score,
      fields,
      passed: score >= this.threshold,
      mode,
    }
  }

  // --- Private helpers ---

  private computeTokenJaccard(a: string, b: string): number {
    return jaccardSimilarity(tokenize(a), tokenize(b))
  }

  private computeTfidfJaccard(a: string, b: string): number {
    return jaccardSimilarity(extractKeywordsForComparison(a), extractKeywordsForComparison(b))
  }

  private computeBigramJaccard(a: string, b: string): number {
    return jaccardSimilarity(extractBigrams(a), extractBigrams(b))
  }

  /** Lexical 3-layer (synchronous, used for short fields like name/description). */
  private lexical3Layer(a: string, b: string): number {
    if (!a && !b) return 0
    if (!a || !b) return 0
    if (a === b) return 1.0

    const lowerA = a.toLowerCase()
    const lowerB = b.toLowerCase()
    if (lowerA === lowerB) return 1.0

    const tokenJaccard = this.computeTokenJaccard(lowerA, lowerB)
    const tfidf = this.computeTfidfJaccard(lowerA, lowerB)
    const bigram = this.computeBigramJaccard(lowerA, lowerB)

    const lw = DefaultMemoryComparator.LEGACY_WEIGHTS
    return tokenJaccard * lw.tokenJaccard + tfidf * lw.tfidf + bigram * lw.bigram
  }
}
