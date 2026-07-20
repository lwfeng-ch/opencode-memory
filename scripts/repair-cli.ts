#!/usr/bin/env bun
/**
 * opencode-memory — Repair CLI (v0.3.3)
 *
 * Usage:
 *   bun run repair                      — interactive review
 *   bun run repair --list               — list candidates (non-interactive)
 *   bun run repair --approve cand_001   — approve specific candidate
 *   bun run repair --approve-all-low    — approve all low-risk archive candidates
 *   bun run repair --restore file.md    — restore archived file
 *   bun run repair --clear              — clear executed/rejected candidates from queue
 */

import { FileCandidateQueue } from "../src/repair/queue.js"
import { RepairService } from "../src/repair/service.js"
import { AuditLog } from "../src/repair/audit.js"
import { join } from "node:path"
import { readFileSync } from "node:fs"

interface RepairArgs {
  list: boolean
  approve?: string
  approveAllLow: boolean
  restore?: string
  clear: boolean
}

function parseArgs(argv: string[]): RepairArgs {
  const result: RepairArgs = {
    list: false,
    approveAllLow: false,
    clear: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--list") {
      result.list = true
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

function getMemoryDir(): string {
  // Try to read from memory.config.json, fall back to default
  const configPath = join(process.cwd(), "memory.config.json")
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    // Use default project memory dir
  } catch {
    // ignore
  }
  // Default: user home + .config/opencode/memory/projects/<sanitized>
  const home = process.env.USERPROFILE || process.env.HOME || ""
  return join(home, ".config", "opencode", "memory", "user")
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

async function main() {
  const args = parseArgs(process.argv)
  const memoryDir = getMemoryDir()
  const queueDir = getQueueDir()
  const auditFile = getAuditFile()

  const queue = new FileCandidateQueue(queueDir)
  const auditLog = new AuditLog(auditFile)
  const repair = new RepairService(memoryDir, auditLog)

  if (args.list) {
    const candidates = await queue.getPending()
    if (candidates.length === 0) {
      console.log("No pending candidates.")
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
    await queue.updateStatus(args.approve, "approved")
    await repair.executeCandidate(candidate)
    await queue.updateStatus(args.approve, "executed")
    console.log(`Executed: ${candidate.action} ${candidate.source}`)
    return
  }

  if (args.approveAllLow) {
    const pending = await queue.getPending()
    const lowRiskArchive = pending.filter(
      (c) => c.risk === "low" && c.action === "archive",
    )
    if (lowRiskArchive.length === 0) {
      console.log("No low-risk archive candidates to approve.")
      return
    }
    console.log(`Approving ${lowRiskArchive.length} low-risk archive candidates...`)
    for (const c of lowRiskArchive) {
      try {
        await queue.updateStatus(c.id, "approved")
        await repair.executeCandidate(c)
        await queue.updateStatus(c.id, "executed")
        console.log(`  ✓ ${c.action} ${c.source}`)
      } catch (err) {
        console.log(`  ✗ ${c.source}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return
  }

  if (args.restore) {
    await repair.restore(args.restore)
    console.log(`Restored: ${args.restore}`)
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
    console.log("No pending candidates. Run `bun run audit` or scanner to generate candidates.")
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
        await queue.updateStatus(c.id, "approved")
        await repair.executeCandidate(c)
        await queue.updateStatus(c.id, "executed")
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
  const log = await repair.getAuditLog()
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
