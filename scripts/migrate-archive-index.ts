#!/usr/bin/env bun
/**
 * opencode-memory — Archive Index Migration Script (v0.3.4 Phase 0)
 *
 * One-time migration: splits MEMORY.md into dual manifest
 * (MEMORY.md active-only + ARCHIVE.md archived-only, lazy-created).
 *
 * Usage:
 *   bun run scripts/migrate-archive-index.ts --dry-run [--scope=project|user|all]
 *   bun run scripts/migrate-archive-index.ts --apply [--scope=project|user|all] [--force]
 *
 * Safety (R8): --apply requires either:
 *   (A) git clean state (no uncommitted changes in memory dir's repo), OR
 *   (B) timestamped backup of MEMORY.md + ARCHIVE.md to <memoryDir>/.backup-<ISO>/
 *
 * Idempotent (AC-10): running twice produces no changes on second run.
 */

import { readdir, readFile, writeFile, unlink, mkdir, cp, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, basename } from "node:path"
import { execSync } from "node:child_process"
import { parseFrontmatter } from "../src/store.js"
import { writeArchive, readArchive } from "../src/index/archive-index.js"
import { buildArchiveLine, MANIFEST_AUTO_GENERATED_HEADER } from "../src/lifecycle/archive-types.js"

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getProjectDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || ""
  return join(home, ".config", "opencode", "memory", "projects", "D--opencode-.config-opencode-plugins-opencode-memory")
}

function getUserDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || ""
  return join(home, ".config", "opencode", "memory", "user")
}

function resolveDirs(scope: string): string[] {
  if (scope === "all") return [getProjectDir(), getUserDir()]
  if (scope === "user") return [getUserDir()]
  return [getProjectDir()]
}

// ---------------------------------------------------------------------------
// Migration plan (dry-run preview)
// ---------------------------------------------------------------------------

interface MigrationPlan {
  memoryDir: string
  activeEntries: number
  archivedEntries: number
  filesToMove: string[]
  archiveManifestWillBeCreated: boolean
  archiveManifestWillBeDeleted: boolean
}

async function planMigration(memoryDir: string): Promise<MigrationPlan> {
  // Scan all *.md files in memoryDir (recursive to catch semantic/sessions/ etc.)
  const files = await readdir(memoryDir, { recursive: true }).catch(() => [] as string[])
  const mdFiles = files.filter(f =>
    f.endsWith(".md") &&
    basename(f) !== "MEMORY.md" &&
    basename(f) !== "ARCHIVE.md"
  )

  const active: string[] = []
  const archived: string[] = []

  for (const relPath of mdFiles) {
    const absPath = join(memoryDir, relPath)
    try {
      const content = await readFile(absPath, "utf-8")
      const fm = parseFrontmatter(content)
      if (fm.status === "archived") {
        archived.push(relPath)
      } else {
        active.push(relPath)
      }
    } catch {
      // Unreadable → treat as active (safer default)
      active.push(relPath)
    }
  }

  const archiveManifestExists = existsSync(join(memoryDir, "ARCHIVE.md"))

  return {
    memoryDir,
    activeEntries: active.length,
    archivedEntries: archived.length,
    filesToMove: archived,
    archiveManifestWillBeCreated: archived.length > 0 && !archiveManifestExists,
    archiveManifestWillBeDeleted: archived.length === 0 && archiveManifestExists,
  }
}

// ---------------------------------------------------------------------------
// Execute migration (apply)
// ---------------------------------------------------------------------------

async function executeMigration(memoryDir: string): Promise<void> {
  // 1. Re-scan files and partition by status
  const files = await readdir(memoryDir, { recursive: true }).catch(() => [] as string[])
  const mdFiles = files.filter(f =>
    f.endsWith(".md") &&
    basename(f) !== "MEMORY.md" &&
    basename(f) !== "ARCHIVE.md"
  )

  type Entry = { filename: string; title: string; description: string; archivedAt: number }
  const active: Entry[] = []
  const archived: Entry[] = []

  for (const relPath of mdFiles) {
    const absPath = join(memoryDir, relPath)
    try {
      const content = await readFile(absPath, "utf-8")
      const fm = parseFrontmatter(content)
      const title = fm.name ?? relPath
      const description = fm.description ?? ""
      const archivedAt = Date.now() // not stored in manifest, but required by ArchiveEntry type
      if (fm.status === "archived") {
        archived.push({ filename: relPath, title, description, archivedAt })
      } else {
        active.push({ filename: relPath, title, description, archivedAt })
      }
    } catch {
      // skip unreadable
    }
  }

  // 2. Write MEMORY.md (active partition)
  const memLines = active.map(e => buildArchiveLine(e))
  const memContent = `${MANIFEST_AUTO_GENERATED_HEADER}\n\n${memLines.join("\r\n")}${memLines.length > 0 ? "\r\n" : ""}`
  await mkdir(memoryDir, { recursive: true }).catch(() => {})
  await writeFile(join(memoryDir, "MEMORY.md"), memContent, "utf-8")

  // 3. Write ARCHIVE.md (archived partition — lazy-create/delete handled by writeArchive)
  const archiveEntries = archived.map(e => ({
    filename: e.filename,
    title: e.title,
    description: e.description,
    archivedAt: e.archivedAt,
  }))
  await writeArchive(memoryDir, archiveEntries)
}

