/**
 * opencode-memory — Extraction Writer (v0.3.4 Phase 4)
 *
 * Memory persistence and formatting functions for the extraction pipeline.
 * Migrated from src/extraction.ts.
 */

import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname, join } from "path"
import type { MemoryHeader } from "../config.js"
import { getProcessingDir } from "../paths.js"
import { updateState } from "../state.js"
import { scoreMemory } from "./../evaluation/scoring.js"
import { info as logInfo, error as logError } from "../log.js"

// ---------------------------------------------------------------------------
// Fact record types (read-only JSON consumer — not imported from capture.ts)
// ---------------------------------------------------------------------------

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
 */
export function sessionSemanticPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "-")
  return `semantic/sessions/session_${safe}.md`
}

/**
 * Get the absolute path for the processing metadata status file.
 */
export function getProcessingMetadataPath(memoryDir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "-")
  return join(getProcessingDir(memoryDir), "extraction", `session_${safe}.status.json`)
}

// ---------------------------------------------------------------------------
// Fact record formatting
// ---------------------------------------------------------------------------

/**
 * Format a fact record into a human-readable summary for the extraction prompt.
 */
export function formatFactSummary(record: FactSessionRecord): string {
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
 */
export function formatExistingMemories(
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
 */
export function buildProvenanceFrontmatter(
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
 */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (match) return content.slice(match[0].length)
  return content
}

// ---------------------------------------------------------------------------
// Failure classification and retry policy
// ---------------------------------------------------------------------------

/**
 * Classify an extraction failure into a retry-policy category.
 */
export function classifyFailure(err: unknown): FailureType {
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
 */
export function computeRetryAfter(failureType: FailureType): string | null {
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
 */
export async function readProcessingMetadata(
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
 */
export async function writeProcessingMetadata(
  memoryDir: string,
  sessionId: string,
  extraction: ExtractionStatus,
): Promise<void> {
  const path = getProcessingMetadataPath(memoryDir, sessionId)

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
export async function recordExtractionFailure(
  memoryDir: string,
  sessionId: string,
  statePath: string,
  errorMsg: string,
  failureType: FailureType,
): Promise<void> {
  const retryAfter = computeRetryAfter(failureType)
  const now = new Date().toISOString()

  const existing = await readProcessingMetadata(memoryDir, sessionId)
  const attempts = (existing?.extraction.attempts ?? 0) + 1

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
    // Best-effort
  }

  try {
    await updateState(statePath, (s) => {
      s.extraction.total_failures++
      s.extraction.last_failure_at = now
      s.extraction.last_error = errorMsg
    })
  } catch {
    // Non-critical
  }

  logError("memory:extraction", `session=${sessionId} error=${errorMsg}`)
}

/**
 * Record an extraction success: write processing metadata, update state.json,
 * and log to stdout. Never throws — all errors are swallowed.
 */
export async function recordExtractionSuccess(
  memoryDir: string,
  sessionId: string,
  statePath: string,
  semanticFile: string,
): Promise<void> {
  const now = new Date().toISOString()

  const existing = await readProcessingMetadata(memoryDir, sessionId)
  const attempts = (existing?.extraction.attempts ?? 0) + 1

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
    // Best-effort
  }

  try {
    await updateState(statePath, (s) => {
      s.extraction.total_successes++
      s.extraction.last_success_at = now
    })
  } catch {
    // Non-critical
  }

  logInfo("memory:extraction", `session=${sessionId} success`)
}