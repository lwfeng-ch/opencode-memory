/**
 * opencode-memory — Memory Audit Service
 *
 * Read-only memory health scanner. Orchestrates analyzers to detect
 * quality, duplicate, conflict, and staleness issues in memory files.
 *
 * CONSTRAINT: Audit NEVER modifies or deletes memory files.
 * It only outputs findings + suggestions.
 */

import { readdir, readFile, stat } from "node:fs/promises"
import { join, basename } from "node:path"
import { parseFrontmatter, ENTRYPOINT_NAME } from "../store.js"
import type { MemoryHeader, ConfidenceLevel } from "../config.js"
import type { EvaluationContext } from "../evaluation/types.js"
import { DuplicateAnalyzer } from "./analyzer/duplicate.js"
import { ConflictAnalyzer } from "./analyzer/conflict.js"
import { QualityAnalyzer } from "./analyzer/quality.js"
import { StalenessAnalyzer } from "./analyzer/staleness.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditedMemory {
  filename: string
  content: string           // full file content (with frontmatter)
  header: MemoryHeader       // parsed frontmatter
  mtimeMs: number
  scope: "user" | "project"
}

export interface AuditFinding {
  severity: "critical" | "warning" | "info"
  category: string            // "duplicate" | "conflict" | "quality" | "staleness"
  message: string
  files: string[]             // affected filenames
  suggestion?: string          // recommended action (not auto-executed)
}

export interface AuditReport {
  version: string
  timestamp: string
  scope: "user" | "project" | "all"
  summary: {
    total_memories: number
    total_findings: number
    score: number              // 0-100
    by_severity: { critical: number; warning: number; info: number }
  }
  findings: AuditFinding[]
}

export interface AuditAnalyzer {
  name: string
  analyze(memories: AuditedMemory[], ctx: EvaluationContext): AuditFinding[]
}

// ---------------------------------------------------------------------------
// MemoryAuditService
// ---------------------------------------------------------------------------

export class MemoryAuditService {
  private analyzers: AuditAnalyzer[] = []

  register(analyzer: AuditAnalyzer): void {
    this.analyzers.push(analyzer)
  }

  async run(memoryDir: string, ctx: EvaluationContext, scope: "user" | "project" = "project"): Promise<AuditReport> {
    // 1. Scan directory for .md files
    const memories = await this.loadMemories(memoryDir, scope)

    // 2. Run each analyzer
    const allFindings: AuditFinding[] = []
    for (const analyzer of this.analyzers) {
      const findings = analyzer.analyze(memories, ctx)
      allFindings.push(...findings)
    }

    // 3. Generate report
    return this.generateReport(memories, allFindings, scope)
  }

  private async loadMemories(dir: string, scope: "user" | "project"): Promise<AuditedMemory[]> {
    const memories: AuditedMemory[] = []
    try {
      const entries = await readdir(dir, { recursive: true })
      const mdFiles = entries.filter(
        (f) => f.endsWith(".md") && basename(f) !== ENTRYPOINT_NAME,
      )

      for (const relativePath of mdFiles) {
        const filePath = join(dir, relativePath)
        try {
          const stats = await stat(filePath)
          const content = await readFile(filePath, { encoding: "utf-8" })
          const fm = parseFrontmatter(content)
          memories.push({
            filename: relativePath,
            content,
            header: {
              filename: relativePath,
              filePath,
              mtimeMs: stats.mtimeMs,
              description: fm.description || null,
              type: fm.type as MemoryHeader["type"],
              scope: fm.scope as MemoryHeader["scope"],
              confidence: parseConfidence(fm.confidence),
              schemaVersion: fm.schema_version,
              recallCount: fm.recall_count ?? 0,
              lastRecalledAt: fm.last_recalled_at ?? null,
            },
            mtimeMs: stats.mtimeMs,
            scope,
          })
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory doesn't exist or unreadable
    }
    return memories
  }

  private generateReport(
    memories: AuditedMemory[],
    findings: AuditFinding[],
    scope: "user" | "project" | "all",
  ): AuditReport {
    const bySeverity = { critical: 0, warning: 0, info: 0 }
    for (const f of findings) bySeverity[f.severity]++

    const penalty = bySeverity.critical * 15 + bySeverity.warning * 5 + bySeverity.info * 1
    const score = Math.max(0, Math.min(100, 100 - penalty))

    const severityOrder = { critical: 0, warning: 1, info: 2 }
    findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

    return {
      version: "0.3.0",
      timestamp: new Date().toISOString(),
      scope,
      summary: {
        total_memories: memories.length,
        total_findings: findings.length,
        score,
        by_severity: bySeverity,
      },
      findings,
    }
  }
}

// ---------------------------------------------------------------------------
// Confidence parser (mirrors store.ts parseConfidence)
// ---------------------------------------------------------------------------

function parseConfidence(value?: string): ConfidenceLevel {
  if (!value) return "uncertain"
  const lower = value.toLowerCase().trim()
  if (lower === "explicit" || lower === "observed" || lower === "inferred" ||
      lower === "derived" || lower === "uncertain") {
    return lower as ConfidenceLevel
  }
  return "uncertain"
}

// ---------------------------------------------------------------------------
// Default factory
// ---------------------------------------------------------------------------

export function createDefaultAuditService(): MemoryAuditService {
  const service = new MemoryAuditService()
  service.register(new DuplicateAnalyzer())
  service.register(new ConflictAnalyzer())
  service.register(new QualityAnalyzer())
  service.register(new StalenessAnalyzer())
  return service
}
