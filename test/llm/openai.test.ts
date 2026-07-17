import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { OpenAIProvider, OpenAIEmbeddingProvider } from "../../src/llm/openai.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(response: Partial<Response>): void {
  const defaultResponse = {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
    ...response,
  }
  vi.spyOn(globalThis, "fetch").mockResolvedValue(defaultResponse as Response)
}

function mockFetchResponse(data: unknown, status = 200): void {
  const body = JSON.stringify(data)
  mockFetch({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => body,
  })
}

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

describe("OpenAIProvider", () => {
  let provider: OpenAIProvider

  beforeEach(() => {
    provider = new OpenAIProvider("gpt-4o", "sk-test-key")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("sends correct request URL and headers", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "Hello!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: "gpt-4o",
    })

    const result = await provider.complete({
      systemPrompt: "You are helpful",
      userPrompt: "Say hello",
      model: "gpt-4o",
      temperature: 0,
    })

    // Verify fetch was called with correct params
    expect(fetch).toHaveBeenCalledTimes(1)
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe("https://api.openai.com/v1/chat/completions")

    const body = JSON.parse(call[1].body)
    expect(body.model).toBe("gpt-4o")
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful" })
    expect(body.messages[1]).toEqual({ role: "user", content: "Say hello" })
    expect(body.temperature).toBe(0)

    // Check headers
    expect(call[1].headers["Authorization"]).toBe("Bearer sk-test-key")
    expect(call[1].headers["Content-Type"]).toBe("application/json")

    // Check response
    expect(result.content).toBe("Hello!")
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(result.finishReason).toBe("stop")
  })

  test("uses custom baseUrl when provided", async () => {
    const customProvider = new OpenAIProvider("gpt-4o", "test-key", "https://custom.api.com/v1")
    mockFetchResponse({
      choices: [{ message: { content: "ok" } }],
    })

    await customProvider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "gpt-4o",
    })

    expect(fetch).toHaveBeenCalledWith(
      "https://custom.api.com/v1/chat/completions",
      expect.anything(),
    )
  })

  test("includes optional parameters when provided", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "ok" } }],
    })

    await provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "gpt-4o",
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 500,
      seed: 42,
      topK: 40,
    })

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.temperature).toBe(0.7)
    expect(body.top_p).toBe(0.9)
    expect(body.max_tokens).toBe(500)
    expect(body.seed).toBe(42)
  })

  test("retries on 500 error then succeeds", async () => {
    const mockFetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "retry success" } }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
        text: async () => JSON.stringify({ choices: [{ message: { content: "retry success" } }] }),
      })
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchFn)

    const result = await provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "gpt-4o",
    })

    expect(mockFetchFn).toHaveBeenCalledTimes(2)
    expect(result.content).toBe("retry success")
  })

  test("throws on non-retryable 400 error", async () => {
    mockFetch({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    })

    await expect(provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "gpt-4o",
    })).rejects.toThrow(/400/)
  })

  test("throws on network timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("The operation was aborted", "AbortError"))

    await expect(provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "gpt-4o",
    })).rejects.toThrow()
  })

  test("handles empty response content", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "" } }],
    })

    const result = await provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "gpt-4o",
    })

    expect(result.content).toBe("")
  })

  test("handles missing usage info", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "no usage" } }],
    })

    const result = await provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "gpt-4o",
    })

    expect(result.content).toBe("no usage")
    expect(result.usage).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// OpenAIEmbeddingProvider
// ---------------------------------------------------------------------------

describe("OpenAIEmbeddingProvider", () => {
  let provider: OpenAIEmbeddingProvider

  beforeEach(() => {
    provider = new OpenAIEmbeddingProvider("text-embedding-3-small", 1536, "sk-test-key")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("sends correct embedding request", async () => {
    mockFetchResponse({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 10 },
    })

    const result = await provider.embed(["test text"])

    expect(fetch).toHaveBeenCalledTimes(1)
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe("https://api.openai.com/v1/embeddings")

    const body = JSON.parse(call[1].body)
    expect(body.model).toBe("text-embedding-3-small")
    expect(body.input).toEqual(["test text"])
    expect(body.dimensions).toBe(1536)

    expect(result).toEqual([[0.1, 0.2, 0.3]])
  })

  test("handles multiple texts", async () => {
    mockFetchResponse({
      data: [
        { embedding: [0.1, 0.2] },
        { embedding: [0.3, 0.4] },
      ],
      model: "text-embedding-3-small",
    })

    const result = await provider.embed(["text a", "text b"])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0.1, 0.2])
    expect(result[1]).toEqual([0.3, 0.4])
  })

  test("throws on API error", async () => {
    mockFetch({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    })

    await expect(provider.embed(["test"])).rejects.toThrow(/401/)
  })

  test("uses custom baseUrl", async () => {
    const customProvider = new OpenAIEmbeddingProvider("text-embedding-3-small", 256, "key", "https://custom.api.com/v1")
    mockFetchResponse({
      data: [{ embedding: [0.5] }],
    })

    await customProvider.embed(["test"])

    expect(fetch).toHaveBeenCalledWith(
      "https://custom.api.com/v1/embeddings",
      expect.anything(),
    )
  })
})
