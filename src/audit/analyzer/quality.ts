/**
 * opencode-memory — Quality Analyzer
 *
 * Detects memory files with quality issues:
 * - Missing required frontmatter fields (name, description, type)
 * - Description is placeholder/truncated text
 * - Content body is empty
 * - Generic name patterns
 *
 * v0.3.4 Phase 1: Lifecycle-aware — archived files get downgraded severity.
 */

import type { AuditedMemory, AuditFinding, AuditAnalyzer } from "../index.js"
import type { EvaluationContext } from "../../evaluation/types.js"
import { parseFrontmatter } from "../../store.js"

const SKIP_FILES = new Set(["MEMORY.md", "ARCHIVE.md"])

export class QualityAnalyzer implements AuditAnalyzer {
  name = "quality"

  analyze(memories: AuditedMemory[], _ctx: EvaluationContext): AuditFinding[] {
    const findings: AuditFinding[] = []

    for (const mem of memories) {
      // Skip manifest files — they are indexes, not memory files
      if (SKIP_FILES.has(mem.filename)) continue

      const isArchived = mem.header.status === 'archived'
      const fm = parseFrontmatter(mem.content)

      // Check missing name
      if (!fm.name) {
        findings.push({
          severity: isArchived ? 'warning' : 'warning',
          category: 'quality',
          message: isArchived
            ? 'Archived memory missing "name" field in frontmatter'
            : 'Missing "name" field in frontmatter',
          files: [mem.filename],
          suggestion: 'Add a descriptive name to the frontmatter',
          ...(isArchived ? { lifecycleNote: 'Archived memory — metadata should still be complete' } : {}),
        })
      }

      // Check missing description
      if (!fm.description) {
        findings.push({
          severity: isArchived ? 'warning' : 'warning',
          category: 'quality',
          message: isArchived
            ? 'Archived memory missing "description" field in frontmatter'
            : 'Missing "description" field in frontmatter',
          files: [mem.filename],
          suggestion: 'Add a one-line description for recall matching',
          ...(isArchived ? { lifecycleNote: 'Archived memory — metadata should still be complete' } : {}),
        })
      }

      // Check truncated/placeholder description — archived: info, active: critical
      if (this.isTruncatedDescription(fm.description)) {
        findings.push({
          severity: isArchived ? 'info' : 'critical',
          category: 'quality',
          message: isArchived
            ? 'Archived memory has truncated description'
            : 'Description field contains truncated or placeholder text',
          files: [mem.filename],
          suggestion: 'Review and manually fix the description',
          ...(isArchived ? { lifecycleNote: 'Archived memory — truncated description is lower priority' } : {}),
        })
      }

      // Check generic name
      if (fm.name === 'Explicit Feedback') {
        findings.push({
          severity: 'info',
          category: 'quality',
          message: "Generic name 'Explicit Feedback' — should be more specific",
          files: [mem.filename],
          suggestion: 'Rename to reflect the actual feedback content',
        })
      }

      // Check empty content body — archived: info, active: critical
      const bodyContent = mem.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
      if (bodyContent.length === 0) {
        findings.push({
          severity: isArchived ? 'info' : 'critical',
          category: 'quality',
          message: isArchived
            ? 'Archived memory has empty content body'
            : 'Memory file has empty content body',
          files: [mem.filename],
          suggestion: 'Delete this file or add meaningful content',
          ...(isArchived ? { lifecycleNote: 'Archived memory — empty body is expected for some use cases' } : {}),
        })
      }
    }
    return findings
  }

  private isTruncatedDescription(desc?: string): boolean {
    if (!desc) return false
    // Detect truncated text patterns
    return desc.includes("##") || desc.includes("**In") ||
           desc.length > 200 ||
           desc.endsWith("*")
  }
}