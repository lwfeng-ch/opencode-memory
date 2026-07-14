/**
 * opencode-memory — Pipeline State (state.json)
 *
 * Persists observability state for the memory pipeline. Every stage
 * (capture, extraction, dream, recall, adapter) writes its lifecycle
 * metadata here. Health score is derived from this state by health.ts.
 *
 * Design principle: state.json is the single source of truth for
 * pipeline health. No stage silently fails — every outcome is recorded.
 */

import { readFile, writeFile, rename, mkdir, unlink } from "fs/promises"
import { dirname } from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineState {
  version: number
  updated_at: string
  health: { score: number; status: string }
  adapter_status: {
    session_create: boolean
    session_messages: boolean
    session_prompt: string
    last_check: string
    errors: string[]
  }
  capture: {
    last_session_id: string | null
    last_capture_at: string | null
    total_sessions_captured: number
  }
  extraction: {
    last_success_at: string | null
    last_failure_at: string | null
    total_successes: number
    total_failures: number
    last_error: string | null
  }
  dream: {
    last_run_at: string | null
    mode: string
    total_runs: number
    last_error: string | null
    messages_since_last: number
  }
  recall: {
    last_query_at: string | null
    total_queries: number
    llm_rerank_used: number
    llm_rerank_failed: number
  }
  events_received: Record<string, { total: number; last_received_at: string | null }>
  memory_pressure: {
    level: "normal" | "elevated" | "critical"
    files: number
    index_size: number
    total_size: number
    last_check: string
  }
}

// ---------------------------------------------------------------------------
// Default state — fresh system, all zeros/nulls
// ---------------------------------------------------------------------------

export const DEFAULT_STATE: PipelineState = {
  version: 1,
  updated_at: "",
  health: { score: 0, status: "unhealthy" },
  adapter_status: {
    session_create: false,
    session_messages: false,
    session_prompt: "untested",
    last_check: "",
    errors: [],
  },
  capture: {
    last_session_id: null,
    last_capture_at: null,
    total_sessions_captured: 0,
  },
  extraction: {
    last_success_at: null,
    last_failure_at: null,
    total_successes: 0,
    total_failures: 0,
    last_error: null,
  },
  dream: {
    last_run_at: null,
    mode: "development",
    total_runs: 0,
    last_error: null,
    messages_since_last: 0,
  },
  recall: {
    last_query_at: null,
    total_queries: 0,
    llm_rerank_used: 0,
    llm_rerank_failed: 0,
  },
  events_received: {},
  memory_pressure: {
    level: "normal" as const,
    files: 0,
    index_size: 0,
    total_size: 0,
    last_check: "",
  },
}

// ---------------------------------------------------------------------------
// State merge — fill missing fields from defaults (forward compatibility)
// ---------------------------------------------------------------------------

/** Merge a parsed (possibly partial) state with DEFAULT_STATE so that
 *  new fields added in future versions don't break old state.json files. */
export function mergeState(parsed: Partial<PipelineState>): PipelineState {
  const d = DEFAULT_STATE
  return {
    version: parsed.version ?? d.version,
    updated_at: parsed.updated_at ?? d.updated_at,
    health: { ...d.health, ...parsed.health },
    adapter_status: { ...d.adapter_status, ...parsed.adapter_status },
    capture: { ...d.capture, ...parsed.capture },
    extraction: { ...d.extraction, ...parsed.extraction },
    dream: { ...d.dream, ...parsed.dream },
    recall: { ...d.recall, ...parsed.recall },
    events_received: parsed.events_received ?? d.events_received,
    memory_pressure: { ...d.memory_pressure, ...parsed.memory_pressure },
  }
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/**
 * Load pipeline state from a JSON file. Falls back to DEFAULT_STATE when
 * the file is missing, unreadable, or contains invalid JSON — the system
 * always starts from a known baseline.
 */
export async function loadState(statePath: string): Promise<PipelineState> {
  try {
    const raw = await readFile(statePath, { encoding: "utf-8" })
    const parsed = JSON.parse(raw) as Partial<PipelineState>
    return mergeState(parsed)
  } catch {
    return mergeState({})
  }
}

/**
 * Atomically write pipeline state to disk.
 *
 * Writes to a unique temp file first, then renames it into place.
 * Unique temp file per call prevents ENOENT races when many concurrent
 * recordEvent() calls write state.json simultaneously.
 *
 * On rename failure (Windows lock, race), falls back to direct write —
 * better to have a valid (non-atomic) state.json than no state.json.
 */
export async function saveState(statePath: string, state: PipelineState): Promise<void> {
  const data = JSON.stringify(state, null, 2)
  // Unique temp file: PID + timestamp + random — prevents concurrent races
  const tmpPath = `${statePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(tmpPath, data, { encoding: "utf-8" })
    await rename(tmpPath, statePath)
  } catch (err) {
    // Best-effort cleanup of the orphaned temp file
    try {
      await unlink(tmpPath)
    } catch {
      // ignore — temp file may not exist or was already renamed
    }
    // Fallback: direct write (non-atomic, but better than no write)
    // This handles Windows rename-lock races gracefully
    try {
      await writeFile(statePath, data, { encoding: "utf-8" })
    } catch {
      // If even direct write fails (disk full, permissions), rethrow original
      throw err
    }
  }
}

// ---------------------------------------------------------------------------
// Read-modify-write
// ---------------------------------------------------------------------------

/**
 * Read the current state, let `updater` mutate it in place, then persist.
 *
 * Always stamps `updated_at` with the current time. Callers should never
 * need to touch `updated_at` themselves.
 *
 * Note: this is a non-locking read-modify-write. Concurrent updates from
 * different stages may lose the last writer's changes. For stages that
 * touch disjoint sub-objects this is acceptable; the integration layer
 * can wrap this with a file lock if serialization is needed.
 */
export async function updateState(
  statePath: string,
  updater: (s: PipelineState) => void,
): Promise<void> {
  const state = await loadState(statePath)
  updater(state)
  state.updated_at = new Date().toISOString()
  await saveState(statePath, state)
}

// ---------------------------------------------------------------------------
// Event tracking
// ---------------------------------------------------------------------------

/**
 * Record that an OpenCode event was received by the plugin.
 *
 * Increments `events_received[eventType].total` and sets
 * `last_received_at`. If `session.idle.total` is 0 after many messages,
 * events aren't reaching the plugin — immediate problem diagnosis.
 */
export async function recordEvent(statePath: string, eventType: string): Promise<void> {
  await updateState(statePath, (s) => {
    if (!s.events_received[eventType]) {
      s.events_received[eventType] = { total: 0, last_received_at: null }
    }
    s.events_received[eventType].total++
    s.events_received[eventType].last_received_at = new Date().toISOString()
  })
}
