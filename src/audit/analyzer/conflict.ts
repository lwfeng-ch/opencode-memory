/**
 * opencode-memory — Conflict Analyzer
 *
 * Detects memory files about the same topic but with contradictory content.
 *
 * v0.3.0 fix: replaced per-keyword grouping (caused 100+ false positives)
 * with pair-wise topic-similarity check + findings deduplication.
 *
 * A "conflict" is now narrowly defined as:
 *   1. Two memories share >40% description keywords (topically related)
 *   2. AND they have a genuine factual contradiction:
 *      - Different version numbers for the same entity
 *      - Different technology names for the same purpose
 *      - Opposing statements (one says "uses X", other says "switched to Y")
 *
 * Each pair of files is reported AT MOST ONCE.
 */

import { canOverride } from "../../promotion.js"
import { extractKeywords } from "../../evaluation/fingerprint.js"
import type { AuditedMemory, AuditFinding, AuditAnalyzer } from "../index.js"
import type { EvaluationContext } from "../../evaluation/types.js"

const TOPIC_OVERLAP_THRESHOLD = 0.4

export class ConflictAnalyzer implements AuditAnalyzer {
  name = "conflict"

  analyze(memories: AuditedMemory[], _ctx: EvaluationContext): AuditFinding[] {
    const findings: AuditFinding[] = []
    const reportedPairs = new Set<string>()

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const a = memories[i]
        const b = memories[j]

        // Skip if already reported as a pair
        const pairKey = [a.filename, b.filename].sort().join("::")
        if (reportedPairs.has(pairKey)) continue

        // Check topical relation
        if (!this.isTopicallyRelated(a, b)) continue

        // Check genuine conflict
        const conflictType = this.detectConflict(a, b)
        if (!conflictType) continue

        reportedPairs.add(pairKey)

        // canOverride(oldConfidence, newConfidence) → newPriority > oldPriority
        const override = canOverride(a.header.confidence, b.header.confidence)
        const keepFile = override ? b.filename : a.filename
        const deprecateFile = override ? a.filename : b.filename

        findings.push({
          severity: "warning",
          category: "conflict",
          message: conflictType.message,
          files: [a.filename, b.filename],
          suggestion: override
            ? `Keep ${keepFile} (higher confidence), mark ${deprecateFile} as deprecated`
            : "Review manually — neither can auto-override the other",
        })
      }
    }
    return findings
  }

  /**
   * Check if two memories are topically related by comparing description keywords.
   * Returns true if Jaccard overlap of description keywords > threshold.
   */
  private isTopicallyRelated(a: AuditedMemory, b: AuditedMemory): boolean {
    const aDesc = a.header.description ?? ""
    const bDesc = b.header.description ?? ""
    const aKeywords = new Set(extractKeywords(aDesc))
    const bKeywords = new Set(extractKeywords(bDesc))

    if (aKeywords.size === 0 || bKeywords.size === 0) return false

    let intersection = 0
    for (const k of aKeywords) {
      if (bKeywords.has(k)) intersection++
    }
    const union = aKeywords.size + bKeywords.size - intersection
    const similarity = union > 0 ? intersection / union : 0

    return similarity >= TOPIC_OVERLAP_THRESHOLD
  }

  /**
   * Detect a genuine factual conflict between two topically-related memories.
   * Returns null if no conflict, or an object with conflict description.
   */
  private detectConflict(a: AuditedMemory, b: AuditedMemory): { message: string } | null {
    const aBody = this.extractBody(a.content)
    const bBody = this.extractBody(b.content)

    // If content is identical, it's a duplicate (not a conflict)
    if (aBody === bBody) return null

    // 1. Version number conflict: same entity, different version numbers
    const versionConflict = this.detectVersionConflict(a, b)
    if (versionConflict) return versionConflict

    // 2. Technology switch: one mentions switching from X to Y
    const switchConflict = this.detectTechnologySwitch(a, b)
    if (switchConflict) return switchConflict

    // 3. High keyword overlap in body but different content = potential conflict
    // Only flag if body similarity is moderate (0.3-0.7) — high (>0.7) is duplicate
    const aBodyKeywords = new Set(extractKeywords(aBody))
    const bBodyKeywords = new Set(extractKeywords(bBody))
    if (aBodyKeywords.size === 0 || bBodyKeywords.size === 0) return null

    let intersection = 0
    for (const k of aBodyKeywords) {
      if (bBodyKeywords.has(k)) intersection++
    }
    const union = aBodyKeywords.size + bBodyKeywords.size - intersection
    const bodySimilarity = union > 0 ? intersection / union : 0

    if (bodySimilarity > 0.3 && bodySimilarity < 0.7) {
      return {
        message: `Potential content conflict between ${a.filename} and ${b.filename} (body similarity ${(bodySimilarity * 100).toFixed(0)}%)`,
      }
    }

    return null
  }

  /**
   * Detect version number conflicts: e.g., "Python 3.9" vs "Python 3.12"
   */
  private detectVersionConflict(a: AuditedMemory, b: AuditedMemory): { message: string } | null {
    const aBody = this.extractBody(a.content)
    const bBody = this.extractBody(b.content)

    const versionPattern = /\b(\d+(?:\.\d+)+)\b/g
    const aVersions = new Set(aBody.match(versionPattern) ?? [])
    const bVersions = new Set(bBody.match(versionPattern) ?? [])

    if (aVersions.size === 0 || bVersions.size === 0) return null

    // Check if they share some version-like numbers but differ on others
    const aOnly = [...aVersions].filter((v) => !bVersions.has(v))
    const bOnly = [...bVersions].filter((v) => !aVersions.has(v))

    if (aOnly.length > 0 && bOnly.length > 0) {
      return {
        message: `Version conflict between ${a.filename} (${aOnly.join(", ")}) and ${b.filename} (${bOnly.join(", ")})`,
      }
    }

    return null
  }

  /**
   * Detect technology switch: one memory says "uses X", other says "switched to Y"
   * Looks for keywords like "switched", "migrated", "replaced", "changed" + technology names
   */
  private detectTechnologySwitch(a: AuditedMemory, b: AuditedMemory): { message: string } | null {
    const switchKeywords = ["switched", "migrated", "replaced", "changed", "deprecated", "no longer", "don't use", "stopped"]
    const aBody = this.extractBody(a.content).toLowerCase()
    const bBody = this.extractBody(b.content).toLowerCase()

    const aHasSwitch = switchKeywords.some((kw) => aBody.includes(kw))
    const bHasSwitch = switchKeywords.some((kw) => bBody.includes(kw))

    if (aHasSwitch || bHasSwitch) {
      // Check if they reference different technologies
      const techPattern = /\b(tensorflow|pytorch|keras|javascript|typescript|python|go|rust|java|react|vue|angular)\b/gi
      const aTechs = new Set(aBody.match(techPattern) ?? [])
      const bTechs = new Set(bBody.match(techPattern) ?? [])

      const aOnly = [...aTechs].filter((t) => !bTechs.has(t))
      const bOnly = [...bTechs].filter((t) => !aTechs.has(t))

      if (aOnly.length > 0 && bOnly.length > 0) {
        return {
          message: `Technology switch conflict: ${a.filename} (${aOnly.join(", ")}) vs ${b.filename} (${bOnly.join(", ")})`,
        }
      }
    }

    return null
  }

  private extractBody(content: string): string {
    return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
  }
}
