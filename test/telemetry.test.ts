import { describe, test, expect } from "vitest"
import { logEvent, queryEvents, cleanupOldEvents } from "../src/telemetry.js"
import { mkdtemp, rm, readFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "telemetry-"))
  try { return await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

describe("logEvent", () => {
  test("writes JSONL file", async () => {
    await withTmpDir(async (dir) => {
      await logEvent(dir, { timestamp: "2026-07-14T00:00:00Z", type: "extraction.started" })
      const events = await queryEvents(dir, {})
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("extraction.started")
    })
  })

  test("appends multiple events to same file", async () => {
    await withTmpDir(async (dir) => {
      await logEvent(dir, { timestamp: "2026-07-14T00:00:00Z", type: "extraction.started" })
      await logEvent(dir, { timestamp: "2026-07-14T00:00:01Z", type: "extraction.completed", duration_ms: 1000 })
      const events = await queryEvents(dir, {})
      expect(events).toHaveLength(2)
      expect(events[1].duration_ms).toBe(1000)
    })
  })

  test("failure is silent — does not throw", async () => {
    // Read-only path should not throw
    await logEvent("/dev/null", { timestamp: "2026-07-14T00:00:00Z", type: "memory_pressure.check" })
    // If no throw, test passes
  })
})

describe("queryEvents", () => {
  test("filters by type", async () => {
    await withTmpDir(async (dir) => {
      await logEvent(dir, { timestamp: "2026-07-14T00:00:00Z", type: "extraction.started" })
      await logEvent(dir, { timestamp: "2026-07-14T00:00:01Z", type: "dream.started" })
      const extractionEvents = await queryEvents(dir, { type: "extraction.started" })
      expect(extractionEvents).toHaveLength(1)
      expect(extractionEvents[0].type).toBe("extraction.started")
    })
  })

  test("filters by session_id", async () => {
    await withTmpDir(async (dir) => {
      await logEvent(dir, { timestamp: "2026-07-14T00:00:00Z", type: "extraction.started", session_id: "ses_A" })
      await logEvent(dir, { timestamp: "2026-07-14T00:00:01Z", type: "extraction.started", session_id: "ses_B" })
      const filtered = await queryEvents(dir, { session_id: "ses_A" })
      expect(filtered).toHaveLength(1)
      expect(filtered[0].session_id).toBe("ses_A")
    })
  })

  test("returns empty for non-existent dir", async () => {
    const events = await queryEvents("/nonexistent", {})
    expect(events).toEqual([])
  })

  test("skips unparseable lines", async () => {
    await withTmpDir(async (dir) => {
      // Write a valid event
      await logEvent(dir, { timestamp: "2026-07-14T00:00:00Z", type: "extraction.started" })
      // Append garbage line to the file
      const { appendFile } = await import("fs/promises")
      const files = await import("fs/promises")
      const { readdir } = files
      const dirEntries = await readdir(join(dir, "events"))
      await appendFile(join(dir, "events", dirEntries[0]), "garbage line\n")
      // Query should still return 1 valid event
      const events = await queryEvents(dir, {})
      expect(events).toHaveLength(1)
    })
  })
})

describe("cleanupOldEvents", () => {
  test("returns 0 for non-existent dir", async () => {
    const deleted = await cleanupOldEvents("/nonexistent", 30)
    expect(deleted).toBe(0)
  })

  test("does not delete recent files", async () => {
    await withTmpDir(async (dir) => {
      await logEvent(dir, { timestamp: "2026-07-14T00:00:00Z", type: "extraction.started" })
      const deleted = await cleanupOldEvents(dir, 30)
      expect(deleted).toBe(0)
    })
  })
})
