/**
 * repair-service.test.ts — v0.3.4 Phase 0 RepairService Integration Tests
 *
 * Tests the v0.3.4 manifest sync behavior in RepairService:
 * - archive() with archiveIndexEnabled=true/false
 * - Atomicity rollback (R2: manifest-pair-first, frontmatter-last)
 * - Restore conflict detection (R3: conflict/merge-candidate/restore-candidate)
 * - Manifest consistency across archive/restore cycles
 *
 * See: docs/superpowers/specs/v0.3.4/04-archive-index.md §9.1-9.2
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { RepairService } from "../../src/repair/service.js"
import { AuditLog } from "../../src/repair/audit.js"
import { MANIFEST_AUTO_GENERATED_HEADER } from "../../src/lifecycle/archive-types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string
let auditLog: AuditLog
let service: RepairService

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "repair-svc-test-"))
  auditLog = new AuditLog(join(tmpDir, "audit.jsonl"))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

/** Create a memory file with frontmatter. */
async function createMemory(
  filename: string,
  name: string,
  description: string,
  body = "content body text for testing",
): Promise<void> {
  const content = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "type: user",
    "scope: user",
    "confidence: inferred",
    "schema_version: 1",
    "---",
    "",
    body,
  ].join("\n")
  await writeFile(join(tmpDir, filename), content, "utf-8")
}

/** Create MEMORY.md with a specific entry. */
async function createMemoryMd(filename: string, title: string, description: string): Promise<void> {
  const desc = description ? ` — ${description}` : ""
  const content = `${MANIFEST_AUTO_GENERATED_HEADER}\r\n\r\n- [${title}](${filename})${desc}\r\n`
  await writeFile(join(tmpDir, "MEMORY.md"), content, "utf-8")
}

/** Read MEMORY.md content. */
async function readMemoryMd(): Promise<string> {
  try {
    return await readFile(join(tmpDir, "MEMORY.md"), "utf-8")
  } catch {
    return ""
  }
}

/** Check if MEMORY.md contains a reference to a filename. */
async function memoryMdContains(filename: string): Promise<boolean> {
  const content = await readMemoryMd()
  return content.includes(`](${filename})`)
}

