/**
 * opencode-memory — AdapterLLMProvider Bridge Tests (v0.3.3)
 */

import { describe, test, expect } from "vitest"
import { AdapterLLMProvider, extractResponseText } from "../../src/llm/adapter-bridge.js"
import type { RuntimeAdapter } from "../../src/adapter.js"

// Mock RuntimeAdapter
function createMockAdapter(promptResponse: unknown): RuntimeAdapter {
  let capturedPrompt = ""
  let capturedOpts: Record<string, unknown> | undefined
  return {
    session: {
      create: async () => ({ id: "mock-session-id" }),
      prompt: async (id: string, message: string, opts?: { agent?: string; model?: string }) => {
        capturedPrompt = message
        capturedOpts = opts
        return promptResponse
      },
      messages: async () => [],
    },
    workspace: { current: async () => "/test" },
    git: { snapshot: async () => ({ branch: "main", head: "abc", changedFiles: [] }) },
    capabilities: { sessionCreate: true, messageRead: true, eventStream: false, backgroundTask: false, toolHook: false },
    healthCheck: async () => ({ sessionCreate: true, sessionMessages: true, sessionPrompt: "working", errors: [] }),
  } as unknown as RuntimeAdapter
}

describe("extractResponseText", () => {
  test("handles plain string", () => {
    expect(extractResponseText("hello")).toBe("hello")
  })

  test("handles { content: string }", () => {
    expect(extractResponseText({ content: "structured" })).toBe("structured")
  })

  test("handles { message: { content: string } }", () => {
    expect(extractResponseText({ message: { content: "msg content" } })).toBe("msg content")
  })

  test("handles { choices: [{ message: { content } }] } (OpenAI)", () => {
    expect(extractResponseText({ choices: [{ message: { content: "openai" } }] })).toBe("openai")
  })

  test("handles { output: { text } } (DashScope)", () => {
    expect(extractResponseText({ output: { text: "dashscope" } })).toBe("dashscope")
  })

  test("handles { text: string }", () => {
    expect(extractResponseText({ text: "simple" })).toBe("simple")
  })

  test("returns empty for null/undefined", () => {
    expect(extractResponseText(null)).toBe("")
    expect(extractResponseText(undefined)).toBe("")
  })

  test("returns empty for unknown shape", () => {
    expect(extractResponseText({ foo: "bar" })).toBe("")
  })
})

describe("AdapterLLMProvider", () => {
  test("creates session and prompts adapter", async () => {
    const adapter = createMockAdapter({ content: "LLM response" })
    const provider = new AdapterLLMProvider(adapter, "test-model")
    const result = await provider.complete({
      systemPrompt: "You are a memory extractor",
      userPrompt: "Extract memories from: User likes Go",
      model: "test-model",
    })
    expect(result.content).toBe("LLM response")
  })

  test("combines system + user prompt", async () => {
    let capturedPrompt = ""
    const adapter = createMockAdapter("response")
    ;(adapter as any).session.prompt = async (_id: string, message: string) => {
      capturedPrompt = message
      return "response"
    }
    const provider = new AdapterLLMProvider(adapter, "test-model")
    await provider.complete({
      systemPrompt: "SYSTEM_PROMPT",
      userPrompt: "USER_PROMPT",
      model: "test-model",
    })
    expect(capturedPrompt).toContain("SYSTEM_PROMPT")
    expect(capturedPrompt).toContain("USER_PROMPT")
  })

  test("handles string response from adapter", async () => {
    const adapter = createMockAdapter("plain string response")
    const provider = new AdapterLLMProvider(adapter, "test-model")
    const result = await provider.complete({
      systemPrompt: "sys",
      userPrompt: "usr",
      model: "test-model",
    })
    expect(result.content).toBe("plain string response")
  })

  test("handles { content } response shape", async () => {
    const adapter = createMockAdapter({ content: "structured response" })
    const provider = new AdapterLLMProvider(adapter, "test-model")
    const result = await provider.complete({
      systemPrompt: "sys",
      userPrompt: "usr",
      model: "test-model",
    })
    expect(result.content).toBe("structured response")
  })

  test("handles adapter errors", async () => {
    const adapter = createMockAdapter("should not reach")
    // Override create to throw
    ;(adapter as any).session.create = async () => { throw new Error("SDK unavailable") }
    const provider = new AdapterLLMProvider(adapter, "test-model")
    await expect(provider.complete({
      systemPrompt: "sys",
      userPrompt: "usr",
      model: "test-model",
    })).rejects.toThrow("AdapterLLMProvider complete() failed")
  })

  test("name is 'adapter'", () => {
    const provider = new AdapterLLMProvider(createMockAdapter(""), "test-model")
    expect(provider.name).toBe("adapter")
  })

  test("model is passed through", () => {
    const provider = new AdapterLLMProvider(createMockAdapter(""), "my-model-123")
    expect(provider.model).toBe("my-model-123")
  })

  test("implements CompletionProvider interface", () => {
    const provider = new AdapterLLMProvider(createMockAdapter(""), "test-model")
    expect(typeof provider.complete).toBe("function")
  })
})
