/**
 * opencode-memory — Mock Provider Implementations (v0.3.2)
 *
 * Mock providers for testing:
 *   - DeterministicMockProvider — fixed response (pipeline logic testing)
 *   - RandomMockProvider — cycling responses (repeat/stats testing)
 *   - FailingEmbeddingProvider — always throws (fallback testing)
 *   - FixedVectorEmbeddingProvider — known vectors (cosine similarity testing)
 */

import type { CompletionProvider, CompletionRequest, CompletionResult, EmbeddingProvider } from "../../src/llm/provider.js"

// ---------------------------------------------------------------------------
// DeterministicMockProvider
// ---------------------------------------------------------------------------

/**
 * Returns a fixed response string for every completion call.
 * Useful for testing pipeline logic (prompt construction, parse, validate).
 */
export class DeterministicMockProvider implements CompletionProvider {
  constructor(private readonly response: string) {}

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    return {
      content: this.response,
      usage: { inputTokens: 100, outputTokens: 50 },
    }
  }
}

// ---------------------------------------------------------------------------
// RandomMockProvider
// ---------------------------------------------------------------------------

/**
 * Returns varying responses by cycling through an array.
 * Useful for repeat/stats testing where call variance is required.
 *
 * Each call increments `callCount` and returns the next response
 * in the cycle (wrapping via modulo).
 */
export class RandomMockProvider implements CompletionProvider {
  private callCount = 0

  constructor(private readonly responses: string[]) {}

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    const resp = this.responses[this.callCount % this.responses.length]
    this.callCount++
    return {
      content: resp,
      usage: { inputTokens: 100, outputTokens: 50 },
    }
  }

  /** Current call count — useful for assertions. */
  get currentCallCount(): number {
    return this.callCount
  }
}

// ---------------------------------------------------------------------------
// FailingEmbeddingProvider
// ---------------------------------------------------------------------------

/**
 * Always throws an error on embed() calls.
 * Useful for testing embedding fallback behavior.
 */
export class FailingEmbeddingProvider implements EmbeddingProvider {
  readonly embeddingModel = "mock-fail"
  readonly dimensions = 0

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error("Mock embedding failure")
  }
}

// ---------------------------------------------------------------------------
// FixedVectorEmbeddingProvider
// ---------------------------------------------------------------------------

/**
 * Returns known embedding vectors, cycling through the provided array.
 * Useful for deterministic cosine similarity testing.
 */
export class FixedVectorEmbeddingProvider implements EmbeddingProvider {
  readonly embeddingModel = "mock-fixed"
  readonly dimensions: number

  constructor(private readonly vectors: number[][]) {
    this.dimensions = vectors[0]?.length ?? 0
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((_, i) => this.vectors[i % this.vectors.length])
  }
}
