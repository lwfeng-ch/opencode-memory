/**
 * opencode-memory — Mock Provider Tests (v0.3.2)
 */

import { describe, test, expect } from "vitest"
import { DeterministicMockProvider, RandomMockProvider, FailingEmbeddingProvider, FixedVectorEmbeddingProvider } from "./mock-providers.js"

describe("DeterministicMockProvider", () => {
  test("returns fixed response", async () => {
    const provider = new DeterministicMockProvider("fixed output")
    const result = await provider.complete({
      systemPrompt: "test",
      userPrompt: "test",
      model: "test-model",
      temperature: 0,
    })
    expect(result.content).toBe("fixed output")
    expect(result.usage?.inputTokens).toBe(100)
    expect(result.usage?.outputTokens).toBe(50)
  })

  test("returns same response on repeated calls", async () => {
    const provider = new DeterministicMockProvider("always this")
    const r1 = await provider.complete({ systemPrompt: "", userPrompt: "", model: "m", temperature: 0 })
    const r2 = await provider.complete({ systemPrompt: "", userPrompt: "", model: "m", temperature: 0 })
    expect(r1.content).toBe("always this")
    expect(r2.content).toBe("always this")
  })
})

describe("RandomMockProvider", () => {
  test("cycles through responses", async () => {
    const provider = new RandomMockProvider(["first", "second", "third"])
    const r0 = await provider.complete({ systemPrompt: "", userPrompt: "", model: "m", temperature: 0 })
    const r1 = await provider.complete({ systemPrompt: "", userPrompt: "", model: "m", temperature: 0 })
    const r2 = await provider.complete({ systemPrompt: "", userPrompt: "", model: "m", temperature: 0 })
    expect(r0.content).toBe("first")
    expect(r1.content).toBe("second")
    expect(r2.content).toBe("third")
  })

  test("wraps around after exhausting array", async () => {
    const provider = new RandomMockProvider(["a", "b"])
    await provider.complete({ systemPrompt: "", userPrompt: "", model: "m", temperature: 0 })
    await provider.complete({ systemPrompt: "", userPrompt: "", model: "m", temperature: 0 })
    const r3 = await provider.complete({ systemPrompt: "", userPrompt: "", model: "m", temperature: 0 })
    expect(r3.content).toBe("a")
  })

  test("tracks call count", async () => {
    const provider = new RandomMockProvider(["x", "y"])
    expect(provider.currentCallCount).toBe(0)
    await provider.complete({ systemPrompt: "", userPrompt: "", model: "m", temperature: 0 })
    expect(provider.currentCallCount).toBe(1)
    await provider.complete({ systemPrompt: "", userPrompt: "", model: "m", temperature: 0 })
    expect(provider.currentCallCount).toBe(2)
  })
})

describe("FailingEmbeddingProvider", () => {
  test("has correct metadata", () => {
    const provider = new FailingEmbeddingProvider()
    expect(provider.embeddingModel).toBe("mock-fail")
    expect(provider.dimensions).toBe(0)
  })

  test("throws on embed", async () => {
    const provider = new FailingEmbeddingProvider()
    await expect(provider.embed(["test"])).rejects.toThrow("Mock embedding failure")
  })
})

describe("FixedVectorEmbeddingProvider", () => {
  test("returns fixed vectors", async () => {
    const vectors = [[1, 0], [0, 1], [0.5, 0.5]]
    const provider = new FixedVectorEmbeddingProvider(vectors)
    const result = await provider.embed(["a", "b", "c"])
    expect(result).toEqual(vectors)
  })

  test("cycles vectors when more texts than vectors", async () => {
    const vectors = [[1, 0], [0, 1]]
    const provider = new FixedVectorEmbeddingProvider(vectors)
    const result = await provider.embed(["a", "b", "c"])
    expect(result).toEqual([[1, 0], [0, 1], [1, 0]])
  })

  test("sets dimensions from first vector", () => {
    const provider = new FixedVectorEmbeddingProvider([[0.1, 0.2, 0.3]])
    expect(provider.dimensions).toBe(3)
  })

  test("dimensions is 0 for empty vector array", () => {
    const provider = new FixedVectorEmbeddingProvider([])
    expect(provider.dimensions).toBe(0)
  })

  test("has correct embeddingModel", () => {
    const provider = new FixedVectorEmbeddingProvider([[1, 0]])
    expect(provider.embeddingModel).toBe("mock-fixed")
  })
})
