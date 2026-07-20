/**
 * opencode-memory — Audit Log Tests (v0.3.3)
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { AuditLog } from "../../src/repair/audit.js"
import { generateActionId, type RepairAction } from "../../src/repair/candidate.js"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"

describe("AuditLog", () => {
  const testDir = join(tmpdir(), `repair-audit-test-${randomBytes(4).toString("hex")}`)
  const logFile = join(testDir, "audit.log")

  beforeEach(() => {
    try { mkdirSync(testDir, { recursive: true }) } catch {}
  })

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
  })

  test("log writes entry and getAll reads it", async () => {
    const log = new AuditLog(logFile)
    const action: RepairAction = {
      id: generateActionId(),
      type: "archive",
      filename: "test.md",
      timestamp: Date.now(),
      approvedBy: "cli",
      reason: "stale",
      result: "success",
    }
    await log.log(action)
    const all = await log.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].type).toBe("archive")
    expect(all[0].filename).toBe("test.md")
  })

  test("getAll returns empty when file doesn't exist", async () => {
    const log = new AuditLog(join(testDir, "nonexistent.log"))
    const all = await log.getAll()
    expect(all).toEqual([])
  })

  test("multiple entries are appended in order", async () => {
    const log = new AuditLog(logFile)
    for (let i = 0; i < 3; i++) {
      await log.log({
        id: generateActionId(),
        type: "delete",
        filename: `file${i}.md`,
        timestamp: Date.now(),
        approvedBy: "cli",
        reason: `reason${i}`,
        result: "success",
      })
    }
    const all = await log.getAll()
    expect(all).toHaveLength(3)
    expect(all[0].filename).toBe("file0.md")
    expect(all[2].filename).toBe("file2.md")
  })

  test("query filters by type", async () => {
    const log = new AuditLog(logFile)
    await log.log({
      id: generateActionId(), type: "archive", filename: "a.md",
      timestamp: 0, approvedBy: "cli", reason: "r", result: "success",
    })
    await log.log({
      id: generateActionId(), type: "delete", filename: "b.md",
      timestamp: 0, approvedBy: "cli", reason: "r", result: "success",
    })
    const archives = await log.query({ type: "archive" })
    expect(archives).toHaveLength(1)
    expect(archives[0].filename).toBe("a.md")
  })

  test("query filters by filename", async () => {
    const log = new AuditLog(logFile)
    await log.log({
      id: generateActionId(), type: "delete", filename: "target.md",
      timestamp: 0, approvedBy: "cli", reason: "r", result: "success",
    })
    await log.log({
      id: generateActionId(), type: "delete", filename: "other.md",
      timestamp: 0, approvedBy: "cli", reason: "r", result: "success",
    })
    const results = await log.query({ filename: "target.md" })
    expect(results).toHaveLength(1)
    expect(results[0].filename).toBe("target.md")
  })

  test("log creates directory if it doesn't exist", async () => {
    const nestedLog = new AuditLog(join(testDir, "nested", "deep", "audit.log"))
    await nestedLog.log({
      id: generateActionId(), type: "archive", filename: "test.md",
      timestamp: Date.now(), approvedBy: "cli", reason: "test", result: "success",
    })
    const all = await nestedLog.getAll()
    expect(all).toHaveLength(1)
  })
})
