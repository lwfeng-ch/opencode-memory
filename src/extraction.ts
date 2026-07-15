/**
 * opencode-memory — Extraction: Fact-to-Knowledge Transformer
 *
 * Reads the immutable fact record (captured by capture.ts) plus a recent
 * message snapshot, sends them to an extraction LLM sub-agent, and writes
 * the distilled output to semantic/sessions/session_xxx.md with provenance
 * frontmatter.
 *
 * Design principle: the fact record is the PRIMARY input — not the raw
 * conversation. Extraction is a fact-to-knowledge transformer. LLM failure
 * does not lose data; the fact record is already on disk. Processing
 * metadata tracks the extraction lifecycle for retry policy.
 *
 * See: docs/specs/2026-07-10-memory-infrastructure-design.md § Processing Layer → tryExtraction
 */

import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname, join } from "path"
import type { MemoryPluginConfig, MemoryHeader } from "./config.js"
import { resolveAgentConfig } from "./config.js"
import type { MemoryStore } from "./store.js"
import type { RuntimeAdapter } from "./adapter.js"
import { getFactSessionPath, getProcessingDir } from "./paths.js"
import { updateState } from "./state.js"
import { info as logInfo, error as logError } from "./log.js"
import { readCursor, writeCursor } from "./cursor.js"
import { logEvent } from "./telemetry.js"
import { scoreMemory } from "./recall.js"
import { shouldMerge } from "./fingerprint.js"
import { readMessages } from "./message-cache.js"

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

/**
 * Fact record shape (mirrors capture.ts FactSessionRecord — not imported
 * from capture.ts to avoid coupling; this is a read-only JSON consumer).
 */
interface FactSessionRecord {
  $id: string
  session_id: string
  created_at: string
  ended_at: string
  project: string
  project_dir: string
  runtime: {
    opencode_version: string
    plugin_version: string
    model: string
  }
  git: {
    branch: string
    head: string
    changed_files: Array<{ path: string; changes: string }>
  }
  stats: {
    messages: number
    tool_calls: number
    duration_minutes: number
  }
  events: Array<{
    type: string
    name: string
    success: boolean
    duration_ms: number
  }>
  integrity: {
    hash: string
  }
}

/** Extraction failure classification for retry policy. */
type FailureType = "timeout" | "model_unavailable" | "invalid_schema" | "permission_denied" | null

/** Extraction lifecycle status stored in processing metadata. */
interface ExtractionStatus {
  status: "done" | "failed"
  attempts: number
  last_error: string | null
  retry_after: string | null
  failure_type: FailureType
  semantic_file: string | null
}

/** Processing metadata file shape (mutable, updated per extraction attempt). */
interface ProcessingMetadata {
  $id: string
  session_id: string
  extraction: ExtractionStatus
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Compute the relative path for a session's semantic memory file.
 *
 * The returned path sits under `semantic/sessions/` so the store's
 * path-traversal guard provides a safety net.
 */
function sessionSemanticPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "-")
  return `semantic/sessions/session_${safe}.md`
}

/**
 * Get the absolute path for the processing metadata status file.
 *
 * Path: <memoryDir>/processing/extraction/session_xxx.status.json
 */
