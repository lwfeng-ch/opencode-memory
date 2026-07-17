/**
 * opencode-memory — LLM Provider Interfaces (v0.3.2)
 *
 * CompletionProvider and EmbeddingProvider are separate interfaces:
 * - Not all models support embedding (e.g. Qwen3 completion + BGE-M3 embedding)
 * - Benchmark can mix-and-match providers independently
 *
 * ModelProvider = CompletionProvider with identity metadata.
 * Embedding is injected separately via EmbeddingProvider.
 */

// ---------------------------------------------------------------------------
// Completion Provider
// ---------------------------------------------------------------------------

/** Request to a text-generation model. */
export interface CompletionRequest {
  systemPrompt: string
  userPrompt: string
  model: string
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
  seed?: number
}

/** Response from a text-generation model. */
export interface CompletionResult {
  content: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  finishReason?: string
}

/**
 * Text generation provider.
 * All LLM providers implement this. Embedding is a separate capability.
 */
export interface CompletionProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>
}

// ---------------------------------------------------------------------------
// Embedding Provider
// ---------------------------------------------------------------------------

/**
 * Text embedding provider.
 * Optional — comparator degrades to 3-layer lexical when unavailable.
 */
export interface EmbeddingProvider {
  /** Embedding model identifier, e.g. "text-embedding-3-small", "bge-m3" */
  readonly embeddingModel: string
  /** Vector dimensions (e.g. 1024 for BGE-M3, 1536 for OpenAI small) */
  readonly dimensions: number
  /** Embed an array of texts. Returns one vector per input string. */
  embed(texts: string[]): Promise<number[][]>
}

// ---------------------------------------------------------------------------
// Model Provider (was LLMProvider)
// ---------------------------------------------------------------------------

/**
 * Text generation provider with identity metadata.
 * Does NOT imply embedding capability — embed via EmbeddingProvider separately.
 */
export interface ModelProvider extends CompletionProvider {
  readonly name: string
  readonly model: string
}
