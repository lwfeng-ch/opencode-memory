#!/usr/bin/env bun
/**
 * opencode-memory — Quality CLI (v0.3.1)
 *
 * Usage:
 *   bun run quality                  # scan project memory, output quality report
 *   bun run quality --json           # JSON output
 *   bun run quality --scope user     # scan user scope only
 */

import { readdir, readFile, stat } from "node:fs/promises"
import { join, basename } from "node:path"
import { parseFrontmatter, ENTRYPOINT_NAME } from "../src/store.js"
import { DefaultMemoryQualityEvaluator } from "../src/evaluation/quality-score.js"
import type { QualityReportV2, QualityMemory } from "../src/evaluation/quality-score.js"
import { loadConfig } from "../src/config.js"
import { getUserMemoryDir, getMemoryDir } from "../src/paths.js"

interface QualityArgs {
  json: boolean
  scope: "user" | "project" | "all"
}

function parseArgs(argv: string[]): QualityArgs {
  const result: QualityArgs = { json: false, scope: "project" }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") result.json = true
    else if (arg === "--scope" && i + 1 < argv.length) {
      result.scope = argv[++i] as "user" | "project" | "all"
    } else if (arg.startsWith("--scope=")) {
      result.scope = arg.split("=")[1] as "user" | "project" | "all"
    }
  }
  return result
}

/** Extract name field from frontmatter content */
function extractName(content: string): string | undefined {
  const match = content.match(/^---[\s\S]*?^name:\s*(.+?)$/m)
  return match ? match[1].trim() : undefined
}

/** Load memory files and convert to QualityMemory[] */
async function loadQualityMemories(dir: string): Promise<QualityMemory[]> {
  const memories: QualityMemory[] = []
  try {
    const entries = await readdir(dir, { recursive: true })
    const mdFiles = entries.filter((f) => f.endsWith(".md") && basename(f) !== ENTRYPOINT_NAME)

    for (const relativePath of mdFiles) {
      try {
        const filePath = join(dir, relativePath)
        const stats = await stat(filePath)
        const content = await readFile(filePath, { encoding: "utf-8" })
        const fm = parseFrontmatter(content)
        memories.push({
          filename: relativePath,
          content,
          name: extractName(content),
          description: fm.description || null,
          type: fm.type,
          scope: fm.scope,
          confidence: fm.confidence,
          recallCount: fm.recall_count ?? 0,
          lastRecalledAt: fm.last_recalled_at ?? null,
          mtimeMs: stats.mtimeMs,
          status: fm.status,
          archivedAt: fm.archived_at ?? null,
        })
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return memories
}

function formatQualityConsole(report: QualityReportV2): string {
  const lines: string[] = []
  lines.push("=== Memory Quality Report ===")
  lines.push("")

  // Active Quality
  lines.push("Active Quality:")
  lines.push(`  Score:        ${report.activeQuality.score}`)
  lines.push(`  Files:        ${report.activeQuality.count}`)
  lines.push(`  Completeness: ${report.activeQuality.dimensions.completeness}`)
  lines.push(`  Consistency:  ${report.activeQuality.dimensions.consistency}`)
  lines.push(`  Freshness:    ${report.activeQuality.dimensions.freshness}`)
  lines.push(`  Noise:        ${report.activeQuality.dimensions.noise}`)
  lines.push(`  Retrievability: ${report.activeQuality.dimensions.retrievability}`)
  lines.push("")

  // Archive Hygiene
  lines.push("Archive Hygiene:")
  lines.push(`  Score:            ${report.archiveHygiene.score}`)
  lines.push(`  Files:            ${report.archiveHygiene.count}`)
  lines.push(`  Index Consistency: ${report.archiveHygiene.dimensions.indexConsistency}`)
  lines.push(`  Frontmatter:      ${report.archiveHygiene.dimensions.frontmatter}`)
  lines.push(`  File Exists:      ${report.archiveHygiene.dimensions.fileExists}`)
  lines.push(`  Corruption:       ${report.archiveHygiene.dimensions.corruption}`)
  lines.push("")

  // Gate Score
  const total = report.activeQuality.count + report.archiveHygiene.count
  const coverage = total > 0 ? ((report.activeQuality.count / total) * 100).toFixed(1) : "100.0"
  lines.push("Quality Gate:")
  lines.push(`  Score:    ${report.gateScore}`)
  lines.push(`  Coverage: ${coverage}%`)
  lines.push("")
  lines.push(`[deprecated] Operational Score: ${report.overall}`)

  return lines.join("\n")
}

async function main() {
  const args = parseArgs(process.argv)
  await loadConfig() // Initialize config (side effects)

  // Determine memory directories
  const dirs: string[] = []

  if (args.scope === "project" || args.scope === "all") {
    try {
      const cwd = process.cwd()
      dirs.push(await getMemoryDir(cwd, cwd))
    } catch { /* no git root */ }
  }
  if (args.scope === "user" || args.scope === "all") {
    dirs.push(getUserMemoryDir())
  }

  // Load memories from all directories
  let allMemories: QualityMemory[] = []
  for (const dir of dirs) {
    const memories = await loadQualityMemories(dir)
    allMemories = allMemories.concat(memories)
  }

  // Evaluate
  const evaluator = new DefaultMemoryQualityEvaluator()
  const report = evaluator.evaluate(allMemories)

  // Output
  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatQualityConsole(report))
  }
}

main().catch((err) => {
  console.error("Quality evaluation failed:", err)
  process.exit(1)
})
