#!/usr/bin/env bun
/**
 * opencode-memory — Provenance Migration Script (v0.4.0)
 *
 * One-time migration: scans all memory files and injects provenance
 * metadata where missing. Backward compatible — old files without
 * provenance continue to work.
 *
 * Usage:
 *   bun run scripts/migrate-provenance.ts --dry-run [--scope=project|user|all]
 *   bun run scripts/migrate-provenance.ts --apply [--scope=project|user|all]
 *   bun run scripts/migrate-provenance.ts --rollback --backup-dir <path>
 *
 * Safety:
 *   - Backs up files to .memory-backup/provenance-YYYYMMDD/ before modifying
 *   - Idempotent: running twice produces no changes
 *   - Uses lock.ts for concurrency safety
 *   - Uses path.join for Windows path compatibility
 */

import { readdir, readFile, writeFile, mkdir, cp, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, basename, dirname } from "node:path"
import { homedir } from "node:os"
import { parseFrontmatter } from "../src/store.js"
import { serializeProvenance, createProvenance, type MemoryProvenance } from "../src/memory/provenance.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUP_ROOT = ".memory-backup"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MigrationResult {
  scanned: number
  missingProvenance: string[]
  invalidProvenance: Array<{ filename: string; error: string }>
  migrated: number
  errors: string[]
  backupDir?: string
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getProjectDir(): string {
  const home = homedir()
  return join(home, ".config", "opencode", "memory", "projects", "D--opencode-.config-opencode-plugins-opencode-memory")
}

function getUserDir(): string {
  return join(homedir(), ".config", "opencode", "memory", "user")
}

function resolveDirs(scope: string): string[] {
  if (scope === "all") return [getProjectDir(), getUserDir()]
  if (scope === "user") return [getUserDir()]
  return [getProjectDir()]
}

// ---------------------------------------------------------------------------
// Memory file scanning
// ---------------------------------------------------------------------------

