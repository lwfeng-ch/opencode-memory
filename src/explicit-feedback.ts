/**
 * opencode-memory — Explicit Feedback Detection
 *
 * Detects explicit user signals ("记住", "always use", "never use") during
 * conversation. These bypass Dream and are saved directly with
 * confidence: explicit, source: agent_save.
 *
 * Everything else goes through the normal extraction → Dream pipeline.
 *
 * Only truly explicit signals are detected — no guessing.
 */

export interface ExplicitFeedback {
  type: "feedback"
  confidence: "explicit"
  content: string
  pattern: string
}

/**
 * Explicit feedback patterns — user signals that should be saved directly.
 *
 * Chinese: 记住, 以后不要, 永远不要, 一定要
 * English: always use, never use, remember to, don't use
 */
const EXPLICIT_PATTERNS: Array<{ pattern: RegExp; extract: "after" | "full" }> = [
  // Chinese
  { pattern: /记住[,，]?/i, extract: "after" },
  { pattern: /以后不要/i, extract: "full" },
  { pattern: /永远不要/i, extract: "full" },
  { pattern: /一定要/i, extract: "full" },
  // English
  { pattern: /always use/i, extract: "after" },
  { pattern: /never use/i, extract: "full" },
  { pattern: /remember to/i, extract: "after" },
  { pattern: /don['']t use/i, extract: "full" },
]

/**
 * Detect if a message contains an explicit feedback signal.
 * Returns the extracted feedback if found, null otherwise.
 *
 * Only truly explicit signals (user-stated preferences/corrections) are
 * returned. Everything else goes through the normal extraction → Dream path.
 */
export function detectExplicitFeedback(message: string): ExplicitFeedback | null {
  const trimmed = message.trim()
  if (trimmed.length === 0) return null

  for (const { pattern, extract } of EXPLICIT_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match && match.index !== undefined) {
      const content = extract === "after"
        ? trimmed.slice(match.index + match[0].length).trim()
        : trimmed
      if (content.length > 5) {
        return {
          type: "feedback",
          confidence: "explicit",
          content,
          pattern: match[0],
        }
      }
    }
  }
  return null
}

/**
 * Build a memory file content for an explicit feedback.
 * Uses source: agent_save to distinguish from Dream-extracted memories.
 */
export function buildExplicitFeedbackMemory(feedback: ExplicitFeedback): string {
  return [
    "---",
    "name: Explicit Feedback",
    `description: ${feedback.content.slice(0, 100)}`,
    "type: feedback",
    "confidence: explicit",
    "source: agent_save",
    "---",
    "",
    feedback.content,
  ].join("\n")
}
