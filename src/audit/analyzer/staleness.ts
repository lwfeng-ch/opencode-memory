/**
 * opencode-memory — Staleness Analyzer
 *
 * Detects non-explicit memories that have never been recalled
 * (recallCount === 0) and are older than threshold days.
 *
 * Explicit memories are NEVER flagged as stale — they are permanent.
 */

import { memoryAgeDays } from "../../staleness.js"
import type { AuditedMemory, AuditFinding, AuditAnalyzer } from "../index.js"
import type { EvaluationContext } from "../../evaluation/types.js"

const STALE_DAYS = 180
const MONITOR_DAYS = 30

export class StalenessAnalyzer implements AuditAnalyzer {
  name = "staleness"

  analyze(memories: AuditedMemory[], _ctx: EvaluationContext): AuditFinding[] {
    const findings: AuditFinding[] = []

    for (const mem of memories) {
      // Archived files: emit ignored finding, skip all checks
      if (mem.header.status === 'archived') {
        findings.push({
          severity: 'ignored',
          category: 'staleness',
          message: 'Archived memory excluded from active lifecycle',
          files: [mem.filename],
          lifecycleNote: 'Archived files are not expected to be recalled',
        })
        continue
      }

      // Explicit memories are never stale
      if (mem.header.confidence === "explicit") continue

      const ageDays = memoryAgeDays(mem.header.mtimeMs)
      const recallCount = mem.header.recallCount ?? 0

      if (recallCount === 0 && ageDays > STALE_DAYS) {
        findings.push({
          severity: "info",
          category: "staleness",
          message: `Never recalled and ${Math.floor(ageDays)} days old (non-explicit)`,
          files: [mem.filename],
          suggestion: "Candidate for prune — review and delete if no longer relevant",
        })
      } else if (recallCount === 0 && ageDays > MONITOR_DAYS) {
        findings.push({
          severity: "info",
          category: "staleness",
          message: `Never recalled and ${Math.floor(ageDays)} days old`,
          files: [mem.filename],
          suggestion: "Monitor — may become stale if not recalled soon",
        })
      }
    }
    return findings
  }
}
