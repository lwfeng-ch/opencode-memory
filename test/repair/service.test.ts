/**
 * opencode-memory — Repair Service Tests (v0.3.3)
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { RepairService } from "../../src/repair/service.js"
import { AuditLog } from "../../src/repair/audit.js"
import { generateCandidateId } from "../../src/repair/candidate.js"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs"

function makeMemoryFile(dir: string, filename: string, content: string): string {
  const filepath = join(dir, filename)
  writeFileSync(filepath, content, "utf-8")
  return filepath
}

const SAMPLE_MEMORY = `---
name: Test Memory
description: A test memory
type: user
confidence: explicit
scope: user
---

This is the memory body content.
`

describe("RepairService", () => {
  const testDir = join(tmpdir(), `repair-service-test-${randomBytes(4).toString("hex")}`)
  const auditFile = join(testDir, "lifecycle", "repair", "audit.log")
  let repair: RepairService
  let auditLog: AuditLog

  beforeEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, "lifecycle", "repair"), { recursive: true })
    auditLog = new AuditLog(auditFile)
    repair = new RepairService(testDir, auditLog)
  })

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
  })

  test("archive sets frontmatter status=archived, file stays at same path", async () => {
    makeMemoryFile(testDir, "test.md", SAMPLE_MEMORY)
    await repair.archive("test.md", "stale session")
    expect(existsSync(join(testDir, "test.md"))).toBe(true) // file NOT moved
    const content = readFileSync(join(testDir, "test.md"), "utf-8")
    expect(content).toContain("status: archived")
    expect(content).toContain("archivedAt:")
  })

  test("archive writes audit entry", async () => {
    makeMemoryFile(testDir, "test.md", SAMPLE_MEMORY)
    await repair.archive("test.md", "stale session")
    const log = await auditLog.getAll()
    expect(log).toHaveLength(1)
    expect(log[0].type).toBe("archive")
    expect(log[0].filename).toBe("test.md")
    expect(log[0].result).toBe("success")
  })

  test("delete removes file and writes audit entry", async () => {
    makeMemoryFile(testDir, "test.md", SAMPLE_MEMORY)
    await repair.delete("test.md", "legacy duplicate")
    expect(existsSync(join(testDir, "test.md"))).toBe(false)
    const log = await auditLog.getAll()
    expect(log).toHaveLength(1)
    expect(log[0].type).toBe("delete")
    expect(log[0].result).toBe("success")
  })

  test("restore sets status=active and clears archivedAt", async () => {
    makeMemoryFile(testDir, "test.md", SAMPLE_MEMORY)
    await repair.archive("test.md", "stale")
    await repair.restore("test.md")
    const content = readFileSync(join(testDir, "test.md"), "utf-8")
    expect(content).toContain("status: active")
    expect(content).toContain("archivedAt: null")
  })

  test("restore writes audit entry", async () => {
    makeMemoryFile(testDir, "test.md", SAMPLE_MEMORY)
    await repair.archive("test.md", "stale")
    await repair.restore("test.md")
    const log = await auditLog.getAll()
    expect(log.length).toBeGreaterThanOrEqual(2)
    const restoreEntry = log.find(a => a.type === "restore")
    expect(restoreEntry).toBeDefined()
    expect(restoreEntry!.result).toBe("success")
  })

  test("archive throws for non-existent file", async () => {
    await expect(repair.archive("nonexistent.md", "test")).rejects.toThrow("File not found")
  })

  test("delete throws for non-existent file", async () => {
    await expect(repair.delete("nonexistent.md", "test")).rejects.toThrow("File not found")
  })

  test("restore throws for non-existent file", async () => {
    await expect(repair.restore("nonexistent.md")).rejects.toThrow("File not found")
  })

  test("archive on file without frontmatter creates frontmatter", async () => {
    makeMemoryFile(testDir, "nofm.md", "Just body content, no frontmatter.")
    await repair.archive("nofm.md", "test")
    const content = readFileSync(join(testDir, "nofm.md"), "utf-8")
    expect(content).toContain("status: archived")
    expect(content).toContain("---")
  })

  test("executeCandidate dispatches to archive or delete", async () => {
    makeMemoryFile(testDir, "archive-target.md", SAMPLE_MEMORY)
    makeMemoryFile(testDir, "delete-target.md", SAMPLE_MEMORY)

    const archiveCandidate = {
      id: generateCandidateId(),
      type: "stale_session" as const,
      action: "archive" as const,
      source: "archive-target.md",
      reason: "stale",
      metadata: { size: 100, createdAt: 0, lastModified: 0 },
      preview: { title: "T", description: "D", sections: [] },
      risk: "low" as const,
      status: "pending" as const,
      createdAt: Date.now(),
    }
    await repair.executeCandidate(archiveCandidate)
    const archived = readFileSync(join(testDir, "archive-target.md"), "utf-8")
    expect(archived).toContain("status: archived")

    const deleteCandidate = {
      id: generateCandidateId(),
      type: "legacy_v1" as const,
      action: "delete" as const,
      source: "delete-target.md",
      reason: "legacy",
      metadata: { size: 100, createdAt: 0, lastModified: 0 },
      preview: { title: "T", description: "D", sections: [] },
      risk: "low" as const,
      status: "pending" as const,
      createdAt: Date.now(),
    }
    await repair.executeCandidate(deleteCandidate)
    expect(existsSync(join(testDir, "delete-target.md"))).toBe(false)
  })

  test("audit log records failure on error", async () => {
    await expect(repair.delete("nonexistent.md", "test")).rejects.toThrow()
    const log = await auditLog.getAll()
    expect(log).toHaveLength(1)
    expect(log[0].result).toBe("failure")
    expect(log[0].error).toBeDefined()
  })

  test("getAuditLog returns all entries", async () => {
    makeMemoryFile(testDir, "a.md", SAMPLE_MEMORY)
    makeMemoryFile(testDir, "b.md", SAMPLE_MEMORY)
    await repair.archive("a.md", "r1")
    await repair.delete("b.md", "r2")
    const log = await repair.getAuditLog()
    expect(log).toHaveLength(2)
    expect(log[0].type).toBe("archive")
    expect(log[1].type).toBe("delete")
  })
})
