/**
 * opencode-memory — Duplicate Analyzer
 *
 * Detects memory files with TF-IDF Jaccard similarity > 0.8.
 * Reuses evaluation/fingerprint.ts shouldMerge().
 */

import { shouldMerge } from "../../evaluation/fingerprint.js"
import type { AuditedMemory, AuditFinding, AuditAnalyzer } from "../index.js"
import type { EvaluationContext } from "../../evaluation/types.js"

export class DuplicateAnalyzer implements AuditAnalyzer {
  name = "duplicate"

  analyze(memories: AuditedMemory[], _ctx: EvaluationContext): AuditFinding[] {
    const findings: AuditFinding[] = []
    const processed = new Set<string>()

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const key = `${i}-${j}`
        if (processed.has(key)) continue

        const a = memories[i]
        const b = memories[j]

        // Skip empty content
        const aBody = a.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
        const bBody = b.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
        if (aBody.length === 0 || bBody.length === 0) continue

        if (shouldMerge(a.content, b.content)) {
          processed.add(key)
          findings.push({
            severity: "warning",
            category: "duplicate",
            message: `High semantic similarity (>0.8) between ${a.filename} and ${b.filename}`,
            files: [a.filename, b.filename],
            suggestion: "Merge or delete one of the duplicates",
          })
        }
      }
    }
    return findings
  }
}
