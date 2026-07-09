/**
 * opencode-memory — KAIROS Session Memory Extraction
 *
 * KAIROS (Key-point Accumulation In Real-time, Optimized for Storage):
 * Append-only during the active session (main agent writes terse log entries
 * to daily logs at zero LLM cost). A structured batch extraction fires on
 * session.idle: it reads the full conversation history, distills key
 * information into a structured session-notes file, and writes it to
 * session-memory/{sessionId}.md.
 *
 * This two-phase approach separates:
 * 1. Write-heavy logging (no model call, main agent's appended entries)
 * 2. Occasional structured extraction (one LLM call per idle event)
 *
 * The resulting session memory file serves as a compact, queryable snapshot
 * that the recall pipeline can surface in future sessions.
 */

import type { MemoryPluginConfig, AgentSessionCreateOptions } from "./config.js"
import type { MemoryStore } from "./store.js"

// ---------------------------------------------------------------------------
// Default template
// ---------------------------------------------------------------------------

/**
 * Default markdown template for session memory files.
 *
 * Each section has a header (H2) followed by an italic description line.
 * The extraction prompt explicitly preserves these structural anchors and
 * only rewrites the content beneath them. This lets the template evolve
 * without breaking existing extraction runs.
 */
export const DEFAULT_SESSION_MEMORY_TEMPLATE: string = [
  "# Session Title",
  "_A short 5-10 word title_",
  "",
  "# Current State",
  "_What is being worked on right now? Pending tasks, next steps._",
  "",
  "# Task Specification",
  "_What did the user ask for? Design decisions, context._",
  "",
  "# Files & Functions",
  "_Important files, what they contain, why relevant._",
  "",
  "# Workflow",
  "_Common commands, order, how to interpret output._",
  "",
  "# Errors & Corrections",
  "_Errors encountered, fixes, failed approaches._",
  "",
  "# Learnings",
  "_What worked, what didn't, what to avoid._",
  "",
  "# Worklog",
  "_Step-by-step terse summary._",
  "",
].join("\n")

// ---------------------------------------------------------------------------
// Types — minimal session message shapes (provider-agnostic)
// ---------------------------------------------------------------------------

/**
 * Minimal representation of a chat message for extraction purposes.
 *
 * OpenCode's session API returns messages in various provider-specific
 * shapes. This interface captures only the fields we need; the extraction
 * code gracefully handles missing fields via type guards.
 */
interface ContentPart {
  type: string
  text?: string
}

interface SessionMessage {
  role?: string
  content?: string | ContentPart[]
}

// ---------------------------------------------------------------------------
// Session memory file helpers
// ---------------------------------------------------------------------------

/**
 * Compute the relative path for a session's memory file within the store.
 *
 * The returned path sits under `session-memory/` so the store's path-traversal
 * guard (`resolvePath` rejects `..` sequences) provides a safety net.
 */
function sessionMemoryPath(sessionId: string): string {
  // Allow only safe characters — strip anything that could confuse the
  // filesystem or the store's path resolver.
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "-")
  return `session-memory/${safe}.md`
}

/**
 * Extract human-readable conversation text from an array of message objects.
 *
 * Handles both string content and multi-part arrays (OpenAI-style content
 * blocks with `{ type: "text", text: "..." }`).
 */
function extractConversationText(messages: SessionMessage[]): string {
  const lines: string[] = []

  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue

    const label = msg.role === "user" ? "User" : "Assistant"
    let text: string

    if (typeof msg.content === "string") {
      text = msg.content
    } else if (Array.isArray(msg.content)) {
      // Multi-part content blocks
      text = msg.content
        .filter(
          (part) =>
            (part.type === "text" || part.type === "text_delta") &&
            typeof part.text === "string",
        )
        .map((part) => part.text!)
        .join("\n")
    } else {
      text = String(msg.content ?? "")
    }

    if (text.trim().length > 0) {
      lines.push(`## ${label}`, text, "")
    }
  }

  return lines.join("\n").trim()
}

/**
 * Build the prompt sent to the extraction LLM agent.
 *
 * Includes the current session notes (for incremental update) and the full
 * conversation text. The rules are designed to produce stable, info-dense
 * output that preserves the template structure.
 */
function buildExtractionPrompt(
  currentContent: string,
  conversationText: string,
  maxSectionLength: number,
): string {
  const sections = [
    "Based on the conversation below, update the session notes file.",
    "",
    "Current notes:",
    "<current_notes>",
    currentContent,
    "</current_notes>",
    "",
    "Conversation:",
    "<conversation>",
    conversationText,
    "</conversation>",
    "",
    "Rules:",
    "- Maintain section headers and italic descriptions exactly",
    "- Only update content BELOW the italic descriptions",
    "- Write detailed, info-dense content (file paths, function names, errors)",
    "- Skip sections with no new info — don't add filler",
    `- Keep each section under ${maxSectionLength} tokens`,
    '- Always update "Current State" to reflect most recent work',
    "",
    "Output the COMPLETE updated file content.",
  ]

  return sections.join("\n")
}

/**
 * Safely extract the response text from an LLM agent's reply.
 *
 * Handles multiple response shapes across provider boundaries:
 * - Plain string
 * - `{ content: string }`
 * - `{ message: { content: string } }`
 * - `{ choices: [{ message: { content: string } }] }` (legacy OpenAI)
 */
