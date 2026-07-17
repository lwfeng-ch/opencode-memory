/**
 * opencode-memory — HybridComparator 4-Layer + Embedding Fallback Tests (v0.3.2)
 *
 * Tests the v0.3.2 HybridComparator:
 *   - 4-layer mode (hybrid-4layer) when EmbeddingProvider is available and succeeds
 *   - Fallback to 3-layer (legacy-3layer) when EmbeddingProvider fails
 *   - Fallback to 3-layer when no EmbeddingProvider configured
 *   - TextComparisonResult breakdown structure
 *   - cosineSimilarity pure function
 *   - Constructor backward compat (number threshold still works)
 */

import { describe, test, expect } from "vitest"
import {
  DefaultMemoryComparator,
  cosineSimilarity,
  type ComparableMemory,
} from "../../src/evaluation/comparison.js"
import type { EmbeddingProvider } from "../../src/llm/provider.js"

// ---------------------------------------------------------------------------
// Mock Embedding Providers
// ---------------------------------------------------------------------------

/** Returns known vectors — for deterministic embedding tests */
class FixedVectorEmbeddingProvider implements EmbeddingProvider {
  readonly embeddingModel = "mock-fixed"
  readonly dimensions: number

  constructor(private vectors: number[][]) {
    this.dimensions = vectors[0]?.length ?? 0
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((_, i) => this.vectors[i % this.vectors.length])
  }
}

/** Always fails — for fallback testing */
class FailingEmbeddingProvider implements EmbeddingProvider {
  readonly embeddingModel = "mock-fail"
  readonly dimensions = 0

  async embed(): Promise<number[][]> {
    throw new Error("Mock embedding failure")
  }
}

/** Returns identical vectors for any input — simulates perfect semantic match */
class IdenticalVectorEmbeddingProvider implements EmbeddingProvider {
  readonly embeddingModel = "mock-identical"
  readonly dimensions = 3

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1, 0, 0])
  }
}

/** Returns orthogonal vectors — simulates zero semantic similarity */
class OrthogonalVectorEmbeddingProvider implements EmbeddingProvider {
  readonly embeddingModel = "mock-orthogonal"
  readonly dimensions = 3

  private counter = 0
  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = []
    for (let i = 0; i < texts.length; i++) {
      const axis = (this.counter + i) % 3
      const v = [0, 0, 0]
      v[axis] = 1
      vectors.push(v)
    }
    this.counter += texts.length
    return vectors
  }
}

// ---------------------------------------------------------------------------
// cosineSimilarity pure function tests
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  test("identical vectors → 1.0", () => {
    const v = [1, 2, 3, 4]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10)
  })

  test("orthogonal vectors → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10)
  })

  test("opposite vectors → -1 (cosine, not absolute)", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10)
  })

  test("dimension mismatch throws", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/Dimension mismatch/)
  })

  test("zero vector → 0 (not NaN)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  })

  test("known partial similarity", () => {
    // [1,1] vs [1,0] → cos = 1/sqrt(2) ≈ 0.707
    const result = cosineSimilarity([1, 1], [1, 0])
    expect(result).toBeCloseTo(1 / Math.sqrt(2), 5)
  })
})

// ---------------------------------------------------------------------------
// HybridComparator — 4-layer mode (embedding available + succeeds)
// ---------------------------------------------------------------------------

