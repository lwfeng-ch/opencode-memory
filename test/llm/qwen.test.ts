import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { QwenProvider, QwenEmbeddingProvider } from "../../src/llm/qwen.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(data: unknown, status = 200): void {
  const body = JSON.stringify(data)
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => body,
  } as Response)
}

// ---------------------------------------------------------------------------
// QwenProvider
// ---------------------------------------------------------------------------

describe("QwenProvider", () => {
  let provider: QwenProvider

  beforeEach(() => {
    provider = new QwenProvider("qwen3-14b", "sk-dashscope-key")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("sends correct DashScope request format", async () => {
    mockFetchResponse({
      output: { text: "Hello from Qwen!", finish_reason: "stop" },
      usage: { input_tokens: 15, output_tokens: 8 },
    })

    const result = await provider.complete({
      systemPrompt: "You are helpful",
      userPrompt: "Say hello",
      model: "qwen3-14b",
      temperature: 0.5,
      topP: 0.9,
      topK: 40,
      maxTokens: 500,
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]

    // Check URL — DashScope uses a specific endpoint path
    expect(call[0]).toContain("dashscope.aliyuncs.com")
    expect(call[0]).toContain("/services/aigc/text-generation/generation")

    // Check headers
    expect(call[1].headers["Authorization"]).toBe("Bearer sk-dashscope-key")
    expect(call[1].headers["Content-Type"]).toBe("application/json")

    // Check request body format (DashScope-specific)
    const body = JSON.parse(call[1].body)
    expect(body.model).toBe("qwen3-14b")
    expect(body.input.messages).toHaveLength(2)
    expect(body.input.messages[0]).toEqual({ role: "system", content: "You are helpful" })
    expect(body.input.messages[1]).toEqual({ role: "user", content: "Say hello" })
    expect(body.parameters.temperature).toBe(0.5)
    expect(body.parameters.top_p).toBe(0.9)
    expect(body.parameters.top_k).toBe(40)
    expect(body.parameters.max_tokens).toBe(500)

    // Check response format (DashScope-specific)
    expect(result.content).toBe("Hello from Qwen!")
    expect(result.usage).toEqual({ inputTokens: 15, outputTokens: 8 })
    expect(result.finishReason).toBe("stop")
  })

  test("default temperature is 0", async () => {
    mockFetchResponse({
      output: { text: "ok" },
    })

    await provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "qwen3-14b",
    })

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.parameters.temperature).toBe(0)
  })

  test("retries on 503 then succeeds", async () => {
    const mockFetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ output: { text: "retry ok" } }),
        text: async () => JSON.stringify({ output: { text: "retry ok" } }),
      })
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchFn)

    const result = await provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "qwen3-14b",
    })

    expect(mockFetchFn).toHaveBeenCalledTimes(2)
    expect(result.content).toBe("retry ok")
  })

  test("throws on 400 error", async () => {
    mockFetchResponse({ error: "Bad request" }, 400)

    await expect(provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "qwen3-14b",
    })).rejects.toThrow(/400/)
  })

  test("handles missing usage", async () => {
    mockFetchResponse({
      output: { text: "no usage" },
    })

    const result = await provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "qwen3-14b",
    })

    expect(result.content).toBe("no usage")
    expect(result.usage).toBeUndefined()
  })

  test("handles empty output text", async () => {
    mockFetchResponse({
      output: { text: "" },
    })

    const result = await provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "qwen3-14b",
    })

    expect(result.content).toBe("")
  })
})

// ---------------------------------------------------------------------------
// QwenEmbeddingProvider
// ---------------------------------------------------------------------------

describe("QwenEmbeddingProvider", () => {
  let provider: QwenEmbeddingProvider

  beforeEach(() => {
    provider = new QwenEmbeddingProvider("sk-dashscope-key")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("sends correct DashScope embedding request", async () => {
    mockFetchResponse({
      output: {
        embeddings: [
          { embedding: [0.1, 0.2, 0.3], text_index: 0 },
        ],
      },
      usage: { total_tokens: 10 },
    })

    const result = await provider.embed(["test text"])

    expect(fetch).toHaveBeenCalledTimes(1)
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toContain("dashscope.aliyuncs.com")
    expect(call[0]).toContain("/services/embeddings/text-embedding/text-embedding")

    const body = JSON.parse(call[1].body)
    expect(body.model).toBe("text-embedding-v2")
    expect(body.input.texts).toEqual(["test text"])

    expect(result).toEqual([[0.1, 0.2, 0.3]])
  })

  test("handles multiple texts", async () => {
    mockFetchResponse({
      output: {
        embeddings: [
          { embedding: [0.5], text_index: 0 },
          { embedding: [0.6], text_index: 1 },
        ],
      },
    })

    const result = await provider.embed(["a", "b"])
    expect(result).toHaveLength(2)
  })

  test("throws on API error", async () => {
    mockFetchResponse({ error: "Unauthorized" }, 401)

    await expect(provider.embed(["test"])).rejects.toThrow(/401/)
  })
})
