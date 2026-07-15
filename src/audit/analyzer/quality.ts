/**
 * opencode-memory — Quality Analyzer
 *
 * Detects memory files with quality issues:
 * - Missing required frontmatter fields (name, description, type)
 * - Description is placeholder/truncated text
 * - Content body is empty
 * - Generic name patterns
 */

import type { AuditedMemory, AuditFinding, AuditAnalyzer } from "../index.js"
import type { EvaluationContext } from "../../evaluation/types.js"
import { parseFrontmatter } from "../../store.js"

export class QualityAnalyzer implements AuditAnalyzer {
  name = "quality"

  analyze(memories: AuditedMemory[], _ctx: EvaluationContext): AuditFinding[] {
    const findings: AuditFinding[] = []

    for (const mem of memories) {
      const fm = parseFrontmatter(mem.content)

      // Check missing name
      if (!fm.name) {
        findings.push({
          severity: "warning",
          category: "quality",
          message: `Missing "name" field in frontmatter`,
          files: [mem.filename],
          suggestion: "Add a descriptive name to the frontmatter",
        })
      }

      // Check missing description
      if (!fm.description) {
        findings.push({
          severity: "warning",
          category: "quality",
          message: `Missing "description" field in frontmatter`,
          files: [mem.filename],
          suggestion: "Add a one-line description for recall matching",
        })
      }

      // Check truncated/placeholder description
      if (this.isTruncatedDescription(fm.description)) {
        findings.push({
          severity: "critical",
          category: "quality",
          message: "Description field contains truncated or placeholder text",
          files: [mem.filename],
          suggestion: "Review and manually fix the description",
        })
      }

      // Check generic name
      if (fm.name === "Explicit Feedback") {
        findings.push({
          severity: "info",
          category: "quality",
          message: "Generic name 'Explicit Feedback' — should be more specific",
          files: [mem.filename],
          suggestion: "Rename to reflect the actual feedback content",
        })
      }

      // Check empty content body
      const bodyContent = mem.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
      if (bodyContent.length === 0) {
        findings.push({
          severity: "critical",
          category: "quality",
          message: "Memory file has empty content body",
          files: [mem.filename],
          suggestion: "Delete this file or add meaningful content",
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
