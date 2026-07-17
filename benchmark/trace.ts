/**
 * opencode-memory — LLM Trace Logger
 *
 * Records per-LLM-call trace entries to a JSONL file.
 * Enables model comparison: cost, latency, token usage alongside quality scores.
 */

import { dirname } from "node:path"
import { mkdir } from "node:fs/promises"

/** A single trace entry for one LLM call during a benchmark run. */
export interface LLMTraceEntry {
  requestId: string
  model: string
  caseId: string
  repeatIndex: number
  latencyMs: number
  tokens: { input: number; output: number }
  cacheHit: boolean
  timestamp: string
  error?: string
}

/**
 * Append-only JSONL trace logger for LLM calls.
 *
 * Each entry is one JSON line appended to a trace file.
 * Supports querying by model and/or caseId.
 */
export class LLMTraceLogger {
  constructor(private traceFile: string = "benchmark/trace/llm-trace.jsonl") {}

  /** Append a trace entry to the log file. Creates the directory if needed. */
  async log(entry: LLMTraceEntry): Promise<void> {
    const dir = dirname(this.traceFile)
    try {
      await mkdir(dir, { recursive: true })
    } catch {
      // Directory may already exist
    }

    const line = JSON.stringify(entry) + "\n"

    // Read existing content (if any), append new line
    let existing = ""
    try {
      existing = await Bun.file(this.traceFile).text()
    } catch {
      // File doesn't exist yet — start fresh
    }
    await Bun.write(this.traceFile, existing + line)
  }

  /**
   * Query trace entries with optional filters.
   * Reads the full JSONL file and returns matching entries.
   */
  async query(filter: {
    model?: string
    caseId?: string
  }): Promise<LLMTraceEntry[]> {
    let text: string
    try {
      text = await Bun.file(this.traceFile).text()
    } catch {
      return []
    }

    const lines = text.split("\n").filter((l) => l.trim().length > 0)
    const entries: LLMTraceEntry[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LLMTraceEntry
        if (filter.model && entry.model !== filter.model) continue
        if (filter.caseId && entry.caseId !== filter.caseId) continue
        entries.push(entry)
      } catch {
        // Skip malformed lines
      }
    }

    return entries
  }
}
