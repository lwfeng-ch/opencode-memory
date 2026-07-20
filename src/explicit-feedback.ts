/**
 * opencode-memory — Explicit Feedback Detection (v0.3.3 tightened)
 *
 * Detects explicit user signals ("记住", "always use", "never use") during
 * conversation. These bypass Dream and are saved directly with
 * confidence: explicit, source: agent_save.
 *
 * v0.3.3: Three-condition detection — must satisfy ALL:
 *   1. Feedback signal (记住/always use/never use/以后不要)
 *   2. Action intent (do/don't/switch/avoid)
 *   3. User authority (directive voice, NOT descriptive)
 *
 * Everything else goes through the normal extraction → Dream pipeline.
 */

export interface ExplicitFeedback {
  type: "feedback"
  confidence: "explicit"
  content: string
  pattern: string
}

/**
 * Pattern with action intent requirement flag.
 * If requiresAction=true, the content after the signal must contain an action verb.
 * "always use X" has action built in → requiresAction=false.
 * "记住..." needs action check → requiresAction=true.
 */
interface ExplicitPattern {
  pattern: RegExp
  extract: "after" | "full"
  requiresAction: boolean
}

const EXPLICIT_PATTERNS: ExplicitPattern[] = [
  // Chinese directive signals
  { pattern: /记住[,，]?\s*/i, extract: "after", requiresAction: true },
  { pattern: /以后(?:不要|不|统一|必须|应该)/i, extract: "full", requiresAction: false },
  { pattern: /永远(?:不要|不)/i, extract: "full", requiresAction: false },
  { pattern: /(?:从现在|今后)(?:起|开始)/i, extract: "after", requiresAction: true },
  // English directive signals
  { pattern: /always\s+use\b/i, extract: "full", requiresAction: false },
  { pattern: /never\s+use\b/i, extract: "full", requiresAction: false },
  { pattern: /from\s+now\s+on\b/i, extract: "after", requiresAction: true },
  { pattern: /remember\s+to\b/i, extract: "after", requiresAction: true },
  { pattern: /make\s+sure\s+(?:to|you)/i, extract: "after", requiresAction: true },
  { pattern: /don['']t\s+use\b/i, extract: "full", requiresAction: false },
]

/** Action verbs — must be present when requiresAction=true */
const ACTION_VERBS = [
  // Chinese
  "使用", "不用", "不要", "避免", "改用", "统一", "必须", "应该", "禁止", "切换", "用",
  // English
  "use", "avoid", "switch", "prefer", "stop", "start", "always", "never", "don",
]

/** Descriptive patterns — if matched, reject the signal (not user authority) */
const DESCRIPTIVE_PATTERNS = [
  /用户(?:说|提到|反馈|表示|认为|喜欢|偏好|擅长)/i,
  /the\s+user\s+(?:mentioned|said|stated|reported|indicated|likes|prefers|is)/i,
  /i\s+received\s+feedback/i,
]

function hasActionIntent(text: string): boolean {
  const lower = text.toLowerCase()
  return ACTION_VERBS.some(verb => lower.includes(verb))
}

function isDescriptive(text: string): boolean {
  return DESCRIPTIVE_PATTERNS.some(p => p.test(text))
}

/**
 * Detect if a message contains an explicit feedback signal.
 *
 * v0.3.3: Three-condition check:
 *   1. Signal pattern matches
 *   2. Action intent present (if requiresAction)
 *   3. NOT descriptive (user authority)
 *
 * Returns the extracted feedback if ALL conditions met, null otherwise.
 */
export function detectExplicitFeedback(message: string): ExplicitFeedback | null {
  const trimmed = message.trim()
  if (trimmed.length === 0) return null

  // Condition 3: reject descriptive messages early
  if (isDescriptive(trimmed)) return null

  for (const { pattern, extract, requiresAction } of EXPLICIT_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match && match.index !== undefined) {
      const content = extract === "after"
        ? trimmed.slice(match.index + match[0].length).trim()
        : trimmed

      if (content.length > 5) {
        // Condition 2: action intent check
        if (requiresAction && !hasActionIntent(content)) {
          continue
        }

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