function getProcessingMetadataPath(memoryDir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "-")
  return join(getProcessingDir(memoryDir), "extraction", `session_${safe}.status.json`)
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
function extractConversationText(messages: unknown[]): string {
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
function buildExtractionPrompt(
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
 */
function extractResponseText(response: unknown): string {
  if (typeof response === "string") return response
  if (response === null || typeof response !== "object") return ""
  const obj = response as Record<string, unknown>

  if (typeof obj.content === "string") return obj.content
  if (typeof obj.response === "string") return obj.response
  if (typeof obj.text === "string") return obj.text

  // Handle SDK message shape: { info: AssistantMessage, parts: [{ type: "text", text: "..." }] }
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
// Fact record formatting
// ---------------------------------------------------------------------------

/**
 * Format a fact record into a human-readable summary for the extraction
 * prompt. Provides the LLM with factual context (stats, git state, tool
 * events) without the full conversation — the conversation comes from the
 * message snapshot.
 */
function formatFactSummary(record: FactSessionRecord): string {
  const lines: string[] = [
    `Session: ${record.session_id}`,
    `Project: ${record.project}`,
    `Duration: ${record.stats.duration_minutes} minutes`,
    `Messages: ${record.stats.messages}`,
    `Tool calls: ${record.stats.tool_calls}`,
    `Created: ${record.created_at}`,
    `Ended: ${record.ended_at}`,
  ]

  if (record.git.branch) {
    lines.push(`Git branch: ${record.git.branch}`)
  }
  if (record.git.head) {
    lines.push(`Git HEAD: ${record.git.head}`)
  }
  if (record.git.changed_files.length > 0) {
    lines.push("Changed files:")
    for (const f of record.git.changed_files) {
      lines.push(`  ${f.path} (${f.changes})`)
    }
  }
  if (record.events.length > 0) {
    lines.push("Tool events:")
    for (const e of record.events) {
      const status = e.success ? "success" : "failed"
      lines.push(`  ${e.name} (${e.type}, ${status}, ${e.duration_ms}ms)`)
    }
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Existing memories formatting
// ---------------------------------------------------------------------------

/**
 * Format existing memory headers — filtered to top-K most relevant.
 * Borrows Qwen Code's recall-selection concept: don't give the model all
 * memories, give it the relevant ones. Reduces prompt token waste by 60-80%.
 *
 * @param headers  - All memory headers from the store
 * @param queryText - Text to score against (fact summary)
 * @param maxItems  - Maximum memories to include (default: 10)
 */
function formatExistingMemories(
  headers: MemoryHeader[],
  queryText: string,
  maxItems: number = 10,
): string {
  const memories = headers.filter((m) => m.type !== undefined)
  if (memories.length === 0) return "(none)"

  const scored = memories
    .map((m) => ({ header: m, score: scoreMemory(queryText, m) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems)

  if (scored.length === 0) return "(none)"

  return scored
    .map(({ header: m }) => {
      const tag = m.scope !== undefined && m.type !== undefined
        ? `[${m.scope}:${m.type}]`
        : m.type !== undefined
          ? `[${m.type}]`
          : ""
      const desc = m.description !== null ? `: ${m.description}` : ""
      return `- ${tag} ${m.filename}${desc}`
    })
    .join("\n")
}

// ---------------------------------------------------------------------------
// Provenance frontmatter
// ---------------------------------------------------------------------------

/**
 * Build provenance frontmatter for a semantic session memory file.
 *
 * Schema v2 provenance links the extracted memory back to its source fact
 * record via `fact_id`, and marks the confidence level as `inferred`
 * (LLM extraction inferred this from facts).
 */
function buildProvenanceFrontmatter(
  sessionId: string,
  name?: string | null,
  description?: string | null,
): string {
  const lines = [
    "---",
    "type: project",
  ]
  if (name) lines.push(`name: ${name}`)
  if (description) lines.push(`description: ${description}`)
  lines.push(
    "source:",
    "  kind: extraction",
    `  fact_id: ${sessionId}`,
    "confidence:",
    "  level: inferred",
    "schema_version: 2",
    "---",
    "",
  )
  return lines.join("\n")
}

/**
 * Strip leading YAML frontmatter from a file's content.
 *
 * Used when reading an existing semantic session memory file for
 * incremental update — the frontmatter is added back after the LLM
 * produces the updated content.
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (match) return content.slice(match[0].length)
  return content
}

/**
 * Parse name and description from LLM-generated frontmatter.
 * @returns `{ name, description, body }` — body has frontmatter stripped.
 *          If no frontmatter found, name/description are null, body = input.
 */
function parseSemanticFrontmatter(
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

// ---------------------------------------------------------------------------
// Failure classification and retry policy
// ---------------------------------------------------------------------------

/**
 * Classify an extraction failure into a retry-policy category.
 *
 * The classification determines whether the failure is retryable and
 * how long to wait before retrying.
 *
 * - `timeout` → retryable, retry on next idle
 * - `model_unavailable` → retryable, retry after 1 hour
 * - `invalid_schema` → NOT retryable (fix the prompt first)
 * - `permission_denied` → NOT retryable (manual intervention)
 * - `null` (unknown) → retryable with 1 hour delay
 */
function classifyFailure(err: unknown): FailureType {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted")) {
    return "timeout"
  }
  if (
    lower.includes("unavailable") ||
    lower.includes("econnrefused") ||
    lower.includes("503") ||
    lower.includes("502") ||
    lower.includes("connection")
  ) {
    return "model_unavailable"
  }
  if (
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("403") ||
    lower.includes("unauthorized")
  ) {
    return "permission_denied"
  }
  if (lower.includes("schema") || lower.includes("invalid")) {
    return "invalid_schema"
  }

  return null
}

/**
 * Compute the `retry_after` timestamp for a given failure type.
 *
 * - `timeout` → now (eligible for retry on next idle event)
 * - `model_unavailable` → +1 hour
 * - `invalid_schema` → null (not retryable)
 * - `permission_denied` → null (not retryable)
 * - `null` (unknown) → +1 hour
 */
function computeRetryAfter(failureType: FailureType): string | null {
  const now = new Date()
  switch (failureType) {
    case "timeout":
      return now.toISOString()
    case "model_unavailable":
      return new Date(now.getTime() + 3_600_000).toISOString()
    case "invalid_schema":
      return null
    case "permission_denied":
      return null
    default:
      return new Date(now.getTime() + 3_600_000).toISOString()
  }
}

// ---------------------------------------------------------------------------
// Processing metadata read/write
// ---------------------------------------------------------------------------

/**
 * Read the existing processing metadata for a session.
 *
 * Returns null if the file doesn't exist or is unreadable — the caller
 * treats this as a fresh extraction (attempts = 0).
 */
async function readProcessingMetadata(
  memoryDir: string,
  sessionId: string,
): Promise<ProcessingMetadata | null> {
  try {
    const path = getProcessingMetadataPath(memoryDir, sessionId)
    const raw = await readFile(path, { encoding: "utf-8" })
    return JSON.parse(raw) as ProcessingMetadata
  } catch {
    return null
  }
}

/**
 * Write processing metadata for a session.
 *
 * Merges with any existing file content to preserve other sections (e.g.,
 * dream status) that may have been written by other pipeline stages.
 * The `extraction` section is always fully replaced.
 */
async function writeProcessingMetadata(
  memoryDir: string,
  sessionId: string,
  extraction: ExtractionStatus,
): Promise<void> {
  const path = getProcessingMetadataPath(memoryDir, sessionId)

  // Preserve existing sections (e.g., dream) by merging
  let existing: Record<string, unknown> = {}
  try {
    const raw = await readFile(path, { encoding: "utf-8" })
    existing = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // File doesn't exist yet — fresh metadata
  }

  const metadata: Record<string, unknown> = {
    ...existing,
    $id: `memory://processing-extraction/${sessionId}`,
    session_id: sessionId,
    extraction,
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(metadata, null, 2), { encoding: "utf-8" })
}

// ---------------------------------------------------------------------------
// State recording helpers
// ---------------------------------------------------------------------------

/**
 * Record an extraction failure: write processing metadata, update state.json,
 * and log to stderr. Never throws — all errors are swallowed.
 */
async function recordExtractionFailure(
  memoryDir: string,
  sessionId: string,
  statePath: string,
  errorMsg: string,
  failureType: FailureType,
): Promise<void> {
  const retryAfter = computeRetryAfter(failureType)
  const now = new Date().toISOString()

  // Read existing attempts count and increment
  const existing = await readProcessingMetadata(memoryDir, sessionId)
  const attempts = (existing?.extraction.attempts ?? 0) + 1

  // Write processing metadata (failure)
  try {
    await writeProcessingMetadata(memoryDir, sessionId, {
      status: "failed",
      attempts,
      last_error: errorMsg,
      retry_after: retryAfter,
      failure_type: failureType,
      semantic_file: null,
    })
  } catch {
    // Best-effort — state.json is the fallback record
  }

  // Update state.json
  try {
    await updateState(statePath, (s) => {
      s.extraction.total_failures++
      s.extraction.last_failure_at = now
      s.extraction.last_error = errorMsg
    })
  } catch {
    // Non-critical — extraction is advisory
  }

  logError("memory:extraction", `session=${sessionId} error=${errorMsg}`)
}

/**
 * Record an extraction success: write processing metadata, update state.json,
 * and log to stdout. Never throws — all errors are swallowed.
 */
async function recordExtractionSuccess(
  memoryDir: string,
  sessionId: string,
  statePath: string,
  semanticFile: string,
): Promise<void> {
  const now = new Date().toISOString()

  // Read existing attempts count and increment
  const existing = await readProcessingMetadata(memoryDir, sessionId)
  const attempts = (existing?.extraction.attempts ?? 0) + 1

  // Write processing metadata (success)
  try {
    await writeProcessingMetadata(memoryDir, sessionId, {
      status: "done",
      attempts,
      last_error: null,
      retry_after: null,
      failure_type: null,
      semantic_file: semanticFile,
    })
  } catch {
    // Best-effort — state.json is the fallback record
  }

  // Update state.json
  try {
    await updateState(statePath, (s) => {
      s.extraction.total_successes++
      s.extraction.last_success_at = now
    })
  } catch {
    // Non-critical — extraction is advisory
  }

  logInfo("memory:extraction", `session=${sessionId} success`)
}

// ---------------------------------------------------------------------------
// Extraction entrypoint
// ---------------------------------------------------------------------------

/**
 * Run extraction on a session.
 *
 * Reads the immutable fact record (captured by capture.ts) plus a recent
 * message snapshot, sends them to an extraction LLM sub-agent via the
 * RuntimeAdapter, and writes the distilled output to
 * `semantic/sessions/session_xxx.md` with provenance frontmatter.
 *
 * The extraction runs in its own sub-session via `adapter.session.create`
 * so it does not pollute the main agent's context window.
 *
 * After each attempt (success or failure), processing metadata is written
 * to `processing/extraction/session_xxx.status.json` with retry policy
 * information, and state.json is updated.
 *
 * All failures are caught and logged — extraction never throws. The fact
 * record is already on disk, so LLM failure only delays knowledge
 * formation, it does not lose data.
 *
 * @param sessionId  - The ID of the session to extract.
 * @param memoryDir  - Absolute path to the memory directory.
 * @param store      - The memory store for reading/writing semantic files.
 * @param config     - Plugin configuration (extraction settings).
 * @param adapter    - Runtime adapter for session/prompt/message access.
 * @param statePath  - Absolute path to state.json.
 *
 * @returns `{ success: true }` on completion, or `{ success: false, error }`
 *          on any failure.
 */
export async function extractSessionMemory(
  sessionId: string,
  memoryDir: string,
  store: MemoryStore,
  config: MemoryPluginConfig,
  adapter: RuntimeAdapter,
  statePath: string,
): Promise<{ success: boolean; error?: string }> {
  const semanticFile = sessionSemanticPath(sessionId)
  const t0 = Date.now()

  void logEvent(memoryDir, {
    timestamp: new Date().toISOString(),
    type: "extraction.started",
    session_id: sessionId,
  })

  try {
    // ────────────────────────────────────────────────────────────────────
    // Step 1: Read the fact record (immutable, already captured)
    //
    // The fact record is the PRIMARY input. If it doesn't exist, capture
    // didn't run — extraction cannot proceed. This is a failure, but the
    // raw conversation is still in the OpenCode session history (just not
    // captured as a structured fact record).
    // ────────────────────────────────────────────────────────────────────
    const factPath = getFactSessionPath(memoryDir, sessionId)
    let factRecord: FactSessionRecord
    try {
      const raw = await readFile(factPath, { encoding: "utf-8" })
      factRecord = JSON.parse(raw) as FactSessionRecord
    } catch {
      const errorMsg = `No fact record found for session ${sessionId} at ${factPath}`
      await recordExtractionFailure(memoryDir, sessionId, statePath, errorMsg, null)
      return { success: false, error: errorMsg }
    }

    // ────────────────────────────────────────────────────────────────────
    // Step 2: Read existing session notes (for incremental update)
    //
    // If a previous extraction wrote a semantic session memory file, read
    // it so the LLM can update it incrementally rather than starting from
    // scratch. The provenance frontmatter is stripped before sending to
    // the LLM — it's re-added after the LLM produces output.
    // ────────────────────────────────────────────────────────────────────
    let currentContent: string
    const fileExists = await store.exists(semanticFile)
    if (fileExists) {
      try {
        const raw = await store.read(semanticFile)
        currentContent = stripFrontmatter(raw)
      } catch {
        currentContent = DEFAULT_SESSION_MEMORY_TEMPLATE
      }
    } else {
      currentContent = DEFAULT_SESSION_MEMORY_TEMPLATE
    }

    if (currentContent.trim().length === 0) {
      currentContent = DEFAULT_SESSION_MEMORY_TEMPLATE
    }

    // ────────────────────────────────────────────────────────────────────
    // Step 2.5: Read extraction cursor (for incremental processing)
    // ────────────────────────────────────────────────────────────────────
    const cursor = await readCursor(memoryDir, sessionId)
    const cursorOffset = cursor?.processedMessageOffset ?? 0

    // ────────────────────────────────────────────────────────────────────
    // Step 3: Read recent message snapshot (incremental — only new messages)
    //
    // Priority: local message cache (P1) → SDK API (fallback)
    // The cursor offset ensures we only process new messages.
    // ────────────────────────────────────────────────────────────────────
    let messages: unknown[] = []
    const safeOffset = cursorOffset

    // Try local cache first (decoupled from SDK API)
    try {
      const cached = await readMessages(memoryDir, sessionId, safeOffset)
      if (cached.length > 0) {
        messages = cached.map((m) => ({ role: m.role, content: m.content }))
      }
    } catch {
      // Cache read failed — fall through to SDK
    }

    // Fallback: SDK API if cache was empty
    if (messages.length === 0) {
      try {
        const allMessages = await adapter.session.messages(sessionId, 500)
        const sdkOffset = cursorOffset > allMessages.length ? 0 : cursorOffset
        messages = allMessages.slice(sdkOffset)
      } catch {
        // Message snapshot is optional — fact record provides context
      }
    }

    // If no new messages since last cursor, skip extraction (just update timestamp)
    if (messages.length === 0) {
      await writeCursor(memoryDir, {
        sessionId,
        processedMessageOffset: cursorOffset,
        lastProcessedAt: new Date().toISOString(),
        lastTouchedFiles: [],
      })
    await recordExtractionSuccess(memoryDir, sessionId, statePath, semanticFile)

    void logEvent(memoryDir, {
      timestamp: new Date().toISOString(),
      type: "extraction.completed",
      session_id: sessionId,
      duration_ms: Date.now() - t0,
    })
      return { success: true }
    }
    const conversationText = extractConversationText(messages)

    // ────────────────────────────────────────────────────────────────────
    // Step 4: Build fact summary (used for both existing memories filtering
    // and the extraction prompt)
    // ────────────────────────────────────────────────────────────────────
    const factSummary = formatFactSummary(factRecord)

    // ────────────────────────────────────────────────────────────────────
    // Step 5: Read existing semantic memories (avoid duplicate extraction)
    //
    // The prompt includes a manifest of existing memories so the LLM
    // knows what's already been saved and doesn't recreate duplicates.
    // Uses factSummary to filter to top-K relevant memories.
    // ────────────────────────────────────────────────────────────────────
    let existingMemories = "(none)"
    try {
      const headers = await store.list()
      existingMemories = formatExistingMemories(headers, factSummary)
    } catch {
      // Listing failed — proceed without existing memories list
    }

    // ────────────────────────────────────────────────────────────────────
    // Step 6: Build the extraction prompt
    // ────────────────────────────────────────────────────────────────────
    const prompt = buildExtractionPrompt(
      currentContent,
      conversationText,
      config.extraction.maxSectionLength,
      factSummary,
      existingMemories,
    )

    // ────────────────────────────────────────────────────────────────────
    // Step 6: Spawn an extraction sub-agent session
    //
    // The extraction agent runs in its own session with the configured
    // category (default: "quick"). This avoids injecting extraction
    // tokens into the main agent's context.
    // ────────────────────────────────────────────────────────────────────
    let extractSessionId: string
    try {
      const createOpts = resolveAgentConfig(config, "extraction")
      const extractSession = await adapter.session.create(createOpts)
      extractSessionId = extractSession.id
    } catch (err: unknown) {
      const errorMsg = `Failed to create extraction agent session: ${
        err instanceof Error ? err.message : "unknown error"
      }`
      await recordExtractionFailure(
        memoryDir,
        sessionId,
        statePath,
        errorMsg,
        classifyFailure(err),
      )
      return { success: false, error: errorMsg }
    }

    // ────────────────────────────────────────────────────────────────────
    // Step 7: Send the prompt and collect the response
    //
    // Uses adapter.session.prompt() (NOT chat()). The prompt is sent to
    // the sub-agent session created in Step 6.
    // ────────────────────────────────────────────────────────────────────
    let response: unknown
    try {
      const promptOpts: { agent?: string; model?: string } = {}
      if (config.models.extraction) promptOpts.model = config.models.extraction
      response = await adapter.session.prompt(extractSessionId, prompt, promptOpts)
    } catch (err: unknown) {
      const errorMsg = `Extraction agent prompt failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`
      await recordExtractionFailure(
        memoryDir,
        sessionId,
        statePath,
        errorMsg,
        classifyFailure(err),
      )
      return { success: false, error: errorMsg }
    }

    const responseText = extractResponseText(response)

    if (!responseText || responseText.trim().length === 0) {
      const errorMsg = "Extraction agent returned empty response"
      await recordExtractionFailure(
        memoryDir,
        sessionId,
        statePath,
        errorMsg,
        null,
      )
      return { success: false, error: errorMsg }
    }

    // ────────────────────────────────────────────────────────────────────
    // Step 8: Parse LLM frontmatter, validate, and write to store
    //
    // The LLM response may include YAML frontmatter with name/description.
    // We parse it out, validate the body, then prepend provenance frontmatter
    // (with optional name/description) before writing.
    // ────────────────────────────────────────────────────────────────────
    const { name, description, body: responseBody } = parseSemanticFrontmatter(responseText)

    // Validate the body (without frontmatter)
    const { validateExtractionOutput } = await import("./extraction-validator.js")
    const validation = validateExtractionOutput(responseBody)
    if (!validation.valid) {
      const errorMsg = `Extraction output validation failed: ${validation.errors.join("; ")}`
      logError("memory:extraction", `session=${sessionId} validation: ${validation.errors.join("; ")}`)
      await recordExtractionFailure(memoryDir, sessionId, statePath, errorMsg, null)
      return { success: false, error: errorMsg }
    }

    const provenance = buildProvenanceFrontmatter(sessionId, name, description)
    const semanticContent = provenance + responseBody

    // Update extraction cursor (must happen regardless of write/dedup skip)
    const newOffset = (cursorOffset > messages.length ? 0 : cursorOffset) + messages.length
    await writeCursor(memoryDir, {
      sessionId,
      processedMessageOffset: newOffset,
      lastProcessedAt: new Date().toISOString(),
      lastTouchedFiles: [semanticFile],
    })

    // Check semantic fingerprint for dedup — skip write if > 80% similar to existing
    const existing = await store.exists(semanticFile) ? await store.read(semanticFile) : ""
    if (existing && shouldMerge(existing, semanticContent)) {
      logInfo("memory:extraction", `session=${sessionId} skipped duplicate (fingerprint match)`)
      await recordExtractionSuccess(memoryDir, sessionId, statePath, semanticFile)
      return { success: true }
    }

    await store.write(semanticFile, semanticContent)

    // ────────────────────────────────────────────────────────────────────
    // Step 9: Record success — processing metadata + state.json
    // ────────────────────────────────────────────────────────────────────
    await recordExtractionSuccess(memoryDir, sessionId, statePath, semanticFile)

    return { success: true }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Unknown extraction error"
    await recordExtractionFailure(
      memoryDir,
      sessionId,
      statePath,
      errorMsg,
      null,
    )
    return { success: false, error: errorMsg }
  }
}
