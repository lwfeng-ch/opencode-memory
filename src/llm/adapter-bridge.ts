/**
 * opencode-memory — AdapterLLMProvider Bridge (v0.3.3)
 *
 * Bridges RuntimeAdapter's session.prompt() as a CompletionProvider.
 * This unifies production and benchmark paths through extractMemories().
 *
 * Production path:
 *   RuntimeAdapter → AdapterLLMProvider → extractMemories()
 *
 * Benchmark path:
 *   OpenAIProvider/QwenProvider → extractMemories()
 */

import type { CompletionProvider, CompletionRequest, CompletionResult } from "./provider.js"
import type { RuntimeAdapter } from "../adapter.js"

/**
 * Extract text from various LLM response shapes.
 * Handles: plain string, { content }, { message: { content } }, { choices: [{ message: { content } }] }
 */
export function extractResponseText(response: unknown): string {
  if (typeof response === "string") return response
  if (response === null || typeof response !== "object") return ""
  const obj = response as Record<string, unknown>

  // { content: string }
  if (typeof obj.content === "string") return obj.content

  // { message: { content: string } }
  if (obj.message && typeof obj.message === "object") {
    const msg = obj.message as Record<string, unknown>
    if (typeof msg.content === "string") return msg.content
  }

  // { choices: [{ message: { content: string } }] } (OpenAI legacy)
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const choice = obj.choices[0] as Record<string, unknown>
    if (choice?.message && typeof choice.message === "object") {
      const msg = choice.message as Record<string, unknown>
      if (typeof msg.content === "string") return msg.content
    }
    if (typeof choice.text === "string") return choice.text
  }

  // { output: { text: string } } (DashScope)
  if (obj.output && typeof obj.output === "object") {
    const out = obj.output as Record<string, unknown>
    if (typeof out.text === "string") return out.text
  }

  return typeof obj.text === "string" ? obj.text : ""
}

/**
 * Wraps RuntimeAdapter as a CompletionProvider.
 * Production code uses this to call extractMemories() with the same
 * interface as benchmark providers (OpenAI/Qwen).
 */
export class AdapterLLMProvider implements CompletionProvider {
  readonly name = "adapter"
  readonly model: string

  constructor(
    private adapter: RuntimeAdapter,
    model: string,
  ) {
    this.model = model
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    try {
      // 1. Create a short-lived agent session
      const session = await this.adapter.session.create({
        agent: "quick",
      })

      // 2. Combine system + user prompt into a single message
      const fullPrompt = [
        req.systemPrompt,
        "",
        req.userPrompt,
      ].join("\n")

      // 3. Send prompt to the agent runtime
      const response = await this.adapter.session.prompt(
        session.id,
        fullPrompt,
        {
          agent: "quick",
          model: this.model,
        },
      )

      // 4. Extract text from the response
      const content = extractResponseText(response)

      return {
        content,
      }
    } catch (err) {
      throw new Error(
        `AdapterLLMProvider complete() failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}
