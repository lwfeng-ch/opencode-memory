#!/usr/bin/env bun
/**
 * opencode-memory — Repair CLI (v0.3.3)
 *
 * Usage:
 *   bun run repair                              — interactive review
 *   bun run repair --scan [--scope project]     — scan & enqueue candidates (run before --list)
 *   bun run repair --list                       — list pending candidates (non-interactive)
 *   bun run repair --approve cand_001           — approve specific candidate
 *   bun run repair --approve-all-low            — approve all low-risk candidates
 *   bun run repair --restore file.md            — restore archived file
 *   bun run repair --clear                      — clear executed/rejected candidates from queue
 *
 * Scope:
 *   --scope project (default) | user | all     — which memory scope to operate on
 *
 * Session scanning:
 *   --include-recent-sessions                  — override 30-day threshold (scan ALL session_*.md)
 */

import { FileCandidateQueue } from "../src/repair/queue.js"
import { RepairService } from "../src/repair/service.js"
import { AuditLog } from "../src/repair/audit.js"
import { MemoryMigrationScanner, LegacyScanner, SessionScanner } from "../src/migration/scanner.js"
import { join } from "node:path"

type Scope = "project" | "user" | "all"

interface RepairArgs {
  list: boolean
  scan: boolean
  scope: Scope
  includeRecentSessions: boolean
  approve?: string
  approveAllLow: boolean
  restore?: string
  clear: boolean
}

function parseArgs(argv: string[]): RepairArgs {
  const result: RepairArgs = {
    list: false,
    scan: false,
    scope: "project",
    includeRecentSessions: false,
    approveAllLow: false,
    clear: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--list") {
      result.list = true
    } else if (arg === "--scan") {
      result.scan = true
    } else if (arg === "--include-recent-sessions") {
      result.includeRecentSessions = true
    } else if (arg === "--scope" && i + 1 < argv.length) {
      const v = argv[++i] as Scope
      if (v === "project" || v === "user" || v === "all") {
        result.scope = v
      } else {
        console.error(`Invalid --scope value: ${v} (expected: project|user|all)`)
        process.exit(1)
      }
    } else if (arg === "--approve" && i + 1 < argv.length) {
      result.approve = argv[++i]
    } else if (arg === "--approve-all-low") {
      result.approveAllLow = true
    } else if (arg === "--restore" && i + 1 < argv.length) {
      result.restore = argv[++i]
    } else if (arg === "--clear") {
      result.clear = true
    }
  }
  return result
}

function getProjectDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || ""
  // Sanitized name mirrors paths.ts logic for the current plugin's project root
  return join(home, ".config", "opencode", "memory", "projects", "D--opencode-.config-opencode-plugins-opencode-memory")
}

function getUserDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || ""
  return join(home, ".config", "opencode", "memory", "user")
}

function getMemoryDirs(scope: Scope): string[] {
  if (scope === "all") return [getProjectDir(), getUserDir()]
  if (scope === "user") return [getUserDir()]
  return [getProjectDir()]
}

function getQueueDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || ""
  return join(home, ".config", "opencode", "memory", "lifecycle", "candidates")
}

function getAuditFile(): string {
  const home = process.env.USERPROFILE || process.env.HOME || ""
  return join(home, ".config", "opencode", "memory", "lifecycle", "repair", "audit.log")
}

function displayCandidate(c: any, index: number): void {
  const num = `[${index}]`
  console.log(`${num} Type: ${c.type}`)
  console.log(`    File: ${c.source}`)
  console.log(`    Size: ${(c.metadata.size / 1024).toFixed(1)}KB`)
  console.log(`    Title: ${c.preview.title}`)
  if (c.preview.description) {
    console.log(`    Description: ${c.preview.description}`)
  }
  if (c.preview.sections && c.preview.sections.length > 0) {
    console.log(`    Sections: ${c.preview.sections.join(", ")}`)
  }
  console.log(`    Reason: ${c.reason}`)
  console.log(`    Risk: ${c.risk}`)
  console.log(`    Action: ${c.action}`)
  console.log("")
}

async function scanAndEnqueue(
  dir: string,
  scope: "project" | "user",
  queue: FileCandidateQueue,
  options: { includeRecentSessions: boolean },
): Promise<number> {
  const sessionThreshold = options.includeRecentSessions ? 0 : 30
  const scanner = new MemoryMigrationScanner(
    new LegacyScanner(dir),
    new SessionScanner(dir, sessionThreshold),
  )
  const candidates = await scanner.scanAll()
  for (const c of candidates) {
    c.scope = scope
    await queue.add(c)
  }
  return candidates.length
}

async function executeCandidateWithScope(
  candidate: RepairCandidate,
  scopeToService: Map<string, RepairService>,
  queue: FileCandidateQueue,
): Promise<void> {
  const service = scopeToService.get(candidate.scope || "project")
  if (!service) {
    throw new Error(`No service for scope: ${candidate.scope || "project"}`)
  }
  await queue.updateStatus(candidate.id, "approved")
  await service.executeCandidate(candidate)
  await queue.updateStatus(candidate.id, "executed")
}

