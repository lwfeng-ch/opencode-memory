/**
 * opencode-memory — Cursor: Incremental Extraction Tracking
 *
 * Tracks message processing offset per session so extraction only
 * processes NEW messages since the last extraction run.
 *
 * Complements the Fact Layer:
 *   Fact Layer = session metadata snapshot (zero LLM, immutable)
 *   Cursor     = message processing progress (zero LLM, mutable)
 */

import { readFile, writeFile, mkdir, rename } from "fs/promises"
import { dirname } from "path"
import { getCursorPath } from "./paths.js"

export interface ExtractionCursor {
  /** Session ID — cross-session reset (mismatch → offset 0) */
  sessionId: string
  /** Number of messages already processed */
  processedMessageOffset: number
  /** ISO timestamp of last processing */
  lastProcessedAt: string
  /** Memory files touched in last extraction */
  lastTouchedFiles: string[]
}

export async function readCursor(
  memoryDir: string,
  sessionId: string,
): Promise<ExtractionCursor | null> {
  try {
    const cursorPath = getCursorPath(memoryDir)
    const raw = await readFile(cursorPath, { encoding: "utf-8" })
    const cursor = JSON.parse(raw) as ExtractionCursor
    // Cross-session check: return null if sessionId doesn't match
    if (cursor.sessionId !== sessionId) return null
    return cursor
  } catch {
    return null // File doesn't exist = first extraction
  }
}

export async function writeCursor(
  memoryDir: string,
  cursor: ExtractionCursor,
): Promise<void> {
  const cursorPath = getCursorPath(memoryDir)
  await mkdir(dirname(cursorPath), { recursive: true })
  // Atomic write: temp file + rename (same pattern as state.ts)
  const tmpPath = `${cursorPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmpPath, JSON.stringify(cursor, null, 2) + "\n", { encoding: "utf-8" })
  try {
    await rename(tmpPath, cursorPath)
  } catch {
    // rename failed (cross-device?) — direct write fallback
    await writeFile(cursorPath, JSON.stringify(cursor, null, 2) + "\n", { encoding: "utf-8" })
  }
}