function extractResponseText(response: unknown): string {
  if (typeof response === "string") return response
  if (response === null || typeof response !== "object") return ""
  const obj = response as Record<string, unknown>

  if (typeof obj.content === "string") return obj.content

  const message = obj.message
  if (message !== null && typeof message === "object") {
    const msgObj = message as Record<string, unknown>
    if (typeof msgObj.content === "string") return msgObj.content
  }

  if (Array.isArray(obj.choices)) {
    const first = obj.choices[0]
    if (first !== null && typeof first === "object") {
      const firstObj = first as Record<string, unknown>
      const firstMsg = firstObj.message
      if (firstMsg !== null && typeof firstMsg === "object") {
        const msgObj = firstMsg as Record<string, unknown>
        if (typeof msgObj.content === "string") return msgObj.content
      }
      if (typeof firstObj.text === "string") return firstObj.text
    }
  }

  return ""
}

// ---------------------------------------------------------------------------
// Extraction entrypoint
// ---------------------------------------------------------------------------

/**
 * Run KAIROS extraction on a session.
 *
 * Reads the session's message history, sends it (along with any existing
 * session notes) to an extraction LLM sub-agent, and writes the distilled
 * output back to the session memory file.
 *
 * The extraction runs in its own sub-session via `client.session.create` so
 * it does not pollute the main agent's context window. Failures are reported
 * gracefully — extraction is advisory, not critical path.
 *
 * @param sessionId - The ID of the session whose messages to extract.
 * @param store     - The memory store for reading/writing session notes.
 * @param config    - Plugin configuration (extraction settings).
 * @param client    - OpenCode client API for session operations.
 *
 * @returns `{ success: true }` on completion, or `{ success: false, error }`
 *          on any failure.
 */
export async function extractSessionMemory(
  sessionId: string,
  store: MemoryStore,
  config: MemoryPluginConfig,
  client: {
    session: {
      create: (opts: AgentSessionCreateOptions) => Promise<{ id: string }>
      chat: (id: string, opts: { message: string }) => Promise<unknown>
      messages: (id: string) => Promise<SessionMessage[]>
    }
  },
): Promise<{ success: boolean; error?: string }> {
  const filename = sessionMemoryPath(sessionId)

  try {
    // ────────────────────────────────────────────────────────────────
    // Step 1: Bootstrap session notes if they don't exist yet
    // ────────────────────────────────────────────────────────────────
    const exists = await store.exists(filename)
    if (!exists) {
      await store.write(filename, DEFAULT_SESSION_MEMORY_TEMPLATE)
    }

    // ────────────────────────────────────────────────────────────────
    // Step 2: Read current content (fresh from disk, may differ from
    //         what we just wrote if a concurrent extraction raced us)
    // ────────────────────────────────────────────────────────────────
    let currentContent: string
    try {
      currentContent = await store.read(filename)
    } catch {
      // File was deleted between exists() and read() — re-bootstrap
      await store.write(filename, DEFAULT_SESSION_MEMORY_TEMPLATE)
      currentContent = DEFAULT_SESSION_MEMORY_TEMPLATE
    }

    if (currentContent.trim().length === 0) {
      // Empty file from a prior write — reset to template
      currentContent = DEFAULT_SESSION_MEMORY_TEMPLATE
    }

    // ────────────────────────────────────────────────────────────────
    // Step 3: Fetch session messages and extract conversation text
    // ────────────────────────────────────────────────────────────────
    const messages = await client.session.messages(sessionId)
    const conversationText = extractConversationText(messages)

    if (conversationText.length === 0) {
      // No user or assistant messages to extract from — this is not an
      // error, just nothing to do.
      return { success: true }
    }

    // ────────────────────────────────────────────────────────────────
    // Step 4: Build the extraction prompt
    // ────────────────────────────────────────────────────────────────
    const prompt = buildExtractionPrompt(
      currentContent,
      conversationText,
      config.extraction.maxSectionLength,
    )

    // ────────────────────────────────────────────────────────────────
    // Step 5: Spawn an extraction sub-agent
    //
    // The extraction agent runs in its own session with the configured
    // category (default: "quick"). This avoids injecting extraction
    // tokens into the main agent's context.
    //
    // Wrapped in try/catch for graceful degradation — if the agent
    // framework is unavailable, we report the failure and move on.
    // ────────────────────────────────────────────────────────────────
    let extractSessionId: string
    try {
      const createOpts: AgentSessionCreateOptions = { agent: config.extraction.category }
      if (config.models.extraction) createOpts.model = config.models.extraction
      const extractSession = await client.session.create(createOpts)
      extractSessionId = extractSession.id
    } catch {
      return {
        success: false,
        error: "Failed to create extraction agent session",
      }
    }

    // ────────────────────────────────────────────────────────────────
    // Step 6: Send the prompt and collect the response
    // ────────────────────────────────────────────────────────────────
    let response: unknown
    try {
      response = await client.session.chat(extractSessionId, {
        message: prompt,
      })
    } catch (err: unknown) {
      return {
        success: false,
        error: `Extraction agent chat failed: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      }
    }

    const responseText = extractResponseText(response)

    if (!responseText || responseText.trim().length === 0) {
      return {
        success: false,
        error: "Extraction agent returned empty response",
      }
    }

    // ────────────────────────────────────────────────────────────────
    // Step 7: Write the distilled output back to the session memory file
    // ────────────────────────────────────────────────────────────────
    await store.write(filename, responseText)

    return { success: true }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown extraction error"
    return { success: false, error: message }
  }
}
