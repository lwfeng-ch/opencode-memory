import { describe, test, expect, vi } from "vitest"
import { extractMemories, type ExtractionInput } from "../../src/extraction.js"
import { DeterministicMockProvider } from "../llm/mock-providers.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a simple ModelProvider-compatible mock from DeterministicMockProvider.
 * This wraps the CompletionProvider into a ModelProvider shape for extractMemories().
 */
function createMockProvider(response: string) {
  const base = new DeterministicMockProvider(response)
  return {
    name: "mock" as const,
    model: "mock-model" as const,
    complete: base.complete.bind(base),
  }
}

function makeInput(overrides?: Partial<ExtractionInput>): ExtractionInput {
  return {
    messages: [
      { role: "user", content: "I prefer Python and Flask for building APIs" },
      { role: "assistant", content: "Great choice! Flask is lightweight and flexible." },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// extractMemories
// ---------------------------------------------------------------------------

describe("extractMemories", () => {
  test("returns empty memories for empty LLM response", async () => {
    const provider = createMockProvider("[]")
    const input = makeInput()

    const result = await extractMemories(input, provider)

    expect(result.memories).toEqual([])
    expect(result.raw).toBe("[]")
    expect(result.metadata?.model).toBe("mock-model")
    expect(result.metadata?.promptVersion).toBe("extract-v1")
    expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
  })

  test("parses valid JSON array from LLM response", async () => {
    const llmResponse = JSON.stringify([
      {
        name: "User Preference: Python & Flask",
        description: "User prefers Python and Flask for building APIs",
        content: "The user expressed a preference for Python and Flask for building API services.",
        type: "user",
        scope: "user",
        confidence: "explicit",
      },
    ])
    const provider = createMockProvider(llmResponse)
    const input = makeInput()

    const result = await extractMemories(input, provider)

    expect(result.memories).toHaveLength(1)
    expect(result.memories[0].name).toBe("User Preference: Python & Flask")
    expect(result.memories[0].type).toBe("user")
    expect(result.memories[0].confidence).toBe("explicit")
  })

  test("filters out invalid candidates when validation is enabled", async () => {
    // One valid, one missing required field
    const llmResponse = JSON.stringify([
      {
        name: "Valid Memory",
        description: "A valid memory with all fields",
        content: "This is valid content",
        type: "user",
        scope: "user",
        confidence: "inferred",
      },
      {
        name: "", // Empty name — should be filtered
        description: "Missing name",
        content: "some content",
        type: "user",
        confidence: "explicit",
      },
    ])
    const provider = createMockProvider(llmResponse)
    const input = makeInput()

    const result = await extractMemories(input, provider)

    expect(result.memories).toHaveLength(1)
    expect(result.memories[0].name).toBe("Valid Memory")
  })

  test("applies maxMemories cap", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      name: `Memory ${i}`,
      description: `Description for memory ${i}`,
      content: `Content for memory ${i}`,
      type: "user",
      scope: "user",
      confidence: "inferred",
    }))
    const provider = createMockProvider(JSON.stringify(candidates))
    const input = makeInput()

    const result = await extractMemories(input, provider, { maxMemories: 3 })

    expect(result.memories).toHaveLength(3)
  })

  test("applies confidence threshold", async () => {
    const llmResponse = JSON.stringify([
      {
        name: "Explicit Memory",
        description: "High confidence",
        content: "Important info",
        type: "user",
        scope: "user",
        confidence: "explicit",
      },
      {
        name: "Uncertain Memory",
        description: "Low confidence",
        content: "Maybe info",
        type: "project",
        scope: "project",
        confidence: "uncertain",
      },
    ])
    const provider = createMockProvider(llmResponse)
    const input = makeInput()

    // Only keep memories with confidence >= "inferred" (0.5)
    const result = await extractMemories(input, provider, { confidenceThreshold: 0.5 })

    expect(result.memories).toHaveLength(1)
    expect(result.memories[0].confidence).toBe("explicit")
  })

  test("parses JSON from markdown code block", async () => {
    const llmResponse = "Here are the memories:\n```json\n[\n  {\n    \"name\": \"From Code Block\",\n    \"description\": \"Memory from code block\",\n    \"content\": \"Content\",\n    \"type\": \"project\",\n    \"scope\": \"project\",\n    \"confidence\": \"inferred\"\n  }\n]\n```"
    const provider = createMockProvider(llmResponse)
    const input = makeInput()

    const result = await extractMemories(input, provider)

    expect(result.memories).toHaveLength(1)
    expect(result.memories[0].name).toBe("From Code Block")
  })

  test("returns usage from provider", async () => {
    const provider = createMockProvider("[]")
    const input = makeInput()

    const result = await extractMemories(input, provider)

    expect(result.usage).toBeDefined()
    expect(result.usage!.inputTokens).toBe(100)
    expect(result.usage!.outputTokens).toBe(50)
  })

  test("handles empty messages gracefully", async () => {
    const provider = createMockProvider("[]")
    const input: ExtractionInput = { messages: [] }

    const result = await extractMemories(input, provider)

    expect(result.memories).toEqual([])
    expect(result.raw).toBe("[]")
  })

  test("includes context in prompt for provider", async () => {
    // Create a custom mock that tracks the prompt content
    let capturedSystemPrompt = ""
    let capturedUserPrompt = ""
    const mockComplete = vi.fn().mockResolvedValue({
      content: "[]",
      usage: { inputTokens: 10, outputTokens: 5 },
    })

    const provider = {
      name: "mock" as const,
      model: "mock-model" as const,
      complete: mockComplete,
    }

    const input: ExtractionInput = {
      messages: [
        { role: "user", content: "I like TypeScript" },
      ],
    }

    await extractMemories(input, provider)

    expect(mockComplete).toHaveBeenCalledTimes(1)
    const req = mockComplete.mock.calls[0][0]
    expect(req.systemPrompt).toContain("memory extraction")
    expect(req.userPrompt).toContain("TypeScript")
    expect(req.temperature).toBe(0)
  })
})
