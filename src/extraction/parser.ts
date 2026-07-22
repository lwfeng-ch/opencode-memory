/**
 * opencode-memory — Extraction LLM Response Parser (v0.3.4 Phase 4)
 *
 * Parses LLM responses from the extraction pipeline.
 * Migrated from src/extraction.ts.
 *
 * Handles 6+ response shapes: plain string, {content}, {message.content},
 * OpenAI {choices}, DashScope {output.text}, {text}.
 */

import type { MemoryCandidate } from "./types.js"

// ---------------------------------------------------------------------------
// Response extraction
// ---------------------------------------------------------------------------

/**
 * Safely extract the response text from an LLM agent's reply.
 *
 * Handles multiple response shapes across provider boundaries:
 * - Plain string
 * - `{ content: string }`
 * - `{ message: { content: string } }`
 * - `{ choices: [{ message: { content: string } }] }` (legacy OpenAI)
 * - `{ output: { text: string } }` (DashScope)
 * - `{ parts: [{ type: "text", text: "..." }] }` (SDK message)
 */
export function extractResponseText(response: unknown): string {
  if (typeof response === "string") return response
  if (response === null || typeof response !== "object") return ""
  const obj = response as Record<string, unknown>

  if (typeof obj.content === "string") return obj.content
  if (typeof obj.response === "string") return obj.response
  if (typeof obj.text === "string") return obj.text

  // DashScope shape: { output: { text: string } }
  if (obj.output && typeof obj.output === "object") {
    const out = obj.output as Record<string, unknown>
    if (typeof out.text === "string") return out.text
  }

  // Handle SDK message shape: { parts: [{ type: "text", text: "..." }] }
  if (Array.isArray(obj.parts)) {
    const textParts = (obj.parts as Array<Record<string, unknown>>)
      .filter((p) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
    if (textParts.length > 0) return textParts.join("\n")
  }

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
// Minimal session message types (provider-agnostic)
// ---------------------------------------------------------------------------

interface ContentPart {
  type: string
  text?: string
}

interface SessionMessage {
  role?: string
  content?: string | ContentPart[]
}

// ---------------------------------------------------------------------------
// Conversation text extraction
// ---------------------------------------------------------------------------

/**
 * Extract human-readable conversation text from an array of message objects.
 *
 * Handles both string content and multi-part arrays (OpenAI-style content
 * blocks with `{ type: "text", text: "..." }`).
 */
export function extractConversationText(messages: unknown[]): string {
  const lines: string[] = []

  for (const raw of messages) {
    const msg = raw as SessionMessage
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

// ---------------------------------------------------------------------------
// LLM response parsing
// ---------------------------------------------------------------------------

/**
 * Parse the LLM response into MemoryCandidate[].
 * Supports both pure JSON arrays and JSON embedded in markdown code blocks.
 */
export function parseExtractionResponse(raw: string): MemoryCandidate[] {
  const trimmed = raw.trim()

  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed as MemoryCandidate[]
    }
  } catch {
    // Not pure JSON — try extracting from code block
  }

  // Try extracting JSON from markdown code block
  const jsonMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim())
      if (Array.isArray(parsed)) {
        return parsed as MemoryCandidate[]
      }
    } catch {
      // Not valid JSON in code block
    }
  }

  // Try to find any array-like structure in the text
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0])
      if (Array.isArray(parsed)) {
        return parsed as MemoryCandidate[]
      }
    } catch {
      // Parse failed
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// Semantic frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse name and description from LLM-generated frontmatter.
 * @returns `{ name, description, body }` — body has frontmatter stripped.
 *          If no frontmatter found, name/description are null, body = input.
 */
export function parseSemanticFrontmatter(
  content: string,
): { name: string | null; description: string | null; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) {
    return { name: null, description: null, body: content }
  }

  const yaml = match[1]
  const body = content.slice(match[0].length)

  let name: string | null = null
  let description: string | null = null

  for (const line of yaml.split(/\r?\n/)) {
    const nameMatch = line.match(/^name:\s*(.*)$/)
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^["']|["']$/g, "")
    }
    const descMatch = line.match(/^description:\s*(.*)$/)
    if (descMatch) {
      description = descMatch[1].trim().replace(/^["']|["']$/g, "")
    }
  }

  return { name, description, body }
}