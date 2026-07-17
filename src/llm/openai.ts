/**
 * opencode-memory — OpenAI LLM Provider (v0.3.2)
 *
 * OpenAIProvider: completion via POST /v1/chat/completions
 * OpenAIEmbeddingProvider: embedding via POST /v1/embeddings
 *
 * Uses global fetch() — no external HTTP dependencies.
 * baseUrl is optional for API-compatible services (Azure, Ollama, etc.).
 */

import type {
  CompletionRequest,
  CompletionResult,
  EmbeddingProvider,
  ModelProvider,
} from "./provider.js"

// ---------------------------------------------------------------------------
// Internal response types
// ---------------------------------------------------------------------------

interface OpenAIChatChoice {
  message: { content: string }
  finish_reason?: string
}

interface OpenAIChatResponse {
  choices: OpenAIChatChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
  model: string
}

interface OpenAIEmbeddingData {
  embedding: number[]
}

interface OpenAIEmbeddingResponse {
  data: OpenAIEmbeddingData[]
  model: string
  usage?: { prompt_tokens: number }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_RETRIES = 2
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai"
  readonly model: string
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(model: string, apiKey: string, baseUrl?: string) {
    this.model = model
    this.apiKey = apiKey
    this.baseUrl = baseUrl ?? "https://api.openai.com/v1"
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const url = `${this.baseUrl}/chat/completions`
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt },
      ],
      temperature: req.temperature ?? 0,
    }
    if (req.topP !== undefined) body.top_p = req.topP
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens
    if (req.seed !== undefined) body.seed = req.seed
    // Note: OpenAI API does not support top_k — silently ignored to avoid 400 errors

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 500
            await new Promise((r) => setTimeout(r, delay))
            continue
          }
          const errorText = await response.text().catch(() => "unknown error")
          throw new Error(`OpenAI API error ${response.status}: ${errorText}`)
        }

        const data = (await response.json()) as OpenAIChatResponse
        const content = data.choices?.[0]?.message?.content ?? ""

        return {
          content,
          usage: data.usage
            ? {
                inputTokens: data.usage.prompt_tokens,
                outputTokens: data.usage.completion_tokens,
              }
            : undefined,
          finishReason: data.choices?.[0]?.finish_reason,
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 500
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }

    throw lastError ?? new Error("OpenAI completion failed")
  }

  /**
   * Fetch with timeout. Aborts the request if it exceeds the configured limit.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      return response
    } finally {
      clearTimeout(timer)
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAIEmbeddingProvider
// ---------------------------------------------------------------------------

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly embeddingModel: string
  readonly dimensions: number
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(model: string, dimensions: number, apiKey: string, baseUrl?: string) {
    this.embeddingModel = model
    this.dimensions = dimensions
    this.apiKey = apiKey
    this.baseUrl = baseUrl ?? "https://api.openai.com/v1"
  }

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`
    const body = {
      model: this.embeddingModel,
      input: texts,
      dimensions: this.dimensions,
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!response.ok) {
          if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 500
            await new Promise((r) => setTimeout(r, delay))
            continue
          }
          const errorText = await response.text().catch(() => "unknown error")
          throw new Error(`OpenAI Embedding API error ${response.status}: ${errorText}`)
        }

        const data = (await response.json()) as OpenAIEmbeddingResponse
        return data.data.map((d) => d.embedding)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 500
          await new Promise((r) => setTimeout(r, delay))
        }
      } finally {
        clearTimeout(timer)
      }
    }

    throw lastError ?? new Error("OpenAI embedding failed")
  }
}
