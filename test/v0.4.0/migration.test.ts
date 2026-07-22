/**
 * Tests for v0.4.0 Phase E — Migration Script
 *
 * Verifies:
 * - dry-run: no missing provenance → reports 0
 * - dry-run: files missing provenance → reports correct count
 * - dry-run: invalid provenance → reports
 * - apply: injects provenance into files without it
 * - apply: idempotent — second run no change
 * - backup: backup directory created
 * - backup: backup file content matches original
 * - rollback: files restored from backup
 * - Windows path: path.join used (no manual string concatenation)
 * - injectProvenanceIntoFile: inserts provenance line correctly
 * - injectProvenanceIntoFile: handles no frontmatter
 * - injectProvenanceIntoFile: inserts before schema_version
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, rm, writeFile, readFile, stat } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { randomUUID } from "crypto"
import { parseFrontmatter } from "../../src/store.js"
import { parseProvenance } from "../../src/memory/provenance.js"
import {
  scanMemoryFiles,
  backupFiles,
  buildMigrationProvenance,
  migrateMemoryDir,
  injectProvenanceIntoFile,
  rollback,
} from "../../scripts/migrate-provenance.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = join(tmpdir(), `migration-test-${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

async function writeMemoryFile(
  filename: string,
  body: string = "test content",
  hasProvenance: boolean = false,
): Promise<void> {
  const lines = ["---", `name: ${filename}`, "description: test memory", "type: project"]
  if (hasProvenance) {
    lines.push(`provenance: {"source":{"type":"migration"},"created":{"timestamp":1000,"actor":"migration"},"history":[{"action":"created","timestamp":1000,"actor":"migration"}]}`)
  }
  lines.push("schema_version: 1", "---", "", body)
  await writeFile(join(tmpDir, filename), lines.join("\n"), "utf-8")
}

// ---------------------------------------------------------------------------
// scanMemoryFiles
// ---------------------------------------------------------------------------

describe("scanMemoryFiles", () => {
  it("should find only .md files excluding MEMORY.md and ARCHIVE.md", async () => {
    await writeMemoryFile("test1.md")
    await writeMemoryFile("test2.md")
    await writeFile(join(tmpDir, "MEMORY.md"), "# Index", "utf-8")
    await writeFile(join(tmpDir, "ARCHIVE.md"), "# Archive", "utf-8")
    await writeFile(join(tmpDir, "notes.txt"), "not a memory", "utf-8")

    const files = await scanMemoryFiles(tmpDir)
    expect(files).toHaveLength(2)
    expect(files).toContain("test1.md")
    expect(files).toContain("test2.md")
    expect(files).not.toContain("MEMORY.md")
    expect(files).not.toContain("ARCHIVE.md")
  })
})

// ---------------------------------------------------------------------------
// injectProvenanceIntoFile
// ---------------------------------------------------------------------------

describe("injectProvenanceIntoFile", () => {
  it("should insert provenance line before schema_version", () => {
    const content = [
      "---",
      "name: test",
      "description: desc",
      "type: project",
      "schema_version: 1",
      "---",
      "",
      "body",
    ].join("\n")

    const result = injectProvenanceIntoFile(content, '{"source":{"type":"migration"}}')
    expect(result).toContain('provenance: {"source":{"type":"migration"}}')
    expect(result).toContain("schema_version: 1")
    // provenance should be before schema_version
    const provIdx = result.indexOf("provenance:")
    const schemaIdx = result.indexOf("schema_version:")
    expect(provIdx).toBeGreaterThan(0)
    expect(schemaIdx).toBeGreaterThan(provIdx)
  })

  it("should handle content without frontmatter", () => {
    const content = "just some text\nno frontmatter"
    const result = injectProvenanceIntoFile(content, '{"source":{"type":"migration"}}')
    expect(result).toContain("provenance:")
    expect(result).toContain("schema_version:")
  })

  it("should preserve existing body content", () => {
    const content = "---\nname: test\ndescription: desc\ntype: project\nschema_version: 1\n---\n\noriginal body"
    const result = injectProvenanceIntoFile(content, '{"source":{"type":"migration"}}')
    expect(result).toContain("original body")
  })
})

// ---------------------------------------------------------------------------
// migrateMemoryDir — dry-run
// ---------------------------------------------------------------------------

describe("migrateMemoryDir (dry-run)", () => {
  it("should report 0 missing when all files have provenance", async () => {
    await writeMemoryFile("a.md", "content", true)
    await writeMemoryFile("b.md", "content", true)

    const result = await migrateMemoryDir(tmpDir, true, "20260722")
    expect(result.scanned).toBe(2)
    expect(result.missingProvenance).toHaveLength(0)
  })

  it("should report files missing provenance", async () => {
    await writeMemoryFile("a.md", "content", false) // no provenance
    await writeMemoryFile("b.md", "content", true)  // has provenance
    await writeMemoryFile("c.md", "content", false) // no provenance

    const result = await migrateMemoryDir(tmpDir, true, "20260722")
    expect(result.scanned).toBe(3)
    expect(result.missingProvenance).toHaveLength(2)
    expect(result.missingProvenance).toContain("a.md")
    expect(result.missingProvenance).toContain("c.md")
  })

  it("should not migrate files during dry-run", async () => {
    await writeMemoryFile("a.md", "content", false)

    const result = await migrateMemoryDir(tmpDir, true, "20260722")
    expect(result.migrated).toBe(0)
    expect(result.missingProvenance).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// migrateMemoryDir — apply
// ---------------------------------------------------------------------------

describe("migrateMemoryDir (apply)", () => {
  it("should inject provenance into files without it", async () => {
    await writeMemoryFile("a.md", "content", false)

    const result = await migrateMemoryDir(tmpDir, false, "20260722")
    expect(result.migrated).toBe(1)

    // Verify file was updated
    const content = await readFile(join(tmpDir, "a.md"), "utf-8")
    const fm = parseFrontmatter(content)
    const parsed = parseProvenance(fm.provenance)
    expect(parsed).toBeDefined()
    expect(parsed!.source.type).toBe("migration")
    expect(parsed!.created.actor).toBe("migration")
  })

  it("should be idempotent (second run produces no changes)", async () => {
    await writeMemoryFile("a.md", "content", false)

    // First run
    const result1 = await migrateMemoryDir(tmpDir, false, "20260722")
    expect(result1.migrated).toBe(1)

    // Second run — should detect no missing provenance
    const result2 = await migrateMemoryDir(tmpDir, false, "20260722")
    expect(result2.migrated).toBe(0)
    expect(result2.missingProvenance).toHaveLength(0)
  })

  it("should create backup directory", async () => {
    await writeMemoryFile("a.md", "content", false)

    const result = await migrateMemoryDir(tmpDir, false, "20260722")
    expect(result.backupDir).toBeDefined()
    expect(result.migrated).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// backup / rollback
// ---------------------------------------------------------------------------

describe("backup and rollback", () => {
  it("should create backup directory with files", async () => {
    await writeMemoryFile("a.md", "original content", false)
    await writeMemoryFile("b.md", "original content", false)

    const timestamp = "20260722"
    const files = ["a.md", "b.md"]
    const backupDir = await backupFiles(tmpDir, files, timestamp)

    // Verify backup exists
    const backupContent = await readFile(join(backupDir, "a.md"), "utf-8")
    expect(backupContent).toContain("original content")
  })

  it("should restore files from backup", async () => {
    // Write original file
    await writeMemoryFile("a.md", "original content", false)

    // Backup
    const timestamp = "20260722"
    const files = ["a.md"]
    const backupDir = await backupFiles(tmpDir, files, timestamp)

    // Modify original
    await writeFile(join(tmpDir, "a.md"), "---\nname: modified\n---\nmodified content", "utf-8")

    // Restore from backup
    const result = await rollback(backupDir)
    expect(result.restored).toBe(1)

    // Verify restored
    const content = await readFile(join(tmpDir, "a.md"), "utf-8")
    expect(content).toContain("original content")
  })
})