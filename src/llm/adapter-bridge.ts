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
import { extractResponseText } from "../extraction.js"

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
