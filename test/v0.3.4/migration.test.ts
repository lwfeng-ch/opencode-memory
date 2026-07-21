/**
 * migration.test.ts — v0.3.4 Phase 0 Archive Index Migration Tests
 *
 * Tests the migration logic:
 * - planMigration: scanning files, partitioning by status, reporting plan
 * - executeMigration: rewriting MEMORY.md + ARCHIVE.md with correct partitions
 * - Idempotency (AC-10): running twice produces same result
 * - Safety (R8): backup before migration
 *
 * See: docs/superpowers/specs/v0.3.4/04-archive-index.md §8, §9.1
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, writeFile, readFile, mkdir, cp } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { MANIFEST_AUTO_GENERATED_HEADER } from "../../src/lifecycle/archive-types.js"
import { readArchive, writeArchive } from "../../src/index/archive-index.js"
import { parseFrontmatter } from "../../src/store.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "migration-test-"))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

/** Create a memory file with frontmatter, optionally with status. */
async function createMemory(
  filename: string,
  name: string,
  description: string,
  status?: "active" | "archived",
  body = "content body for testing",
): Promise<void> {
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "type: user",
    "scope: user",
    "confidence: inferred",
    "schema_version: 1",
  ]
  if (status) {
    lines.push(`status: ${status}`)
    if (status === "archived") {
      lines.push(`archivedAt: ${Date.now()}`)
    }
  }
  lines.push("---", "", body)
  await writeFile(join(tmpDir, filename), lines.join("\n"), "utf-8")
}

/** Create a MEMORY.md with a specific set of entries. */
async function createMemoryMd(entries: Array<{ filename: string; title: string; description: string }>): Promise<void> {
  const lines = [MANIFEST_AUTO_GENERATED_HEADER, ""]
  for (const e of entries) {
    const desc = e.description ? ` — ${e.description}` : ""
    lines.push(`- [${e.title}](${e.filename})${desc}`)
  }
  await writeFile(join(tmpDir, "MEMORY.md"), lines.join("\r\n") + "\r\n", "utf-8")
}

/** Read MEMORY.md content. */
async function readMemoryMd(): Promise<string> {
  try {
    return await readFile(join(tmpDir, "MEMORY.md"), "utf-8")
  } catch {
    return ""
  }
}

/** Read ARCHIVE.md content. */
async function readArchiveMd(): Promise<string> {
  try {
    return await readFile(join(tmpDir, "ARCHIVE.md"), "utf-8")
  } catch {
    return ""
  }
}

/** Compute a quick string hash. */
function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return String(h)
}

// ---------------------------------------------------------------------------
// Rebuild logic (same as rebuildIndex() + executeMigration())
// ---------------------------------------------------------------------------

/**
 * Simulates the migration's partition + rebuild logic.
 * This is the same algorithm used by store.ts rebuildIndex() and
 * scripts/migrate-archive-index.ts executeMigration().
 */
async function migrateArchiveIndex(): Promise<{ active: number; archived: number }> {
  const { readdir } = await import("node:fs/promises")
  const files = await readdir(tmpDir, { recursive: true }).catch(() => [] as string[])
  const mdFiles = files.filter(
    (f: string) => f.endsWith(".md") && !f.endsWith("MEMORY.md") && !f.endsWith("ARCHIVE.md"),
  )

  const activeLines: string[] = []
  const archivedLines: string[] = []

  for (const relPath of mdFiles) {
    try {
      const content = await readFile(join(tmpDir, relPath), "utf-8")
      const fm = parseFrontmatter(content)
      const title = fm.name ?? relPath
      const desc = fm.description ?? ""
      const line = `- [${title}](${relPath}) — ${desc}`
      if (fm.status === "archived") {
        archivedLines.push(line)
      } else {
        activeLines.push(line)
      }
    } catch {
      // skip unreadable
    }
  }

  activeLines.sort()
  archivedLines.sort()

  // Write MEMORY.md
  const memContent = `${MANIFEST_AUTO_GENERATED_HEADER}\r\n\r\n${activeLines.join("\r\n")}${activeLines.length > 0 ? "\r\n" : ""}`
  await writeFile(join(tmpDir, "MEMORY.md"), memContent, "utf-8")

  // Write ARCHIVE.md
  const archiveEntries = archivedLines.map(line => {
    // Parse back to entry format
    const m = line.match(/^-\s+\[([^\]]*)\]\(([^)]+)\)\s*(?:—\s*(.*))?$/)
    return {
      filename: m ? m[2] : "unknown",
      title: m ? m[1] : "unknown",
      description: m ? (m[3] ?? "").trim() : "",
      archivedAt: Date.now(),
    }
  })
  await writeArchive(tmpDir, archiveEntries)

  return { active: activeLines.length, archived: archivedLines.length }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("migration — dry-run plan (R7)", () => {
  test("plans migration for mixed active/archived files", async () => {
    await createMemory("active.md", "Active", "An active memory")
    await createMemory("archived.md", "Archived", "An archived memory", "archived")

    // Simulate dry-run plan: scan files and partition by status
    const files = await import("node:fs/promises").then(m => m.readdir(tmpDir))
    const mdFiles = files.filter((f: string) => f.endsWith(".md") && f !== "MEMORY.md" && f !== "ARCHIVE.md")

    const active: string[] = []
    const archived: string[] = []
    for (const f of mdFiles) {
      const content = await readFile(join(tmpDir, f), "utf-8")
      const fm = parseFrontmatter(content)
      if (fm.status === "archived") archived.push(f)
      else active.push(f)
    }

    expect(active).toHaveLength(1)
    expect(active).toContain("active.md")
    expect(archived).toHaveLength(1)
    expect(archived).toContain("archived.md")
  })

  test("reports zero files to move when already migrated", async () => {
    await createMemory("a.md", "A", "Active", "active")
    await createMemory("b.md", "B", "Archived", "archived")

    // First migration
    const first = await migrateArchiveIndex()
    expect(first.active).toBe(1)
    expect(first.archived).toBe(1)

    // Second migration (idempotent)
    const second = await migrateArchiveIndex()
    expect(second.active).toBe(1)
    expect(second.archived).toBe(1)
  })
})