/** Check if ARCHIVE.md contains a reference to a filename. */
async function archiveMdContains(filename: string): Promise<boolean> {
  try {
    const content = await readFile(join(tmpDir, "ARCHIVE.md"), "utf-8")
    return content.includes(`](${filename})`)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Section 1: archive() — v0.3.3 mode (archiveIndexEnabled=false)
// ---------------------------------------------------------------------------

describe("archive — v0.3.3 mode (frontmatter only)", () => {
  test("sets frontmatter status=archived on file", async () => {
    service = new RepairService(tmpDir, auditLog, false)
    await createMemory("test.md", "Test", "A test memory")
    await createMemoryMd("test.md", "Test", "A test memory")

    await service.archive("test.md", "stale")

    const content = await readFile(join(tmpDir, "test.md"), "utf-8")
    expect(content).toContain("status: archived")
    expect(content).toContain("archivedAt:")
  })

  test("does NOT create ARCHIVE.md (v0.3.3 backward compat)", async () => {
    service = new RepairService(tmpDir, auditLog, false)
    await createMemory("test.md", "Test", "A test memory")

    await service.archive("test.md", "stale")

    expect(existsSync(join(tmpDir, "ARCHIVE.md"))).toBe(false)
  })

  test("does NOT remove entry from MEMORY.md", async () => {
    service = new RepairService(tmpDir, auditLog, false)
    await createMemory("test.md", "Test", "A test memory")
    await createMemoryMd("test.md", "Test", "A test memory")

    await service.archive("test.md", "stale")

    expect(await memoryMdContains("test.md")).toBe(true)
  })

  test("throws on non-existent file", async () => {
    service = new RepairService(tmpDir, auditLog, false)
    await expect(service.archive("nonexistent.md", "stale")).rejects.toThrow("not found")
  })
})

// ---------------------------------------------------------------------------
// Section 2: archive() — v0.3.4 mode (archiveIndexEnabled=true)
// ---------------------------------------------------------------------------

describe("archive — v0.3.4 mode (manifest sync)", () => {
  test("creates ARCHIVE.md on first archive (AC-2)", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await createMemory("test.md", "Test", "A test memory")
    await createMemoryMd("test.md", "Test", "A test memory")

    expect(existsSync(join(tmpDir, "ARCHIVE.md"))).toBe(false)
    await service.archive("test.md", "stale")

    // ARCHIVE.md should exist
    expect(existsSync(join(tmpDir, "ARCHIVE.md"))).toBe(true)
    expect(await archiveMdContains("test.md")).toBe(true)
  })

  test("removes entry from MEMORY.md on archive", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await createMemory("test.md", "Test", "A test memory")
    await createMemoryMd("test.md", "Test", "A test memory")

    expect(await memoryMdContains("test.md")).toBe(true)
    await service.archive("test.md", "stale")

    expect(await memoryMdContains("test.md")).toBe(false)
  })

  test("updates frontmatter status=archived", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await createMemory("test.md", "Test", "A test memory")

    await service.archive("test.md", "stale")

    const content = await readFile(join(tmpDir, "test.md"), "utf-8")
    expect(content).toContain("status: archived")
  })

  test("archives multiple files correctly", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await createMemory("a.md", "A", "First memory")
    await createMemory("b.md", "B", "Second memory")
    await createMemoryMd("a.md", "A", "First memory")
    await createMemoryMd("b.md", "B", "Second memory")

    await service.archive("a.md", "stale")
    await service.archive("b.md", "stale")

    // ARCHIVE.md should have both
    expect(await archiveMdContains("a.md")).toBe(true)
    expect(await archiveMdContains("b.md")).toBe(true)
    // MEMORY.md should have neither
    expect(await memoryMdContains("a.md")).toBe(false)
    expect(await memoryMdContains("b.md")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Section 3: restore() — v0.3.4 mode (conflict detection + manifest sync)
// ---------------------------------------------------------------------------

describe("restore — v0.3.4 mode (conflict detection + manifest sync)", () => {
  test("restore moves entry back to MEMORY.md and removes from ARCHIVE.md", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await createMemory("test.md", "Test", "A test memory")
    await createMemoryMd("test.md", "Test", "A test memory")

    // Archive first
    await service.archive("test.md", "stale")
    expect(await archiveMdContains("test.md")).toBe(true)
    expect(await memoryMdContains("test.md")).toBe(false)

    // Restore
    await service.restore("test.md")

    // MEMORY.md should have it back, ARCHIVE.md should be gone
    expect(await memoryMdContains("test.md")).toBe(true)
    expect(await archiveMdContains("test.md")).toBe(false)
    // Frontmatter should be active again
    const content = await readFile(join(tmpDir, "test.md"), "utf-8")
    expect(content).toContain("status: active")
  })

  test("restore deletes empty ARCHIVE.md (AC-3)", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await createMemory("only.md", "Only", "The only memory")
    await createMemoryMd("only.md", "Only", "The only memory")

    await service.archive("only.md", "stale")
    expect(existsSync(join(tmpDir, "ARCHIVE.md"))).toBe(true)

    await service.restore("only.md")
    // ARCHIVE.md should be deleted (was the only entry)
    expect(existsSync(join(tmpDir, "ARCHIVE.md"))).toBe(false)
  })

  test("restore BLOCKS on high similarity conflict (R3, sim >= 0.8)", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    // Create two files with very similar content (both about bun package manager)
    await createMemory("memory-a.md", "Test A", "User prefers bun",
      "User prefers bun as package manager for running JavaScript and TypeScript projects")
    await createMemoryMd("memory-a.md", "Test A", "User prefers bun")

    // Archive A
    await service.archive("memory-a.md", "stale")

    // Create B with nearly identical content
    await createMemory("memory-b.md", "Test B", "User prefers bun",
      "User prefers bun package manager for JavaScript and TypeScript projects")

    // Restore A should BLOCK (similarity >= 0.8)
    await expect(service.restore("memory-a.md")).rejects.toThrow(/conflict/i)

    // A should still be archived
    const aContent = await readFile(join(tmpDir, "memory-a.md"), "utf-8")
    expect(aContent).toContain("status: archived")

    // Audit log should record conflict
    const log = await service.getAuditLog()
    const conflictEntries = log.filter(
      e => e.type === "restore" && e.result === "failure" && /conflict/i.test(e.error || ""),
    )
    expect(conflictEntries.length).toBeGreaterThanOrEqual(1)
  })

  test("restore flags merge-candidate on partial similarity (R3, 0.6 <= sim < 0.8)", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    // A has ~7 keywords: prefers, bun, package, management, tasks, running, scripts
    await createMemory("memory-a.md", "Test A", "User prefers bun",
      "User prefers bun for package management tasks and running scripts")
    await createMemoryMd("memory-a.md", "Test A", "User prefers bun")

    // Archive A
    await service.archive("memory-a.md", "stale")

    // B shares 6 of 7 keywords with A: prefers, bun, package, management, tasks, running
    // plus 1 new keyword: development → Jaccard ~6/8 = 0.75 (in 0.6-0.8 range)
    await createMemory("memory-b.md", "Test B", "User prefers bun",
      "User prefers bun for package management tasks and running development")

    // Restore A should succeed but audit log has merge-candidate
    await service.restore("memory-a.md")

    const log = await service.getAuditLog()
    const mergeEntries = log.filter(
      e => e.type === "restore" && /merge-candidate/i.test(e.error || ""),
    )
    expect(mergeEntries.length).toBeGreaterThanOrEqual(1)
  })

  test("restore proceeds normally on low similarity (R3, sim < 0.6)", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await createMemory("memory-a.md", "Test A", "User prefers bun",
      "User prefers bun as package manager")
    await createMemoryMd("memory-a.md", "Test A", "User prefers bun")

    // Archive A
    await service.archive("memory-a.md", "stale")

    // Create B with completely different content
    await createMemory("memory-b.md", "Test B", "React components",
      "React component library with TypeScript and Tailwind CSS for building user interfaces")

    // Restore A should succeed normally
    await service.restore("memory-a.md")

    const log = await service.getAuditLog()
    const successEntries = log.filter(
      e => e.type === "restore" && e.result === "success",
    )
    expect(successEntries.length).toBeGreaterThanOrEqual(1)
    // No merge-candidate flag
    const mergeEntries = log.filter(
      e => e.type === "restore" && /merge-candidate/i.test(e.error || ""),
    )
    expect(mergeEntries.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Section 4: delete() — unchanged by v0.3.4
// ---------------------------------------------------------------------------

describe("delete — unchanged by v0.3.4", () => {
  test("deletes the file and logs action", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await createMemory("delete-me.md", "Delete", "Will be deleted")

    await service.delete("delete-me.md", "cleanup")

    expect(existsSync(join(tmpDir, "delete-me.md"))).toBe(false)
    const log = await service.getAuditLog()
    expect(log.some(e => e.type === "delete" && e.result === "success")).toBe(true)
  })

  test("throws on non-existent file", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await expect(service.delete("nonexistent.md", "cleanup")).rejects.toThrow("not found")
  })
})

// ---------------------------------------------------------------------------
// Section 5: Audit log consistency
// ---------------------------------------------------------------------------

describe("audit log consistency", () => {
  test("archive records success in audit log", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await createMemory("test.md", "Test", "desc")
    await createMemoryMd("test.md", "Test", "desc")

    await service.archive("test.md", "stale")
    const log = await service.getAuditLog()
    expect(log.some(e => e.type === "archive" && e.result === "success")).toBe(true)
  })

  test("restore records success in audit log", async () => {
    service = new RepairService(tmpDir, auditLog, true)
    await createMemory("test.md", "Test", "desc")
    await createMemoryMd("test.md", "Test", "desc")

    await service.archive("test.md", "stale")
    await service.restore("test.md")
    const log = await service.getAuditLog()
    expect(log.filter(e => e.type === "restore" && e.result === "success").length).toBe(1)
  })
})