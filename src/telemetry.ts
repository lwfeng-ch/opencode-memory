/**
 * opencode-memory — Telemetry: Structured Event Logging
 *
 * Append-only JSONL event log for debugging and audit.
 * Solves the state.json concurrent read-modify-write reliability problem:
 * events are written to daily files with appendFile (no read-modify-write).
 *
 * Two logging systems coexist:
 *   log.ts       — human-readable text log (logs/memory.log), for quick ops
 *   telemetry.ts — machine-queryable JSONL (events/*.jsonl), for precise debugging
 */

import { appendFile, mkdir, readdir, unlink, readFile } from "fs/promises"
import { dirname, join } from "path"

export type TelemetryEventType =
  | "extraction.started"
  | "extraction.completed"
  | "extraction.failed"
  | "extraction.skipped"
  | "dream.started"
  | "dream.completed"
  | "dream.failed"
  | "dream.skipped"
  | "recall.started"
  | "recall.completed"
  | "recall.skipped"
  | "memory_pressure.check"
  | "cursor.updated"

export interface TelemetryEvent {
  timestamp: string
  type: TelemetryEventType
  session_id?: string
  duration_ms?: number
  payload?: Record<string, unknown>
}

function getEventsDir(memoryDir: string): string {
  return join(memoryDir, "events")
}

function getEventFilePath(memoryDir: string, date?: Date): string {
  const d = date ?? new Date()
  const yyyy = String(d.getFullYear())
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return join(getEventsDir(memoryDir), `${yyyy}-${mm}-${dd}.jsonl`)
}

export async function logEvent(
  memoryDir: string,
  event: TelemetryEvent,
): Promise<void> {
  const filePath = getEventFilePath(memoryDir)
  const line = JSON.stringify(event) + "\n"
  try {
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, line, { encoding: "utf-8" })
  } catch {
    // Silent failure — telemetry never affects the pipeline
  }
}

export async function queryEvents(
  memoryDir: string,
  filter: {
    type?: TelemetryEventType
    session_id?: string
    date?: string
  },
): Promise<TelemetryEvent[]> {
  const eventsDir = getEventsDir(memoryDir)
  let files: string[]
  try {
    files = await readdir(eventsDir)
  } catch {
    return []
  }

  let targetFiles: string[]
  if (filter.date) {
    targetFiles = files.filter((f) => f === `${filter.date}.jsonl`)
  } else {
    targetFiles = files.sort().reverse().slice(0, 7)
  }

  const results: TelemetryEvent[] = []
  for (const file of targetFiles) {
    const filePath = join(eventsDir, file)
    try {
      const content = await readFile(filePath, { encoding: "utf-8" })
      for (const line of content.split("\n")) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as TelemetryEvent
          if (filter.type && event.type !== filter.type) continue
          if (filter.session_id && event.session_id !== filter.session_id) continue
          results.push(event)
        } catch { /* skip unparseable lines */ }
      }
    } catch { /* skip unreadable files */ }
  }
  return results
}

export async function cleanupOldEvents(
  memoryDir: string,
  retentionDays: number = 30,
): Promise<number> {
  const eventsDir = getEventsDir(memoryDir)
  let files: string[]
  try {
    files = await readdir(eventsDir)
  } catch {
    return 0
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`

  let deleted = 0
  for (const file of files) {
    const dateStr = file.replace(".jsonl", "")
    if (dateStr < cutoffStr) {
      try {
        await unlink(join(eventsDir, file))
        deleted++
      } catch { /* silent */ }
    }
  }
  return deleted
}
