#!/usr/bin/env bun
/**
 * opencode-memory — Audit CLI
 *
 * Usage:
 *   bun run audit                         # scan project memory, console output
 *   bun run audit --json                  # JSON to stdout
 *   bun run audit --scope user            # scan user scope
 *   bun run audit --format markdown       # markdown format
 */

import { createDefaultAuditService } from "../src/audit/index.js"
import { loadConfig } from "../src/config.js"
import { formatAuditJSON, formatAuditMarkdown, formatAuditConsole } from "../src/audit/report.js"
import { writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { getUserMemoryDir, getMemoryDir } from "../src/paths.js"

interface AuditArgs {
  json: boolean
  scope: "user" | "project"
  format: "console" | "json" | "markdown"
}

function parseArgs(argv: string[]): AuditArgs {
  const result: AuditArgs = {
    json: false,
    scope: "project",
    format: "console",
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") {
      result.json = true
      result.format = "json"
    } else if (arg.startsWith("--scope=")) {
      result.scope = arg.split("=")[1] as "user" | "project"
    } else if (arg === "--scope" && i + 1 < argv.length) {
      result.scope = argv[++i] as "user" | "project"
    } else if (arg.startsWith("--format=")) {
      result.format = arg.split("=")[1] as "console" | "json" | "markdown"
    } else if (arg === "--format" && i + 1 < argv.length) {
      result.format = argv[++i] as "console" | "json" | "markdown"
    }
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv)
  const config = await loadConfig()
  const ctx = { now: Date.now(), config }

  const service = createDefaultAuditService()

  // Resolve memory directory
  let memoryDir: string
  if (args.scope === "user") {
    memoryDir = getUserMemoryDir()
  } else {
    const cwd = process.cwd()
    memoryDir = await getMemoryDir(cwd, cwd)
  }

  const report = await service.run(memoryDir, ctx, args.scope)

  // Output to stdout
  if (args.format === "json" || args.json) {
    console.log(formatAuditJSON(report))
  } else if (args.format === "markdown") {
    console.log(formatAuditMarkdown(report))
  } else {
    console.log(formatAuditConsole(report))
  }

  // Write to file
  const reportPath = join(process.cwd(), "reports", "audit", "latest.json")
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8")
}

main().catch((err) => {
  console.error("Audit failed:", err)
  process.exit(1)
})
