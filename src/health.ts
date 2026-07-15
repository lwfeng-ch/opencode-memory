/**
 * opencode-memory — Health Score & Status Report
 *
 * Derives a 0-100 health score from PipelineState and formats a
 * human-readable diagnostic report (the `memory_status` tool output).
 *
 * Scoring (100 pts total):
 *   Adapter working     30 pts   session_create && session_messages
 *   Capture active       30 pts   last_capture within mode window
 *   Extraction healthy   20 pts   failures < successes
 *   Dream running        20 pts   last_run within mode window
 *
 * Mode-based activity windows prevent false alarms when the user is
 * simply idle — a normal-mode system that hasn't seen activity in days
 * isn't "unhealthy", it's just idle.
 */

import type { PipelineState, DreamMode } from "./state.js"
import type { MemoryStore } from "./store.js"
import type { MemoryPluginConfig } from "./config.js"

// ---------------------------------------------------------------------------
// Mode-based activity windows (milliseconds)
// ---------------------------------------------------------------------------

const HOUR = 3_600_000
const DAY = 86_400_000

const MODE_WINDOWS: Record<DreamMode, number> = {
  development: HOUR, // 1 hour
  normal: DAY, // 24 hours
  production: 7 * DAY, // 7 days
}

/** Activity window for the given dream mode. Unknown modes fall back to
 *  the `normal` window (24 h) — conservative default. */
function modeWindow(mode: DreamMode): number {
  return MODE_WINDOWS[mode] ?? MODE_WINDOWS.normal
}

// ---------------------------------------------------------------------------
// Health score
// ---------------------------------------------------------------------------

/**
 * Calculate the pipeline health score (0-100) from the current state.
 *
 * Pure function — no I/O, no side effects. The score reflects the
 * system's ability to capture and process memories:
 *
 * | Component         | Weight | Condition                                   |
 * |-------------------|--------|---------------------------------------------|
 * | Adapter working   |   30   | session_create && session_messages          |
 * | Capture active    |   30   | last_capture within mode window (or fresh) |
 * | Extraction healthy|   20   | total_failures < total_successes           |
 * | Dream running     |   20   | last_run within mode window                 |
 *
 * A fresh system (no sessions captured, no extractions, no dream runs)
 * is NOT penalized for capture or extraction — the system just hasn't
 * started yet. Dream, however, requires at least one run to score.
 */
export function calculateHealthScore(state: PipelineState): number {
  let score = 0

  // 1. Adapter working (30 pts)
  if (state.adapter_status.session_create && state.adapter_status.session_messages) {
    score += 30
  }

  // 2. Capture active (30 pts)
  score += captureScore(state)

  // 3. Extraction healthy (20 pts)
  score += extractionScore(state)

  // 4. Dream running (20 pts)
  score += dreamScore(state)

  return Math.min(100, Math.max(0, score))
}

/** Capture is healthy when the last capture is within the mode window.
 *  A brand-new system (no captures, no sessions) gets full credit —
 *  there's nothing wrong with a system that hasn't run yet. */
function captureScore(state: PipelineState): number {
  const { last_capture_at, total_sessions_captured } = state.capture

  // Fresh system — no sessions captured, don't penalize
  if (last_capture_at === null) {
    return total_sessions_captured === 0 ? 30 : 0
  }

  const captureTime = parseTimestamp(last_capture_at)
  if (captureTime === null) return 0 // invalid timestamp

  const window = modeWindow(state.dream.mode)
  const elapsed = Date.now() - captureTime
  return elapsed <= window ? 30 : 0
}

/** Extraction is healthy when failures are fewer than successes.
 *  No extractions yet (0/0) is considered healthy — fresh system. */
function extractionScore(state: PipelineState): number {
  const { total_successes, total_failures } = state.extraction

  if (total_successes === 0) {
    return total_failures === 0 ? 20 : 0
  }
  return total_failures < total_successes ? 20 : 0
}

/** Dream is healthy when the last run is within the mode window.
 *  Unlike capture, a fresh system with no dream run scores 0 — dream
 *  should have run at least once once the system is active. */
function dreamScore(state: PipelineState): number {
  const { last_run_at, mode } = state.dream

  if (last_run_at === null) return 0

  const runTime = parseTimestamp(last_run_at)
  if (runTime === null) return 0 // invalid timestamp

  const window = modeWindow(mode)
  const elapsed = Date.now() - runTime
  return elapsed <= window ? 20 : 0
}

