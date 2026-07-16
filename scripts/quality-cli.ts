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
import { DefaultMemoryQualityEvaluator, type QualityMemory } from "../src/evaluation/quality-score.js"
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

function formatQualityConsole(report: ReturnType<DefaultMemoryQualityEvaluator["evaluate"]>): string {
  const lines: string[] = []
  lines.push("=== Memory Quality Report ===")
  lines.push(`Overall: ${report.overall}/100`)
  lines.push("")
  lines.push("Dimensions:")
  lines.push(`  Completeness:   ${report.dimensions.completeness}/100`)
  lines.push(`  Consistency:    ${report.dimensions.consistency}/100`)
  lines.push(`  Freshness:      ${report.dimensions.freshness}/100`)
  lines.push(`  Noise:          ${report.dimensions.noise}/100`)
  lines.push(`  Retrievability: ${report.dimensions.retrievability}/100`)
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