// ---------------------------------------------------------------------------
// R8: Safety check before --apply
// ---------------------------------------------------------------------------

async function ensureSafetyBeforeMigration(memoryDir: string): Promise<{ strategy: string; backupPath?: string }> {
  // R8: Pre-migration safety — always create a timestamped backup of manifest files.
  // Option A (git clean state check) is intentionally omitted: the memory directory
  // lives under user home (~/.config/opencode/memory/) which is not a git repo.
  // Timestamped backup is the only applicable safety strategy here.

  // Option B: timestamped backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupPath = join(memoryDir, `.backup-${timestamp}`)
  await mkdir(backupPath, { recursive: true })
  if (existsSync(join(memoryDir, "MEMORY.md"))) {
    await cp(join(memoryDir, "MEMORY.md"), join(backupPath, "MEMORY.md"))
  }
  if (existsSync(join(memoryDir, "ARCHIVE.md"))) {
    await cp(join(memoryDir, "ARCHIVE.md"), join(backupPath, "ARCHIVE.md"))
  }
  return { strategy: "timestamped backup", backupPath }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes("--dry-run")
  const isApply = args.includes("--apply")
  const isForce = args.includes("--force")
  const scopeArg = args.find(a => a.startsWith("--scope="))
  const scope = scopeArg ? scopeArg.split("=")[1] : "project"

  if (!isDryRun && !isApply) {
    console.error("Usage: migrate-archive-index.ts --dry-run | --apply [--scope=project|user|all] [--force]")
    console.error("  --dry-run  : preview changes, no execution")
    console.error("  --apply    : execute migration (with confirmation prompt unless --force)")
    console.error("  --force    : skip confirmation prompt (for scripted use)")
    console.error("  --scope    : project (default) | user | all")
    process.exit(1)
  }

  if (isDryRun && isApply) {
    console.error("Cannot use both --dry-run and --apply")
    process.exit(1)
  }

  if (!["project", "user", "all"].includes(scope)) {
    console.error(`Invalid --scope value: ${scope} (expected: project|user|all)`)
    process.exit(1)
  }

  const dirs = resolveDirs(scope)
  console.log(`Scope: ${scope} (${dirs.length} dir(s))\n`)

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      console.log(`=== ${dir} ===`)
      console.log("  (directory does not exist, skipping)\n")
      continue
    }

    const plan = await planMigration(dir)

    if (isDryRun) {
      console.log(`=== ${dir} ===`)
      console.log(`  Active memories:   ${plan.activeEntries}`)
      console.log(`  Archived memories: ${plan.archivedEntries}`)
      console.log(`  Files to move:     ${plan.filesToMove.length}`)
      if (plan.filesToMove.length > 0 && plan.filesToMove.length <= 20) {
        for (const f of plan.filesToMove) console.log(`    → ${f}`)
      } else if (plan.filesToMove.length > 20) {
        for (const f of plan.filesToMove.slice(0, 10)) console.log(`    → ${f}`)
        console.log(`    ... and ${plan.filesToMove.length - 10} more`)
      }
      if (plan.archiveManifestWillBeCreated) console.log("  ARCHIVE.md will be CREATED")
      if (plan.archiveManifestWillBeDeleted) console.log("  ARCHIVE.md will be DELETED (no archived files)")
      if (plan.filesToMove.length === 0) console.log("  (no changes needed)")
      console.log("")
      continue
    }

    // --apply
    if (plan.filesToMove.length === 0) {
      console.log(`=== ${dir} ===`)
      console.log("  No changes needed (already in target state).")
      // Still rewrite MEMORY.md + ARCHIVE.md to ensure AUTO-GENERATED header is present
      // (idempotent — AC-10)
      try {
        await executeMigration(dir)
        console.log("  ✓ Re-synced manifests (header verification)")
      } catch (err) {
        console.log(`  ✗ Re-sync failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      console.log("")
      continue
    }

    console.log(`=== ${dir} ===`)
    console.log(`  ${plan.filesToMove.length} files will move from MEMORY.md to ARCHIVE.md`)

    // R8: Safety check
    const safety = await ensureSafetyBeforeMigration(dir)
    console.log(`  Safety: ${safety.strategy}${safety.backupPath ? ` → ${safety.backupPath}` : ""}`)

    if (!isForce) {
      process.stdout.write("  Type 'yes' to proceed, anything else to skip > ")
      const answer = await new Promise<string>(resolve => {
        process.stdin.once("data", d => resolve(d.toString().trim().toLowerCase()))
      })
      if (answer !== "yes") {
        console.log("  Skipped.")
        console.log("")
        continue
      }
    }

    try {
      await executeMigration(dir)
      console.log("  ✓ Migration applied")
      console.log(`    MEMORY.md: ${plan.activeEntries} active entries`)
      console.log(`    ARCHIVE.md: ${plan.archivedEntries} archived entries`)
    } catch (err) {
      console.log(`  ✗ Migration failed: ${err instanceof Error ? err.message : String(err)}`)
      console.log(`    Backup at: ${safety.backupPath}`)
    }
    console.log("")
  }

  if (isDryRun) {
    console.log("Dry-run complete. To apply, run with --apply (and optionally --force).")
  } else {
    console.log("Migration complete.")
  }
}

main().catch(err => {
  console.error("Migration failed:", err)
  process.exit(1)
})
