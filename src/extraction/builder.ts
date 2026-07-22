/**
 * opencode-memory — Extraction Prompt Builder (v0.3.4 Phase 4)
 *
 * Prompt construction functions for the extraction pipeline.
 * Migrated from src/extraction.ts.
 */

import type { Message } from "./types.js"

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
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build the prompt sent to the extraction LLM agent.
 *
 * Includes:
 * - Current session notes (for incremental update)
 * - Fact record summary (from the immutable fact layer)
 * - Recent message snapshot (conversation text)
 * - Existing semantic memories (to avoid duplicate extraction)
 *
 * The rules are designed to produce stable, info-dense output that
 * preserves the template structure.
 */
export function buildExtractionPrompt(
  currentContent: string,
  conversationText: string,
  maxSectionLength: number,
  factSummary: string,
  existingMemories: string,
): string {
  const sections = [
    "Based on the fact record and conversation below, update the session notes file.",
    "",
    "Current notes:",
    "<current_notes>",
    currentContent,
    "</current_notes>",
    "",
    "Fact Record Summary:",
    "<fact_record>",
    factSummary,
    "</fact_record>",
    "",
    "Conversation (recent message snapshot):",
    "<conversation>",
    conversationText,
    "</conversation>",
    "",
    "Existing memories (do NOT duplicate these):",
    "<existing_memories>",
    existingMemories,
    "</existing_memories>",
    "",
    "Rules:",
    "- Start your output with YAML frontmatter:",
    '  ---',
    '  name: "Session: <short topic>"',
    '  description: "<5-10 word summary of what this session covered>"',
    '  ---',
    "- Maintain section headers and italic descriptions exactly",
    "- Only update content BELOW the italic descriptions",
    "- Write detailed, info-dense content (file paths, function names, errors)",
    "- Skip sections with no new info — don't add filler",
    `- Keep each section under ${maxSectionLength} tokens`,
    '- Always update "Current State" to reflect most recent work',
    "- Do NOT recreate memories that already exist in <existing_memories>",
    "",
    "Output the COMPLETE file content (frontmatter + sections).",
  ]

  return sections.join("\n")
}

// ---------------------------------------------------------------------------
// v0.3.2: extractMemories() prompt helpers
// ---------------------------------------------------------------------------

/**
 * Default system prompt for memory extraction.
 * Instructs the LLM to extract structured memory candidates from messages.
 */
export const DEFAULT_EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction system. Extract structured memories from the conversation below.

Output a JSON array of memory objects. Each object must have exactly these fields:
- name: short title (5-10 words, specific to the subject)
- description: one-line hook for relevance matching (10-20 words)
- content: detailed information preserving facts, context, and rationale
- type: one of "user", "feedback", "project", "reference"
- scope: one of "user" (cross-project) or "project" (this project only)
- confidence: one of "explicit" (explicitly stated), "inferred" (you deduced), "uncertain" (not sure)

Rules:
- Only extract factual, non-trivial information that would be useful in a future conversation
- Do NOT extract code patterns, function names, or build commands (derivable from codebase)
- Do NOT extract git history (derivable from git)
- Do NOT extract conversation ephemera like "ok", "let me check", "I see"
- If nothing worth extracting, return an empty array []
- Respond ONLY with the JSON array, no markdown, no explanation`

/**
 * Format messages into a simple text for the extraction prompt.
 * Each section: "## Role\\ncontent"
 */
export function formatMessagesForExtraction(messages: Message[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    const role = msg.role === "system" ? "System" : msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "Tool"
    const text = (msg.content ?? "").trim()
    if (text.length > 0) {
      lines.push(`## ${role}`)
      lines.push(text)
      lines.push("")
    }
  }
  return lines.join("\n").trim()
}