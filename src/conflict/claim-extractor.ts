/**
 * opencode-memory — ClaimExtractor (v0.4.2)
 *
 * Extracts atomic (subject, predicate, value) claims from memory content.
 * Claims are the unit of conflict detection — not files.
 *
 * Three extraction rules:
 * 1. Pattern-based: regex patterns for common claim structures
 * 2. Frontmatter-based: structured fields from memory frontmatter
 * 3. Fallback: generic claim from first sentence
 *
 * See: docs/superpowers/specs/v0.4.2/02-claim-extraction.md
 */

import type { MemoryProvenance } from "../memory/provenance.js"
import { generateClaimId, type MemoryClaim } from "./types.js"

// ---------------------------------------------------------------------------
// Extraction Pattern
// ---------------------------------------------------------------------------

interface ExtractionPattern {
  regex: RegExp
  extract(match: RegExpExecArray, filename: string, provenance?: MemoryProvenance): MemoryClaim | null
}

// ---------------------------------------------------------------------------
// Pattern Registry
// ---------------------------------------------------------------------------

const PATTERNS: ExtractionPattern[] = [
  // "User prefers X over Y" or "User prefers X"
  {
    regex: /[Uu]ser\s+prefers?\s+(\w+)/,
    extract(match, filename, provenance) {
      return {
        id: generateClaimId(),
        subject: "user",
        predicate: "preference",
        value: match[1].toLowerCase(),
        sourceMemory: filename,
        sourceProvenance: provenance,
      }
    },
  },

  // "User uses X" or "User uses X for Y"
  {
    regex: /[Uu]ser\s+uses?\s+(\w+)/,
    extract(match, filename, provenance) {
      return {
        id: generateClaimId(),
        subject: "user",
        predicate: "uses",
        value: match[1].toLowerCase(),
        sourceMemory: filename,
        sourceProvenance: provenance,
      }
    },
  },

  // "Project uses X"
  {
    regex: /[Pp]roject\s+uses?\s+(\w+)/,
    extract(match, filename, provenance) {
      return {
        id: generateClaimId(),
        subject: "project",
        predicate: "uses",
        value: match[1].toLowerCase(),
        sourceMemory: filename,
        sourceProvenance: provenance,
      }
    },
  },

  // "Now using X" (superseded signal)
  {
    regex: /[Nn]ow\s+using\s+(\w+)/,
    extract(match, filename, provenance) {
      return {
        id: generateClaimId(),
        subject: "user",
        predicate: "uses",
        value: match[1].toLowerCase(),
        sourceMemory: filename,
        sourceProvenance: provenance,
      }
    },
  },

  // "Switched to X" / "Migrated to X" / "Changed to X"
  {
    regex: /(?:switched|migrated|changed)\s+to\s+(\w+)/i,
    extract(match, filename, provenance) {
      return {
        id: generateClaimId(),
        subject: "user",
        predicate: "uses",
        value: match[1].toLowerCase(),
        sourceMemory: filename,
        sourceProvenance: provenance,
      }
    },
  },
]

// ---------------------------------------------------------------------------
// ClaimExtractor
// ---------------------------------------------------------------------------

export class ClaimExtractor {
  /**
   * Extract claims from memory content.
   * Returns an empty array if no claims can be extracted.
   */
  extractClaims(
    content: string,
    filename: string,
    provenance?: MemoryProvenance,
  ): MemoryClaim[] {
    const claims: MemoryClaim[] = []
    const seen = new Set<string>()

    for (const pattern of PATTERNS) {
      const regex = new RegExp(pattern.regex.source, "gi")
      let match: RegExpExecArray | null
      while ((match = regex.exec(content)) !== null) {
        const claim = pattern.extract(match, filename, provenance)
        if (claim) {
          const key = `${claim.subject}:${claim.predicate}:${claim.value}`
          if (!seen.has(key)) {
            seen.add(key)
            claims.push(claim)
          }
        }
      }
    }

    // If no claims extracted, generate fallback
    if (claims.length === 0) {
      const fallback = this.extractFallback(content, filename, provenance)
      if (fallback) claims.push(fallback)
    }

    return claims
  }

  /**
   * Fallback: extract first meaningful sentence as a generic claim.
   */
  private extractFallback(
    content: string,
    filename: string,
    provenance?: MemoryProvenance,
  ): MemoryClaim | null {
    // Strip frontmatter
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
    if (!body) return null

    // Take first sentence
    const firstSentence = body.split(/[.!?\n]/)[0]?.trim()
    if (!firstSentence || firstSentence.length < 3) return null

    return {
      id: generateClaimId(),
      subject: "memory",
      predicate: "about",
      value: firstSentence.slice(0, 100),
      sourceMemory: filename,
      sourceProvenance: provenance,
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

export function containsSupersededSignal(content: string): boolean {
  const lower = content.toLowerCase()
  return [
    "switched to", "migrated to", "now using", "no longer",
    "改用", "迁移到", "不再使用", "切换为",
    "upgraded to", "replaced by", "changed to",
  ].some((kw) => lower.includes(kw))
}