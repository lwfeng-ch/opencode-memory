/**
 * opencode-memory — Qwen/DashScope LLM Provider (v0.3.2)
 *
 * QwenProvider: completion via DashScope API
 * QwenEmbeddingProvider: BGE-M3 embedding via DashScope
 *
 * Uses global fetch() — no external HTTP dependencies.
 * Base URL: https://dashscope.aliyuncs.com/api/v1
 */

import type {
  CompletionRequest,
  CompletionResult,
  EmbeddingProvider,
  ModelProvider,
} from "./provider.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/api/v1"
const COMPLETION_PATH = "/services/aigc/text-generation/generation"
const EMBEDDING_PATH = "/services/embeddings/text-embedding/text-embedding"
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_RETRIES = 2
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

// ---------------------------------------------------------------------------
// Internal response types
// ---------------------------------------------------------------------------

interface DashScopeCompletionResponse {
  output: {
    text: string
    finish_reason?: string
  }
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

interface DashScopeEmbeddingItem {
  embedding: number[]
  text_index: number
}

interface DashScopeEmbeddingResponse {
  output: {
    embeddings: DashScopeEmbeddingItem[]
  }
  usage?: {
    total_tokens: number
  }
}

// ---------------------------------------------------------------------------
// QwenProvider
// ---------------------------------------------------------------------------

export class QwenProvider implements ModelProvider {
  readonly name = "qwen"
  readonly model: string
  private readonly apiKey: string

  constructor(model: string, apiKey: string) {
    this.model = model
    this.apiKey = apiKey
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const url = `${DASHSCOPE_BASE}${COMPLETION_PATH}`
    const body = {
      model: req.model,
      input: {
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
      },
      parameters: {
        temperature: req.temperature ?? 0,
        ...(req.topP !== undefined && { top_p: req.topP }),
        ...(req.topK !== undefined && { top_k: req.topK }),
        ...(req.maxTokens !== undefined && { max_tokens: req.maxTokens }),
        ...(req.seed !== undefined && { seed: req.seed }),
      },
    }

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
          throw new Error(`DashScope API error ${response.status}: ${errorText}`)
        }

        const data = (await response.json()) as DashScopeCompletionResponse

        return {
          content: data.output?.text ?? "",
          usage: data.usage
            ? {
                inputTokens: data.usage.input_tokens,
                outputTokens: data.usage.output_tokens,
              }
            : undefined,
          finishReason: data.output?.finish_reason,
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 500
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }

    throw lastError ?? new Error("Qwen completion failed")
  }

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
// QwenEmbeddingProvider
// ---------------------------------------------------------------------------

export class QwenEmbeddingProvider implements EmbeddingProvider {
  readonly embeddingModel = "bge-m3"
  readonly dimensions = 1024
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${DASHSCOPE_BASE}${EMBEDDING_PATH}`
    const body = {
      model: "text-embedding-v2",
      input: { texts },
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
          throw new Error(`DashScope Embedding API error ${response.status}: ${errorText}`)
        }

        const data = (await response.json()) as DashScopeEmbeddingResponse
        return data.output?.embeddings?.map((e) => e.embedding) ?? []
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

    throw lastError ?? new Error("Qwen embedding failed")
  }
}