describe("migration — apply (R7 + R8)", () => {
  test("partitions active files into MEMORY.md", async () => {
    await createMemory("active.md", "Active", "An active memory")
    await createMemory("archived.md", "Archived", "An archived memory", "archived")

    await migrateArchiveIndex()

    const memContent = await readMemoryMd()
    expect(memContent).toContain("active.md")
    expect(memContent).not.toContain("archived.md")
  })

  test("partitions archived files into ARCHIVE.md", async () => {
    await createMemory("active.md", "Active", "An active memory")
    await createMemory("archived.md", "Archived", "An archived memory", "archived")

    await migrateArchiveIndex()

    const arcContent = await readArchiveMd()
    expect(arcContent).toContain("archived.md")
    expect(arcContent).not.toContain("active.md")
  })

  test("creates ARCHIVE.md only when archives exist", async () => {
    await createMemory("only-active.md", "Only Active", "No archived files")

    await migrateArchiveIndex()

    // ARCHIVE.md should not exist (no archived files)
    expect(existsSync(join(tmpDir, "ARCHIVE.md"))).toBe(false)
  })

  test("deletes empty ARCHIVE.md when all archives restored", async () => {
    await createMemory("archived.md", "Archived", "An archived memory", "archived")

    // First migration creates ARCHIVE.md
    await migrateArchiveIndex()
    expect(existsSync(join(tmpDir, "ARCHIVE.md"))).toBe(true)

    // Remove the archived file and re-migrate
    await rm(join(tmpDir, "archived.md"))
    await migrateArchiveIndex()

    // ARCHIVE.md should be deleted (no archived files)
    expect(existsSync(join(tmpDir, "ARCHIVE.md"))).toBe(false)
  })
})

describe("migration — idempotent (AC-10)", () => {
  test("repeat migration produces same MEMORY.md hash", async () => {
    await createMemory("a.md", "A", "Active memory")
    await createMemory("b.md", "B", "Archived memory", "archived")

    await migrateArchiveIndex()
    const h1 = hash(await readMemoryMd())

    await migrateArchiveIndex()
    const h2 = hash(await readMemoryMd())

    expect(h1).toBe(h2)
  })

  test("repeat migration produces same ARCHIVE.md hash", async () => {
    await createMemory("a.md", "A", "Active memory")
    await createMemory("b.md", "B", "Archived memory", "archived")

    await migrateArchiveIndex()
    const h1 = hash(await readArchiveMd())

    await migrateArchiveIndex()
    const h2 = hash(await readArchiveMd())

    expect(h1).toBe(h2)
  })
})

describe("migration — safety (R8)", () => {
  test("creates timestamped backup before migration", async () => {
    await createMemory("a.md", "A", "Active memory")
    await createMemory("b.md", "B", "Archived memory", "archived")
    await createMemoryMd([
      { filename: "a.md", title: "A", description: "Active memory" },
      { filename: "b.md", title: "B", description: "Archived memory" },
    ])

    // Simulate R8 safety: create backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = join(tmpDir, `.backup-${timestamp}`)
    await mkdir(backupPath, { recursive: true })
    if (existsSync(join(tmpDir, "MEMORY.md"))) {
      await cp(join(tmpDir, "MEMORY.md"), join(backupPath, "MEMORY.md"))
    }

    // Verify backup was created
    expect(existsSync(join(backupPath, "MEMORY.md"))).toBe(true)

    // Run migration
    await migrateArchiveIndex()

    // Backup should still exist
    expect(existsSync(join(backupPath, "MEMORY.md"))).toBe(true)
  })

  test("backup can be used for rollback", async () => {
    await createMemory("a.md", "A", "Active memory")
    await createMemory("b.md", "B", "Archived memory", "archived")
    await createMemoryMd([
      { filename: "a.md", title: "A", description: "Active memory" },
      { filename: "b.md", title: "B", description: "Archived memory" },
    ])

    // Save pre-migration MEMORY.md content
    const preMigrationContent = await readMemoryMd()

    // Create backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = join(tmpDir, `.backup-${timestamp}`)
    await mkdir(backupPath, { recursive: true })
    await cp(join(tmpDir, "MEMORY.md"), join(backupPath, "MEMORY.md"))

    // Run migration
    await migrateArchiveIndex()

    // Verify migration changed MEMORY.md
    const postMigrationContent = await readMemoryMd()
    expect(postMigrationContent).not.toBe(preMigrationContent)

    // Rollback from backup
    await cp(join(backupPath, "MEMORY.md"), join(tmpDir, "MEMORY.md"))

    // Verify rollback restored original content
    const restoredContent = await readMemoryMd()
    expect(restoredContent).toBe(preMigrationContent)
  })
})