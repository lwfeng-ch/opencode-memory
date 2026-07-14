import { describe, test, expect } from "vitest"
import { getFactRootDir, getCursorDir, getCursorPath } from "../src/paths.js"
import { readCursor, writeCursor, type ExtractionCursor } from "../src/cursor.js"
import { mkdtemp, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("cursor path helpers", () => {
  test("getFactRootDir returns <memoryDir>/fact/ not fact/sessions/", () => {
    const result = getFactRootDir("/tmp/mem")
    expect(result).toBe(join("/tmp/mem", "fact"))
    expect(result).not.toContain("sessions")
  })

  test("getCursorDir returns <memoryDir>/fact/cursor/", () => {
    const result = getCursorDir("/tmp/mem")
    expect(result).toBe(join("/tmp/mem", "fact", "cursor"))
  })

  test("getCursorPath returns extraction-cursor.json path", () => {
    const result = getCursorPath("/tmp/mem")
    expect(result).toBe(join("/tmp/mem", "fact", "cursor", "extraction-cursor.json"))
  })
})

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cursor-test-"))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("cursor read/write", () => {
  test("readCursor returns null when file missing", async () => {
    await withTmpDir(async (tmpDir) => {
      const result = await readCursor(tmpDir, "ses_123")
      expect(result).toBeNull()
    })
  })

  test("writeCursor then readCursor returns same data", async () => {
    await withTmpDir(async (tmpDir) => {
      const cursor: ExtractionCursor = {
        sessionId: "ses_123",
        processedMessageOffset: 42,
        lastProcessedAt: "2026-07-14T00:00:00Z",
        lastTouchedFiles: ["user_pref.md"],
      }
      await writeCursor(tmpDir, cursor)
      const result = await readCursor(tmpDir, "ses_123")
      expect(result).toEqual(cursor)
    })
  })

  test("readCursor returns null when sessionId mismatch", async () => {
    await withTmpDir(async (tmpDir) => {
      await writeCursor(tmpDir, {
        sessionId: "ses_A",
        processedMessageOffset: 10,
        lastProcessedAt: "2026-07-14T00:00:00Z",
        lastTouchedFiles: [],
      })
      const result = await readCursor(tmpDir, "ses_B")
      expect(result).toBeNull()
    })
  })
})