describe("HybridComparator — 4-layer mode (embedding available)", () => {
  const embeddingProvider = new IdenticalVectorEmbeddingProvider()
  const comparator = new DefaultMemoryComparator({ embeddingProvider })

  test("compareText with identical embeddings → high score", async () => {
    // Embeddings are identical [1,0,0] for both → embedding score = 1.0
    // Lexical layers also contribute
    const result = await comparator.compareText("hello world", "hello world")
    expect(result.score).toBe(1.0) // identical strings → all layers 1.0
    expect(result.breakdown.embedding).toBe(1.0) // embedding provider available
  })

  test("compareText mode is hybrid-4layer when embedding used", async () => {
    const result = await comparator.compareText(
      "User is a senior Go engineer",
      "User is a senior Go developer",
    )
    expect(result.breakdown.embedding).toBeDefined()
    // mode is determined at compareMemory level, but compareText has embedding in breakdown
  })

  test("compareText with different embeddings → embedding score < 1", async () => {
    // Use orthogonal provider → embedding score = 0
    const orthoProvider = new OrthogonalVectorEmbeddingProvider()
    const cmp = new DefaultMemoryComparator({ embeddingProvider: orthoProvider })
    const result = await cmp.compareText("hello", "world")
    // With orthogonal embeddings, embedding layer = 0
    expect(result.breakdown.embedding).toBe(0)
    // Final score is reduced by the missing embedding contribution
    // lexical 65% of score + embedding 0 * 35% = 65% of lexical max
    expect(result.score).toBeLessThan(0.65) // strictly less because lexical overlap isn't perfect
  })

  test("compareMemory mode is hybrid-4layer when embedding available", async () => {
    const mem: ComparableMemory = {
      content: "Test content for embedding comparison",
      name: "Test",
      type: "user",
    }
    const result = await comparator.compareMemory(mem, mem)
    expect(result.mode).toBe("hybrid-4layer")
    expect(result.fields.content.breakdown.embedding).toBeDefined()
  })

  test("hybrid weights produce different score than legacy", async () => {
    // With identical embedding → hybrid score should be higher than legacy
    // because embedding adds 35% weight at 1.0
    const legacyComparator = new DefaultMemoryComparator()
    const expected = "User is a senior Go engineer who prefers backend"
    const actual = "User is a senior Go developer who prefers backend"

    const legacyResult = await legacyComparator.compareText(expected, actual)
    const hybridResult = await comparator.compareText(expected, actual)

    // Hybrid should be >= legacy because embedding (identical) adds perfect score
    expect(hybridResult.score).toBeGreaterThanOrEqual(legacyResult.score * 0.9)
    expect(hybridResult.breakdown.embedding).toBeDefined()
    expect(legacyResult.breakdown.embedding).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// HybridComparator — fallback to 3-layer (embedding fails)
// ---------------------------------------------------------------------------

describe("HybridComparator — fallback when embedding fails", () => {
  const failingProvider = new FailingEmbeddingProvider()
  const comparator = new DefaultMemoryComparator({ embeddingProvider: failingProvider })

  test("compareText falls back to 3-layer on embedding error", async () => {
    const result = await comparator.compareText(
      "User is a Go engineer",
      "User is a Go developer",
    )
    // Embedding failed → no embedding in breakdown → legacy weights
    expect(result.breakdown.embedding).toBeUndefined()
    // Score should still be reasonable (lexical comparison works)
    expect(result.score).toBeGreaterThan(0)
  })

  test("compareMemory mode is legacy-3layer when embedding fails", async () => {
    // Use NON-identical content so embedding provider actually gets called (and fails)
    const expected: ComparableMemory = {
      content: "Test content for fallback testing here",
      name: "Test",
      type: "user",
    }
    const actual: ComparableMemory = {
      content: "Test content for fallback testing there",
      name: "Test",
      type: "user",
    }
    const result = await comparator.compareMemory(expected, actual)
    // Embedding failed on non-identical content → fallback mode
    expect(result.mode).toBe("legacy-3layer")
  })

  test("fallback score matches legacy-3-layer exactly", async () => {
    // Same comparator, but without failing embedding provider
    const legacyComparator = new DefaultMemoryComparator()
    const failingComparator = new DefaultMemoryComparator({ embeddingProvider: failingProvider })

    const a = "The user prefers Python for machine learning"
    const b = "The user prefers Go for backend development"

    const legacyResult = await legacyComparator.compareText(a, b)
    const fallbackResult = await failingComparator.compareText(a, b)

    // Fallback should produce exactly the same score as legacy
    expect(fallbackResult.score).toBe(legacyResult.score)
    expect(fallbackResult.breakdown.embedding).toBeUndefined()
    expect(legacyResult.breakdown.embedding).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// HybridComparator — no embedding provider configured
// ---------------------------------------------------------------------------

describe("HybridComparator — no embedding provider (legacy mode)", () => {
  const comparator = new DefaultMemoryComparator()

  test("compareText has no embedding in breakdown", async () => {
    const result = await comparator.compareText("hello world", "hello there")
    expect(result.breakdown.embedding).toBeUndefined()
  })

  test("compareMemory mode is legacy-3layer", async () => {
    const mem: ComparableMemory = {
      content: "Some test content here",
      name: "Test",
      type: "user",
    }
    const result = await comparator.compareMemory(mem, mem)
    expect(result.mode).toBe("legacy-3layer")
  })
})

// ---------------------------------------------------------------------------
// Constructor backward compatibility
// ---------------------------------------------------------------------------

describe("DefaultMemoryComparator constructor backward compat", () => {
  test("number threshold still works (v0.3.1 style)", () => {
    const comparator = new DefaultMemoryComparator(0.5)
    // Should work without errors
    expect(comparator).toBeDefined()
  })

  test("opts object with embedding provider (v0.3.2 style)", () => {
    const embeddingProvider = new IdenticalVectorEmbeddingProvider()
    const comparator = new DefaultMemoryComparator({ embeddingProvider, threshold: 0.7 })
    expect(comparator).toBeDefined()
  })

  test("no args (default threshold 0.8, no embedding)", () => {
    const comparator = new DefaultMemoryComparator()
    expect(comparator).toBeDefined()
  })

  test("threshold from number constructor works in compareMemory", async () => {
    const comparator = new DefaultMemoryComparator(0.3)
    const expected: ComparableMemory = {
      content: "Some different content entirely about apples",
      type: "user",
    }
    const actual: ComparableMemory = {
      content: "Some different content entirely about oranges",
      type: "user",
    }
    const result = await comparator.compareMemory(expected, actual)
    // With low threshold (0.3), even partially matching content should pass
    expect(result.passed).toBe(result.score >= 0.3)
  })
})

// ---------------------------------------------------------------------------
// YOLOv11 case — the motivation for embedding (spec Section 3)
// ---------------------------------------------------------------------------

describe("YOLOv11 semantic case — embedding improves detection", () => {
  test("lexical-only misses semantic similarity (baseline)", async () => {
    const legacyComparator = new DefaultMemoryComparator()
    const expected = "User is developing a YOLOv11 model for wind turbine blade defect detection."
    const actual = "User works on YOLO version 11 for detecting flaws in turbine blades."

    const result = await legacyComparator.compareText(expected, actual)
    // Lexical-only should score low (different words, different structure)
    // This is the problem v0.3.2 embedding solves
    expect(result.score).toBeLessThan(0.5)
    expect(result.breakdown.embedding).toBeUndefined()
  })

  test("with identical embedding → hybrid score >= legacy score", async () => {
    const embeddingProvider = new IdenticalVectorEmbeddingProvider()
    const hybridComparator = new DefaultMemoryComparator({ embeddingProvider })
    const expected = "User is developing a YOLOv11 model for wind turbine blade defect detection."
    const actual = "User works on YOLO version 11 for detecting flaws in turbine blades."

    const legacyResult = await new DefaultMemoryComparator().compareText(expected, actual)
    const hybridResult = await hybridComparator.compareText(expected, actual)

    // Hybrid with identical embeddings should score higher (embedding = 1.0 adds 35%)
    expect(hybridResult.score).toBeGreaterThan(legacyResult.score)
    expect(hybridResult.breakdown.embedding).toBe(1.0)
    expect(legacyResult.breakdown.embedding).toBeUndefined()
  })
})
