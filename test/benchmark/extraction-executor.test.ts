import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { ExtractionExecutor } from "../../benchmark/executor/extraction.js"
import { DeterministicMockProvider } from "../llm/mock-providers.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProvider(response: string) {
  const base = new DeterministicMockProvider(response)
  return {
    name: "mock" as const,
    model: "mock-model" as const,
    complete: base.complete.bind(base),
  }
}

// ---------------------------------------------------------------------------
// ExtractionExecutor
// ---------------------------------------------------------------------------

describe("ExtractionExecutor", () => {
  let executor: ExtractionExecutor

  beforeEach(() => {
    const provider = createMockProvider("[]")
    executor = new ExtractionExecutor(provider)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("executes extraction and returns structured results", async () => {
    const provider = createMockProvider(JSON.stringify([
      {
        name: "User: Python Preference",
        description: "User prefers Python for scripting",
        content: "The user mentioned that Python is their go-to for scripting tasks.",
        type: "user",
        scope: "user",
        confidence: "explicit",
      },
    ]))
    const exec = new ExtractionExecutor(provider)

    const result = await exec.execute({
      messages: [
        { role: "user" as const, content: "Python is my favorite for scripting" },
      ],
    })

    expect(result.memories).toHaveLength(1)
    expect(result.memories[0].name).toBe("User: Python Preference")
    expect(result.metadata!.model).toBe("mock-model")
    expect(result.usage!.inputTokens).toBeGreaterThan(0)
    expect(result.metadata!.durationMs).toBeGreaterThanOrEqual(0)
  })

  test("returns empty memories when LLM responds with empty array", async () => {
    const result = await executor.execute({
      messages: [
        { role: "user" as const, content: "Nothing to extract" },
      ],
    })

    expect(result.memories).toEqual([])
    expect(result.raw).toBe("[]")
  })

  test("passes context metadata to extraction", async () => {
    const provider = createMockProvider(JSON.stringify([
      {
        name: "Contextual insight",
        description: "User likes functional programming",
        content: "User expressed preference for functional programming patterns.",
        type: "user",
        confidence: "inferred",
      },
    ]))
    const exec = new ExtractionExecutor(provider)

    const result = await exec.execute({
      messages: [
        { role: "user" as const, content: "I love functional programming" },
      ],
      context: {
        project: "test-project",
        agent: "test-agent",
        sessionId: "session-1",
        scope: "user",
      },
    })

    expect(result.memories).toHaveLength(1)
  })

  test("propagates LLM errors", async () => {
    const failingProvider = {
      name: "mock" as const,
      model: "mock-model" as const,
      complete: async () => {
        throw new Error("LLM call failed")
      },
    }
    const exec = new ExtractionExecutor(failingProvider)

    await expect(exec.execute({
      messages: [{ role: "user" as const, content: "test" }],
    })).rejects.toThrow("LLM call failed")
  })

  test("constructor accepts options", async () => {
    const provider = createMockProvider("[]")
    const execWithOptions = new ExtractionExecutor(provider, {
      maxMemories: 5,
      confidenceThreshold: 0.3,
    })

    const result = await execWithOptions.execute({
      messages: [{ role: "user" as const, content: "test" }],
    })

    expect(result.memories).toEqual([])
  })

  test("implements BenchmarkExecutor interface", async () => {
    expect(executor).toHaveProperty("execute")
    expect(typeof executor.execute).toBe("function")
  })
})
