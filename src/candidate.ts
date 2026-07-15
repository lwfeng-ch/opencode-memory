/**
 * opencode-memory — Typed Memory Candidate Detection
 *
 * Detects structured observations in conversation messages and produces
 * candidate memories with confidence levels. The confidence determines
 * routing:
 *
 *   explicit/observed → auto-promote (no Dream needed)
 *   inferred/derived  → Dream reviews
 *
 * Candidates go in semantic/candidates/ — NOT final memories.
 * Dream's consolidate phase reviews and promotes the worthy ones.
 *
 * Borrows Qwen Code's direct-extract concept while preserving provenance.
 */

import { join } from "path"

export interface StructuredCandidate {
  candidateType: "user" | "project" | "reference"
  confidence: "explicit" | "observed" | "inferred"
  content: string
  matchedPattern: string
}

/**
 * Patterns that indicate a structured observation worth extracting as a
 * typed candidate memory.
 *
 * Conservative: only clear, high-signal patterns match.
 */
const STRUCTURED_PATTERNS: Array<{
  type: StructuredCandidate["candidateType"]
  confidence: StructuredCandidate["confidence"]
  pattern: RegExp
}> = [
  // User role/expertise (English)
  { type: "user", confidence: "observed", pattern: /i'?m\s+(?:a|an)\s+(senior|junior|lead|principal)?\s*(go|python|java|rust|typescript|frontend|backend|fullstack|devops)\s*(engineer|developer|architect)/i },
  // User role/expertise (Chinese)
  { type: "user", confidence: "observed", pattern: /我(?:是|做)\s*(?:一个|一名)?\s*(高级|初级|资深)?\s*(go|python|java|rust|前端|后端|全栈)\s*(工程师|开发者|架构师)/i },
  // Project decisions (English)
  { type: "project", confidence: "inferred", pattern: /we\s+(?:decided|chose|will use|are using)\s+/i },
  // Project decisions (Chinese)
  { type: "project", confidence: "inferred", pattern: /我们(?:决定|选择|要用|使用)\s+/i },
  // External references
  { type: "reference", confidence: "inferred", pattern: /(?:dashboard|tracker|board|wiki)\s+(?:at|on|in)\s+/i },
  { type: "reference", confidence: "observed", pattern: /(?:grafana|jira|linear|slack|notion)\s*\.?\s*(internal|com|io)?/i },
]

/**
 * Get the candidates directory path.
 */
export function getCandidateDir(memoryDir: string): string {
  return join(memoryDir, "semantic", "candidates")
}

/**
 * Detect structured observations in conversation messages.
 * Returns candidates for Dream approval — NOT final memories.
 *
 * Conservative: only clear, high-signal patterns match.
 * Everything else stays as session notes for Dream to process.
 */
export function detectStructuredObservations(
  messages: Array<{ role?: string; content?: string }>,
): StructuredCandidate[] {
  const candidates: StructuredCandidate[] = []

  for (const msg of messages) {
    if (msg.role !== "user") continue
    const text = msg.content ?? ""
    if (!text || typeof text !== "string") continue

    for (const { type, confidence, pattern } of STRUCTURED_PATTERNS) {
      const match = text.match(pattern)
      if (match && match.index !== undefined) {
        const start = Math.max(0, match.index - 20)
        const end = Math.min(text.length, match.index + match[0].length + 100)
        const content = text.slice(start, end).trim()
        candidates.push({
          candidateType: type,
          confidence,
          content,
          matchedPattern: match[0],
        })
      }
    }
  }

  return candidates
}

/**
 * Build candidate memory file content with provenance frontmatter.
 *
 * Confidence-based routing:
 *   explicit/observed → status: auto_promote (skip Dream)
 *   inferred/derived  → status: pending_approval (Dream reviews)
 */
export function buildCandidateMemory(
  candidate: StructuredCandidate,
  sessionId: string,
): string {
  const status = (candidate.confidence === "explicit" || candidate.confidence === "observed")
    ? "auto_promote"
    : "pending_approval"

  return [
    "---",
    `name: Candidate: ${candidate.candidateType}`,
    `description: ${candidate.content.slice(0, 100)}`,
    `type: ${candidate.candidateType}`,
    `confidence: ${candidate.confidence}`,
    "source:",
    "  kind: extraction_candidate",
    `  fact_id: ${sessionId}`,
    `status: ${status}`,
    "---",
    "",
    candidate.content,
  ].join("\n")
}