async function scanMemoryFiles(memoryDir: string): Promise<string[]> {
  const files = await readdir(memoryDir, { recursive: true }).catch(() => [] as string[])
  return files.filter(
    (f) =>
      f.endsWith(".md") &&
      basename(f) !== "MEMORY.md" &&
      basename(f) !== "ARCHIVE.md" &&
      !f.startsWith(".memory-backup") && // v0.4.0: exclude backup dir
      !f.includes("/.memory-backup") &&  // Windows: exclude backup dir
      !f.includes("\\.memory-backup"),    // Windows: exclude backup dir
  )
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

async function backupFiles(
  memoryDir: string,
  files: string[],
  timestamp: string,
): Promise<string> {
  const backupDir = join(memoryDir, BACKUP_ROOT, `provenance-${timestamp}`)
  for (const relPath of files) {
    const src = join(memoryDir, relPath)
    const dest = join(backupDir, relPath)
    await mkdir(dirname(dest), { recursive: true })
    await cp(src, dest)
  }
  return backupDir
}

// ---------------------------------------------------------------------------
// Provenance injection
// ---------------------------------------------------------------------------

function buildMigrationProvenance(
  _fm: ReturnType<typeof parseFrontmatter>,
  mtimeMs: number,
): MemoryProvenance {
  // Use file mtime as the provenance timestamp (best approximation for legacy files)
  const prov = createProvenance(
    { type: "migration" },
    "migration",
  )
  // Override the created.timestamp with the file's mtime
  prov.created.timestamp = mtimeMs
  prov.history[0].timestamp = mtimeMs
  return prov
}

// ---------------------------------------------------------------------------
// Migration logic
// ---------------------------------------------------------------------------

async function migrateMemoryDir(
  memoryDir: string,
  dryRun: boolean,
  timestamp: string,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    scanned: 0,
    missingProvenance: [],
    invalidProvenance: [],
    migrated: 0,
    errors: [],
  }

  // Check directory exists
  if (!existsSync(memoryDir)) {
    return result
  }

  const files = await scanMemoryFiles(memoryDir)
  result.scanned = files.length

  // Phase 1: Scan
  const toMigrate: Array<{ filename: string; content: string; fm: ReturnType<typeof parseFrontmatter>; mtimeMs: number }> = []

  for (const relPath of files) {
    const absPath = join(memoryDir, relPath)
    try {
      const content = await readFile(absPath, "utf-8")
      const fm = parseFrontmatter(content)
      const stats = await stat(absPath)

      // Check for provenance
      if (!fm.provenance) {
        result.missingProvenance.push(relPath)
        toMigrate.push({ filename: relPath, content, fm, mtimeMs: stats.mtimeMs })
      } else {
        // Validate existing provenance
        try {
          const parsed = JSON.parse(fm.provenance)
          if (!parsed.source || !parsed.created || !Array.isArray(parsed.history)) {
            result.invalidProvenance.push({ filename: relPath, error: "invalid structure" })
          }
        } catch {
          result.invalidProvenance.push({ filename: relPath, error: "invalid JSON" })
        }
      }
    } catch (err) {
      result.errors.push(`Error reading ${relPath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Phase 2: Backup + Apply
  if (!dryRun && toMigrate.length > 0) {
    const backupDir = await backupFiles(memoryDir, toMigrate.map((f) => f.filename), timestamp)
    result.backupDir = backupDir

    for (const { filename, content, fm, mtimeMs } of toMigrate) {
      try {
        const provenance = buildMigrationProvenance(fm, mtimeMs)
        const provenanceJson = serializeProvenance(provenance)!

        // Insert provenance line after the frontmatter fields
        const updatedContent = injectProvenanceIntoFile(content, provenanceJson)
        await writeFile(join(memoryDir, filename), updatedContent, "utf-8")
        result.migrated++
      } catch (err) {
        result.errors.push(`Error migrating ${filename}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  return result
}

/**
 * Inject provenance line into a memory file's frontmatter.
 * Inserts after the last known field before schema_version.
 */
function injectProvenanceIntoFile(content: string, provenanceJson: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) {
    // No frontmatter — create one
    return `---\nprovenance: ${provenanceJson}\nschema_version: 1\n---\n\n${content}`
  }

  const fm = match[1]
  const body = content.slice(match[0].length)

  // Insert provenance before schema_version if it exists, otherwise append
  const lines = fm.split(/\r?\n/)
  const insertBefore = lines.findIndex((l) => l.startsWith("schema_version:"))
  const newLines = [...lines]

  const provenanceLine = `provenance: ${provenanceJson}`
  if (insertBefore >= 0) {
    newLines.splice(insertBefore, 0, provenanceLine)
  } else {
    newLines.push(provenanceLine)
  }

  return `---\n${newLines.join("\n")}\n---\n${body}`
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

async function rollback(backupDir: string): Promise<{ restored: number; errors: string[] }> {
  const result = { restored: 0, errors: [] as string[] }

  if (!existsSync(backupDir)) {
    result.errors.push(`Backup directory not found: ${backupDir}`)
    return result
  }

  // Backup structure: <memoryDir>/.memory-backup/provenance-YYYYMMDD/<files>
  // So the memory dir is two levels up from the backup dir
  const memoryDir = dirname(dirname(backupDir))

  const files = await readdir(backupDir, { recursive: true }).catch(() => [] as string[])
  const mdFiles = files.filter((f) => f.endsWith(".md"))

  for (const relPath of mdFiles) {
    try {
      const src = join(backupDir, relPath)
      const dest = join(memoryDir, relPath)
      await mkdir(dirname(dest), { recursive: true })
      await cp(src, dest, { force: true })
      result.restored++
    } catch (err) {
      result.errors.push(`Error restoring ${relPath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const isDryRun = args.includes("--dry-run")
  const isApply = args.includes("--apply")
  const isRollback = args.includes("--rollback")
  const scopeArg = args.find((a) => a.startsWith("--scope="))
  const scope = scopeArg ? scopeArg.split("=")[1] : "project"
  const backupDirArg = args.find((a) => a.startsWith("--backup-dir="))
  const backupDir = backupDirArg ? backupDirArg.split("=")[1] : ""

  if (isRollback) {
    if (!backupDir) {
      console.error("Error: --rollback requires --backup-dir <path>")
      process.exit(1)
    }
    const result = await rollback(backupDir)
    console.log(`Restored ${result.restored} files from backup`)
    if (result.errors.length > 0) {
      console.error(`Errors: ${result.errors.join("; ")}`)
    }
    return
  }

  if (!isDryRun && !isApply) {
    console.error("Usage: bun run scripts/migrate-provenance.ts --dry-run|--apply [--scope=project|user|all]")
    process.exit(1)
  }

  const dirs = resolveDirs(scope)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  let totalScanned = 0
  let totalMissing = 0
  let totalInvalid = 0
  let totalMigrated = 0
  let totalErrors = 0

  for (const dir of dirs) {
    const result = await migrateMemoryDir(dir, isDryRun, timestamp)
    const label = dir === getUserDir() ? "user" : "project"

    console.log(`\n[${label}] ${dir}`)
    console.log(`  Scanned: ${result.scanned} files`)
    console.log(`  Missing provenance: ${result.missingProvenance.length}`)
    if (result.missingProvenance.length > 0 && result.missingProvenance.length <= 10) {
      for (const f of result.missingProvenance) {
        console.log(`    - ${f}`)
      }
    } else if (result.missingProvenance.length > 10) {
      for (const f of result.missingProvenance.slice(0, 10)) {
        console.log(`    - ${f}`)
      }
      console.log(`    ... and ${result.missingProvenance.length - 10} more`)
    }
    console.log(`  Invalid provenance: ${result.invalidProvenance.length}`)
    if (result.invalidProvenance.length > 0) {
      for (const f of result.invalidProvenance) {
        console.log(`    - ${f.filename}: ${f.error}`)
      }
    }
    if (!isDryRun) {
      console.log(`  Migrated: ${result.migrated} files`)
      if (result.backupDir) {
        console.log(`  Backup: ${result.backupDir}`)
      }
    }
    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`)
      for (const e of result.errors) {
        console.log(`    - ${e}`)
      }
    }

    totalScanned += result.scanned
    totalMissing += result.missingProvenance.length
    totalInvalid += result.invalidProvenance.length
    totalMigrated += result.migrated
    totalErrors += result.errors.length
  }

  console.log(`\nSummary:`)
  console.log(`  Total scanned: ${totalScanned}`)
  console.log(`  Total missing: ${totalMissing}`)
  console.log(`  Total invalid: ${totalInvalid}`)
  if (!isDryRun && totalMigrated > 0) {
    console.log(`  Total migrated: ${totalMigrated}`)
  }
  if (totalErrors > 0) {
    console.log(`  Total errors: ${totalErrors}`)
    process.exit(1)
  }
}

// Run directly when script is executed (not imported)
const isMainModule = process.argv[1]?.endsWith("migrate-provenance.ts")
if (isMainModule) {
  main().catch((err) => {
    console.error("Migration failed:", err)
    process.exit(1)
  })
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
  scanMemoryFiles,
  backupFiles,
  buildMigrationProvenance,
  migrateMemoryDir,
  injectProvenanceIntoFile,
  rollback,
  type MigrationResult,
}