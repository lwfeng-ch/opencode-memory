/**
 * opencode-memory — ProvenanceValidator (v0.4.1)
 *
 * Evaluates the provenance quality of a memory: source trust, extraction
 * confidence, history integrity, and claim calibration.
 *
 * See: docs/superpowers/specs/v0.4.1/04-provenance-validator.md
 */

import type { MemoryProvenance, ProvenanceSourceType } from "../../memory/provenance.js"

// ---------------------------------------------------------------------------
// Source Trust
// ---------------------------------------------------------------------------

const SOURCE_TRUST_SCORES: Record<ProvenanceSourceType, number> = {
  user: 1.0,
  feedback: 1.0,
  extraction: 0.8,
  session: 0.6,
  migration: 0.4,
}

export function evaluateSourceTrust(sourceType: ProvenanceSourceType): number {
  return SOURCE_TRUST_SCORES[sourceType] ?? 0.2
}

// ---------------------------------------------------------------------------
// Extraction Confidence
// ---------------------------------------------------------------------------

export function evaluateExtractionConfidence(
  extraction?: { method?: string; confidenceScore?: number },
): number {
  if (!extraction) return 0.5
  const cs = extraction.confidenceScore

  // No confidence score — use method-based defaults
  if (cs === undefined) {
    switch (extraction.method) {
      case "explicit": return 1.0
      case "llm": return 0.5
      case "dream": return 0.4
      default: return 0.5
    }
  }

  // confidenceScore defined — calibrate by method
  switch (extraction.method) {
    case "explicit":
      return cs // explicit trust is direct
    case "llm":
      if (cs >= 0.8) return cs
      if (cs >= 0.5) return cs * 0.9
      return cs * 0.7
    case "dream":
      return cs * 0.8
    default:
      return cs * 0.8
  }
}

// ---------------------------------------------------------------------------
// History Integrity
// ---------------------------------------------------------------------------

export function evaluateHistoryIntegrity(
  history: Array<{ action: string; timestamp: number; actor?: string }>,
): { score: number; issues: string[] } {
  const issues: string[] = []

  if (!history || history.length === 0) {
    return { score: 0, issues: ["empty history"] }
  }

  // Check for created event
  const hasCreated = history.some((e) => e.action === "created")
  if (!hasCreated) issues.push("missing created event")

  // Check for actor jumps
  let lastActor: string | undefined
  let jumpCount = 0
  for (const event of history) {
    if (lastActor && event.actor && event.actor !== lastActor) {
      jumpCount++
    }
    if (event.actor) lastActor = event.actor
  }
  if (jumpCount > 2) issues.push(`actor jumped ${jumpCount} times`)

  // Check for timestamp going backward
  for (let i = 1; i < history.length; i++) {
    if (history[i].timestamp < history[i - 1].timestamp) {
      issues.push(`timestamp went backward at index ${i}`)
      break
    }
  }

  // Check for abnormal intervals (< 1ms)
  for (let i = 1; i < history.length; i++) {
    const diff = history[i].timestamp - history[i - 1].timestamp
    if (diff > 0 && diff < 1) {
      issues.push(`abnormal interval at index ${i}`)
    }
  }

  // Compute score
  let score = 1.0
  if (!hasCreated) score -= 0.3
  if (jumpCount > 2) score -= 0.2
  if (issues.some((i) => i.startsWith("timestamp went backward"))) score -= 0.3
  if (issues.some((i) => i.startsWith("abnormal interval"))) score -= 0.1
  score = Math.max(0, score)

  return { score, issues }
}

// ---------------------------------------------------------------------------
// Claim Calibration
// ---------------------------------------------------------------------------

export function calibrateClaimConfidence(
  confidence: "explicit" | "inferred" | "uncertain",
  extractionConfidence?: number,
): { score: number; warnings: string[] } {
  const warnings: string[] = []

  if (confidence === "explicit") {
    if (extractionConfidence !== undefined && extractionConfidence < 0.3) {
      warnings.push("explicit claim but low extraction confidence")
    }
    return { score: extractionConfidence !== undefined && extractionConfidence >= 0.8 ? 1.0 : 0.8, warnings }
  }

  if (confidence === "inferred") {
    if (extractionConfidence !== undefined && extractionConfidence >= 0.8) {
      return { score: 0.8, warnings }
    }
    return { score: 0.6, warnings }
  }

  // uncertain
  return { score: 0.3, warnings }
}

// ---------------------------------------------------------------------------
// Overall Provenance Confidence
// ---------------------------------------------------------------------------

export interface ProvenanceConfidenceInput {
  provenance?: MemoryProvenance
  confidence: "explicit" | "inferred" | "uncertain"
}

export interface ProvenanceConfidenceResult {
  score: number
  hasSource: boolean
  hasExtraction: boolean
  extractionConfidence: number | null
  sourceType: string | null
}

export function computeProvenanceConfidence(
  input: ProvenanceConfidenceInput,
): ProvenanceConfidenceResult {
  if (!input.provenance) {
    return {
      score: 0.2,
      hasSource: false,
      hasExtraction: false,
      extractionConfidence: null,
      sourceType: null,
    }
  }

  const p = input.provenance

  // Source trust
  const sourceTrust = evaluateSourceTrust(p.source.type)

  // Extraction confidence
  const extractionConfScore = evaluateExtractionConfidence(p.extraction)
  const hasExtraction = p.extraction !== undefined

  // History integrity
  const historyResult = evaluateHistoryIntegrity(p.history)

  // Claim calibration
  const claimResult = calibrateClaimConfidence(
    input.confidence,
    p.extraction?.confidenceScore,
  )

  // Weighted combination
  const score =
    sourceTrust * 0.30 +
    extractionConfScore * 0.25 +
    historyResult.score * 0.20 +
    claimResult.score * 0.25

  return {
    score: Math.round(score * 100) / 100,
    hasSource: true,
    hasExtraction,
    extractionConfidence: p.extraction?.confidenceScore ?? null,
    sourceType: p.source.type,
  }
}