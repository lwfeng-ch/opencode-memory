/**
 * opencode-memory — WorthinessScore (v0.4.1)
 *
 * Memory Worthiness Score = Content Quality × Lifecycle Validity × Provenance Confidence
 *
 * See: docs/superpowers/specs/v0.4.1/02-worthiness-score.md
 */

import type { MemoryProvenance } from "../memory/provenance.js"
import { computeProvenanceConfidence } from "./dimensions/provenance.js"
import { computeLifecycleValidity, type LifecycleValidityInput } from "./dimensions/lifecycle.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorthinessScoreInput {
  contentQuality: number
  lifecycle: LifecycleValidityInput
  provenance?: MemoryProvenance
  confidence: "explicit" | "inferred" | "uncertain"
}

export interface WorthinessReport {
  filename: string

  contentQuality: {
    score: number
  }

  lifecycleValidity: {
    score: number
    status: "active" | "archived"
    stability: number
  }

  provenanceConfidence: {
    score: number
    hasSource: boolean
    hasExtraction: boolean
    extractionConfidence: number | null
    sourceType: string | null
  }

  worthinessScore: number
  recommendation: "keep" | "review" | "archive" | "delete"
}

// ---------------------------------------------------------------------------
// Worthiness Score
// ---------------------------------------------------------------------------

export function computeWorthiness(input: WorthinessScoreInput): WorthinessReport {
  const contentQualityScore = Math.max(0, Math.min(1, input.contentQuality))

  const lifecycleResult = computeLifecycleValidity(input.lifecycle)

  const provenanceResult = computeProvenanceConfidence({
    provenance: input.provenance,
    confidence: input.confidence,
  })

  const worthinessScore = Math.round(
    contentQualityScore * lifecycleResult.score * provenanceResult.score * 100,
  ) / 100

  return {
    filename: "",
    contentQuality: {
      score: contentQualityScore,
    },
    lifecycleValidity: {
      score: lifecycleResult.score,
      status: lifecycleResult.status,
      stability: lifecycleResult.stability,
    },
    provenanceConfidence: {
      score: provenanceResult.score,
      hasSource: provenanceResult.hasSource,
      hasExtraction: provenanceResult.hasExtraction,
      extractionConfidence: provenanceResult.extractionConfidence,
      sourceType: provenanceResult.sourceType,
    },
    worthinessScore,
    recommendation: recommendationForScore(worthinessScore),
  }
}

// ---------------------------------------------------------------------------
// Recommendation mapping
// ---------------------------------------------------------------------------

export function recommendationForScore(
  score: number,
): "keep" | "review" | "archive" | "delete" {
  if (score >= 0.8) return "keep"
  if (score >= 0.5) return "review"
  if (score >= 0.2) return "archive"
  return "delete"
}

// ---------------------------------------------------------------------------
// ValidationFinding
// ---------------------------------------------------------------------------

export interface ValidationFinding {
  id: string
  filename: string
  severity: "critical" | "warning" | "info"
  worthinessScore: number
  reasons: Array<{
    dimension: "content" | "lifecycle" | "provenance"
    score: number
    detail: string
  }>
  suggestedAction: {
    type: "none" | "review" | "archive" | "delete"
    confidence: "high" | "medium" | "low"
  }
  createdAt: number
  scope: "user" | "project"
}

export function createFinding(
  report: WorthinessReport,
  scope: "user" | "project" = "project",
): ValidationFinding {
  const reasons: ValidationFinding["reasons"] = []

  reasons.push({
    dimension: "content",
    score: report.contentQuality.score,
    detail: `Content quality: ${report.contentQuality.score}`,
  })

  reasons.push({
    dimension: "lifecycle",
    score: report.lifecycleValidity.score,
    detail: `Lifecycle validity: ${report.lifecycleValidity.score} (${report.lifecycleValidity.status})`,
  })

  reasons.push({
    dimension: "provenance",
    score: report.provenanceConfidence.score,
    detail: `Provenance confidence: ${report.provenanceConfidence.score}`,
  })

  let severity: "critical" | "warning" | "info"
  let actionType: "none" | "review" | "archive" | "delete"
  let confidence: "high" | "medium" | "low"

  if (report.worthinessScore >= 0.8) {
    severity = "info"
    actionType = "none"
    confidence = "high"
  } else if (report.worthinessScore >= 0.5) {
    severity = "warning"
    actionType = "review"
    confidence = "medium"
  } else if (report.worthinessScore >= 0.2) {
    severity = "warning"
    actionType = "archive"
    confidence = "medium"
  } else {
    severity = "critical"
    actionType = "delete"
    confidence = "high"
  }

  return {
    id: `finding_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    filename: report.filename,
    severity,
    worthinessScore: report.worthinessScore,
    reasons,
    suggestedAction: { type: actionType, confidence },
    createdAt: Date.now(),
    scope,
  }
}