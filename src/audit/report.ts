/**
 * opencode-memory — Audit Report formatting
 *
 * Output formatters for AuditReport: JSON, Markdown, Console.
 * v0.3.4: handles ignored severity + lifecycleSummary.
 */

import type { AuditReport } from "./index.js"

export function formatAuditJSON(report: AuditReport): string {
  return JSON.stringify(report, null, 2)
}

export function formatAuditMarkdown(report: AuditReport): string {
  const lines: string[] = []
  lines.push(`# Memory Audit Report`)
  lines.push("")
  lines.push(`**Version**: ${report.version}`)
  lines.push(`**Timestamp**: ${report.timestamp}`)
  lines.push(`**Scope**: ${report.scope}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(`| Metric | Value |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Total memories | ${report.summary.total_memories} |`)
  lines.push(`| Active findings | ${report.active_findings ?? report.summary.total_findings} |`)
  lines.push(`| Lifecycle excluded | ${report.lifecycle_excluded ?? 0} |`)
  lines.push(`| Score | ${report.summary.score}/100 |`)
  lines.push(`| Critical | ${report.summary.by_severity.critical} |`)
  lines.push(`| Warning | ${report.summary.by_severity.warning} |`)
  lines.push(`| Info | ${report.summary.by_severity.info} |`)
  lines.push(`| Ignored | ${report.summary.by_severity.ignored} |`)
  if (report.lifecycleSummary) {
    lines.push(`| Active memories | ${report.lifecycleSummary.active} |`)
    lines.push(`| Archived memories | ${report.lifecycleSummary.archived} |`)
  }
  lines.push("")

  if (report.findings.length > 0) {
    lines.push("## Findings")
    lines.push("")
    for (const f of report.findings) {
      const icon = f.severity === "critical" ? "🔴" : f.severity === "warning" ? "🟡" : f.severity === "info" ? "🔵" : "⚪"
      lines.push(`### ${icon} [${f.severity.toUpperCase()}] ${f.category}`)
      lines.push("")
      lines.push(`**Files**: ${f.files.join(", ")}`)
      lines.push("")
      lines.push(`**Message**: ${f.message}`)
      if (f.lifecycleNote) {
        lines.push("")
        lines.push(`**Lifecycle**: ${f.lifecycleNote}`)
      }
      if (f.suggestion) {
        lines.push("")
        lines.push(`**Suggestion**: ${f.suggestion}`)
      }
      lines.push("")
    }
  } else {
    lines.push("## No findings — all clear! ✅")
  }

  return lines.join("\n")
}

export function formatAuditConsole(report: AuditReport): string {
  const lines: string[] = []
  const sevIcon: Record<string, string> = { critical: "X", warning: "!", info: "i", ignored: "-" }

  lines.push("=== Memory Audit Report ===")
  lines.push(`Scope: ${report.scope}  |  Memories: ${report.summary.total_memories}  |  Score: ${report.summary.score}/100`)
  lines.push(`Active findings: ${report.active_findings ?? report.summary.total_findings}  |  Lifecycle excluded: ${report.lifecycle_excluded ?? 0}`)
  lines.push(`Findings: critical: ${report.summary.by_severity.critical}, warning: ${report.summary.by_severity.warning}, info: ${report.summary.by_severity.info}, ignored: ${report.summary.by_severity.ignored}`)
  if (report.lifecycleSummary) {
    lines.push(`Lifecycle: active: ${report.lifecycleSummary.active}, archived: ${report.lifecycleSummary.archived}`)
  }
  lines.push("")

  if (report.findings.length > 0) {
    for (const f of report.findings) {
      const icon = sevIcon[f.severity] ?? "?"
      lines.push(`[${icon}] [${f.category}] ${f.message}`)
      lines.push(`    Files: ${f.files.join(", ")}`)
      if (f.lifecycleNote) {
        lines.push(`    Lifecycle: ${f.lifecycleNote}`)
      }
      if (f.suggestion) {
        lines.push(`    Suggestion: ${f.suggestion}`)
      }
      lines.push("")
    }
  } else {
    lines.push("All clear — no issues found.")
  }

  return lines.join("\n")
}