import type { RepairCandidate } from "../src/repair/candidate.js"

async function main() {
  const args = parseArgs(process.argv)
  const queueDir = getQueueDir()
  const auditFile = getAuditFile()

  const queue = new FileCandidateQueue(queueDir)
  const auditLog = new AuditLog(auditFile)

  // Build scope → service map (single shared audit log)
  const projectDir = getProjectDir()
  const userDir = getUserDir()
  const scopeToService = new Map<string, RepairService>()
  scopeToService.set("project", new RepairService(projectDir, auditLog))
  scopeToService.set("user", new RepairService(userDir, auditLog))

  // --scan: scan and enqueue candidates from all configured scopes
  if (args.scan) {
    let total = 0
    for (const dir of getMemoryDirs(args.scope)) {
      const scope = dir === userDir ? "user" : "project"
      const n = await scanAndEnqueue(dir, scope, queue, {
        includeRecentSessions: args.includeRecentSessions,
      })
      console.log(`Scanned ${scope} scope: ${n} candidates enqueued`)
      total += n
    }
    console.log(`\nTotal: ${total} candidates enqueued. Run \`bun run repair --list\` to review.`)
    return
  }

  if (args.list) {
    const candidates = await queue.getPending()
    if (candidates.length === 0) {
      console.log("No pending candidates. Run `bun run repair --scan` to scan first.")
      return
    }
    console.log(`Found ${candidates.length} candidates (${candidates.length} pending)\n`)
    candidates.forEach((c, i) => displayCandidate(c, i + 1))
    return
  }

  if (args.approve) {
    const candidate = await queue.get(args.approve)
    if (!candidate) {
      console.error(`Candidate not found: ${args.approve}`)
      process.exit(1)
    }
    await executeCandidateWithScope(candidate, scopeToService, queue)
    console.log(`Executed: ${candidate.action} ${candidate.source} (${candidate.scope || "project"})`)
    return
  }

  if (args.approveAllLow) {
    const pending = await queue.getPending()
    const lowRisk = pending.filter((c) => c.risk === "low")
    if (lowRisk.length === 0) {
      console.log("No low-risk candidates to approve.")
      return
    }
    console.log(`Approving ${lowRisk.length} low-risk candidates...`)
    for (const c of lowRisk) {
      try {
        await executeCandidateWithScope(c, scopeToService, queue)
        console.log(`  ✓ ${c.action} ${c.source} (${c.scope || "project"})`)
      } catch (err) {
        console.log(`  ✗ ${c.source}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return
  }

  if (args.restore) {
    // Try both scopes — first project, then user
    for (const [scope, service] of scopeToService) {
      try {
        await service.restore(args.restore)
        console.log(`Restored: ${args.restore} (${scope})`)
        return
      } catch (err) {
        // try next scope
        if (scope === "user") {
          throw err
        }
      }
    }
    return
  }

  if (args.clear) {
    await queue.clearExecuted()
    console.log("Cleared executed/rejected candidates from queue.")
    return
  }

  // Default: interactive mode
  const candidates = await queue.getPending()
  if (candidates.length === 0) {
    console.log("No pending candidates. Run `bun run repair --scan` to scan first.")
    return
  }

  console.log(`Memory Repair Console`)
  console.log(`Found ${candidates.length} candidates (${candidates.length} pending)\n`)

  let approved = 0
  let rejected = 0
  let skipped = 0

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    displayCandidate(c, i + 1)

    // Simple CLI prompt (no readline dependency)
    process.stdout.write("  [y] approve  [n] reject  [s] skip  [q] quit > ")
    const answer = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim().toLowerCase())
      })
    })

    if (answer === "y") {
      try {
        await executeCandidateWithScope(c, scopeToService, queue)
        console.log(`  ✓ ${c.action} executed\n`)
        approved++
      } catch (err) {
        console.log(`  ✗ Error: ${err instanceof Error ? err.message : String(err)}\n`)
      }
    } else if (answer === "n") {
      await queue.updateStatus(c.id, "rejected")
      console.log(`  ✗ Rejected\n`)
      rejected++
    } else if (answer === "q") {
      console.log(`\nQuitting. ${approved} approved, ${rejected} rejected, ${skipped} skipped.`)
      return
    } else {
      console.log(`  → Skipped\n`)
      skipped++
    }
  }

  console.log(`\nSummary: ${approved} approved, ${rejected} rejected, ${skipped} skipped`)

  // Show audit log summary
  const log = await auditLog.getAll()
  if (log.length > 0) {
    console.log(`\nAudit Log (${log.length} entries):`)
    const recent = log.slice(-5)
    for (const entry of recent) {
      console.log(`  ${entry.timestamp} ${entry.type} ${entry.filename} (${entry.result})`)
    }
  }
}

main().catch((err) => {
  console.error("Repair failed:", err)
  process.exit(1)
})