/** Parse an ISO timestamp to epoch millis, or null if invalid. */
function parseTimestamp(iso: string): number | null {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

// ---------------------------------------------------------------------------
// Health status label
// ---------------------------------------------------------------------------

/** Map a 0-100 score to a status label.
 *  - healthy:   >= 80
 *  - degraded:  >= 50
 *  - unhealthy: < 50 */
export function healthStatus(score: number): string {
  if (score >= 80) return "healthy"
  if (score >= 50) return "degraded"
  return "unhealthy"
}

// ---------------------------------------------------------------------------
// Status report formatting
// ---------------------------------------------------------------------------

/**
 * Format the pipeline state into a human-readable diagnostic report.
 *
 * This is the output of the `memory_status` tool. The report covers
 * adapter health, capture, extraction, dream, recall, the computed
 * health score, and event counters.
 *
 * Pure function — takes only state, produces a string. The caller
 * (the tool handler) can prepend a Storage section with file/dir
 * counts that require store access.
 */
export function formatStatusReport(state: PipelineState): string {
  const score = calculateHealthScore(state)
  const status = healthStatus(score)
  const lines: string[] = []

  lines.push("Memory System Status")
  lines.push("")

  // --- Adapter ---
  lines.push("Adapter:")
  lines.push(`  session.create: ${boolLabel(state.adapter_status.session_create)}`)
  lines.push(`  session.messages: ${boolLabel(state.adapter_status.session_messages)}`)
  lines.push(`  session.prompt: ${state.adapter_status.session_prompt}`)
  lines.push(`  Last check: ${formatDateTime(state.adapter_status.last_check)}`)
  for (const err of state.adapter_status.errors) {
    lines.push(`  Error: ${err}`)
  }
  lines.push("")

  // --- Capture ---
  lines.push("Capture (Fact Layer):")
  const captureRel = relativeTime(state.capture.last_capture_at)
  lines.push(
    `  Last capture: ${formatDateTime(state.capture.last_capture_at)}` +
      (captureRel ? ` (${captureRel})` : ""),
  )
  lines.push(`  Total sessions: ${state.capture.total_sessions_captured}`)
  lines.push("")

  // --- Extraction ---
  lines.push("Extraction:")
  lines.push(`  Last success: ${formatDateTime(state.extraction.last_success_at)}`)
  lines.push(
    `  Last failure: ${formatFailure(state.extraction.last_failure_at, state.extraction.last_error)}`,
  )
  lines.push(
    `  Stats: ${state.extraction.total_successes} success, ${state.extraction.total_failures} failed`,
  )
  lines.push("")

  // --- Dream ---
  lines.push("Dream:")
  lines.push(`  Mode: ${state.dream.mode}`)
  lines.push(`  Last run: ${formatDateTime(state.dream.last_run_at)}`)
  lines.push(`  Stats: ${state.dream.total_runs} runs total`)
  if (state.dream.last_error) {
    lines.push(`  Last error: ${state.dream.last_error}`)
  }
  lines.push("")

  // --- Recall ---
  lines.push("Recall:")
  lines.push(`  Last query: ${formatDateTime(state.recall.last_query_at)}`)
  lines.push(
    `  Stats: ${state.recall.total_queries} queries, ${state.recall.llm_rerank_used} rerank used, ${state.recall.llm_rerank_failed} rerank failed`,
  )
  lines.push("")

  // --- Health ---
  lines.push(`Health Score: ${score}/100 (${status})`)
  lines.push("")

  // --- Events ---
  lines.push("Events received:")
  const entries = Object.entries(state.events_received).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )
  if (entries.length === 0) {
    lines.push("  (none)")
  } else {
    for (const [eventType, info] of entries) {
      lines.push(
        `  ${eventType}: ${info.total} (last: ${formatDateTime(info.last_received_at)})`,
      )
    }
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format an ISO timestamp as "YYYY-MM-DD HH:MM" (local time), or
 *  "never" when null/empty. */
function formatDateTime(iso: string | null): string {
  if (!iso) return "never"
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return "invalid"
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`
}

/** Human-readable relative time: "just now", "30 min ago", "2 hours ago",
 *  "3 days ago". Returns "" for null or future timestamps. */
function relativeTime(iso: string | null): string {
  if (!iso) return ""
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  if (diff < 0) return "" // future timestamp — don't show relative

  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`

  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? "s" : ""} ago`
}

/** Format a failure line: timestamp + optional error context. */
function formatFailure(failureAt: string | null, lastError: string | null): string {
  if (!failureAt) return "none"
  const ts = formatDateTime(failureAt)
  if (lastError) return `${ts} (${lastError})`
  return ts
}

/** Boolean → "working" / "failed" label. */
function boolLabel(value: boolean): string {
  return value ? "working" : "failed"
}

// ---------------------------------------------------------------------------
// Memory pressure detection (3-level)
// ---------------------------------------------------------------------------

export type PressureLevel = "normal" | "elevated" | "critical"

export interface MemoryPressureReport {
  level: PressureLevel
  fileCount: number
  indexSize: number
  totalSize: number
  lastCheck: string
}

/**
 * Detect current memory pressure level.
 *
 * Three signals (strongest wins):
 *   1. fileCount / maxFiles
 *   2. indexSize / maxIndexSize
 *   3. totalSize / maxTotalSize (estimated by sampling)
 *
 * Levels:
 *   normal   — all ratios < elevatedRatio (0.7)
 *   elevated — any ratio >= elevatedRatio but < criticalRatio
 *   critical — any ratio >= criticalRatio (0.9)
 *
 * Pure computation + I/O (store.list, store.read, store.getIndex).
 * Zero LLM calls.
 */
export async function checkMemoryPressure(
  store: MemoryStore,
  config: MemoryPluginConfig,
): Promise<MemoryPressureReport> {
  const memories = await store.list()
  const index = await store.getIndex()
  const indexSize = index ? Buffer.byteLength(index, "utf-8") : 0

  // Estimate total size by sampling first 50 files
  let sampledSize = 0
  const sampleCount = Math.min(50, memories.length)
  for (const m of memories.slice(0, sampleCount)) {
    try {
      const content = await store.read(m.filename)
      sampledSize += Buffer.byteLength(content, "utf-8")
    } catch {
      // skip unreadable files
    }
  }
  const avgSize = sampleCount > 0 ? sampledSize / sampleCount : 0
  const totalSize = Math.round(avgSize * memories.length)

  const { maxFiles, maxIndexSize, maxTotalSize, elevatedRatio, criticalRatio } = config.memoryPressure
  const fileRatio = memories.length / maxFiles
  const indexRatio = indexSize / maxIndexSize
  const totalRatio = totalSize / maxTotalSize
  const maxRatio = Math.max(fileRatio, indexRatio, totalRatio)

  let level: PressureLevel = "normal"
  if (maxRatio >= criticalRatio) level = "critical"
  else if (maxRatio >= elevatedRatio) level = "elevated"

  return {
    level,
    fileCount: memories.length,
    indexSize,
    totalSize,
    lastCheck: new Date().toISOString(),
  }
}
