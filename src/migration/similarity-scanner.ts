/**
 * opencode-memory — Similarity Scanner (v0.3.4 Phase 2)
 *
 * Scans active memories for semantic similarity using evaluation/fingerprint.ts.
 * Emits MergeCandidate objects into the Repair Queue for human approval.
 *
 * Only scans active memories — archived memories are excluded.
 */

import { computeFingerprint, jaccardSimilarity } from '../evaluation/fingerprint.js'
import type { MemoryHeader } from '../config.js'
import type { MergeCandidate, MergeReason, MergeKeepStrategy } from '../repair/candidate.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SIMILARITY_THRESHOLD = 0.8

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScannerMemory {
  filename: string
  content: string
  header: MemoryHeader
}

export interface SimilarityScannerOptions {
  /** Jaccard similarity threshold (0.0-1.0). Default 0.8. */
  threshold?: number
  /** Scope for generated candidates. */
  scope: 'user' | 'project'
}

// ---------------------------------------------------------------------------
// SimilarityScanner
// ---------------------------------------------------------------------------

export class SimilarityScanner {
  private threshold: number
  private scope: 'user' | 'project'

  constructor(options: SimilarityScannerOptions) {
    this.threshold = options.threshold ?? DEFAULT_SIMILARITY_THRESHOLD
    this.scope = options.scope
  }

  /**
   * Scan active memories and return merge candidates.
   * Only processes memories with status !== 'archived'.
   */
  scan(memories: ScannerMemory[]): MergeCandidate[] {
    // Filter to active only
    const active = memories.filter(m => !m.header.status || m.header.status === 'active')
    if (active.length < 2) return []

    // Pre-compute fingerprints
    const fingerprints = active.map(m => ({
      memory: m,
      fp: computeFingerprint(m.content),
    }))

    const candidates: MergeCandidate[] = []
    const processed = new Set<string>()

    for (let i = 0; i < fingerprints.length; i++) {
      for (let j = i + 1; j < fingerprints.length; j++) {
        const pairKey = `${fingerprints[i].memory.filename}::${fingerprints[j].memory.filename}`
        if (processed.has(pairKey)) continue
        processed.add(pairKey)

        const similarity = jaccardSimilarity(fingerprints[i].fp, fingerprints[j].fp)
        if (similarity >= this.threshold) {
          const candidate = this.buildCandidate(
            fingerprints[i].memory,
            fingerprints[j].memory,
            similarity,
          )
          if (candidate) candidates.push(candidate)
        }
      }
    }

    // Deduplicate: group by targetFile, keep highest similarity
    return this.deduplicateCandidates(candidates)
  }

  private buildCandidate(
    a: ScannerMemory,
    b: ScannerMemory,
    similarity: number,
  ): MergeCandidate | null {
    const [target, source] = this.selectTarget(a, b)
    if (!target) return null

    const reason = this.detectReason(a, b)
    const confidence: 'high' | 'medium' | 'low' =
      similarity >= 0.9 ? 'high' : similarity >= 0.85 ? 'medium' : 'low'

    return {
      id: `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'merge' as const,
      sourceFiles: [source.filename],
      targetFile: target.filename,
      similarity: Math.round(similarity * 100) / 100,
      reason,
      confidence,
      mergeStrategy: {
        keep: 'higher_confidence' as MergeKeepStrategy,
      },
      scope: this.scope,
    }
  }

  /**
   * Select target (keep) and source (archive) from a pair.
   * Priority: explicit > inferred > description length > filename.
   */
  private selectTarget(
    a: ScannerMemory,
    b: ScannerMemory,
  ): [ScannerMemory, ScannerMemory] {
    const confidenceScore = (h: MemoryHeader): number => {
      if (h.confidence === 'explicit') return 3
      if (h.confidence === 'inferred') return 1
      return 0
    }

    const scoreA = confidenceScore(a.header)
    const scoreB = confidenceScore(b.header)

    if (scoreA !== scoreB) {
      return scoreA >= scoreB ? [a, b] : [b, a]
    }

    // Tie-break: longer description
    const descA = (a.header.description ?? '').length
    const descB = (b.header.description ?? '').length
    if (descA !== descB) {
      return descA >= descB ? [a, b] : [b, a]
    }

    // Tie-break: filename alphabetical (stable)
    return a.filename <= b.filename ? [a, b] : [b, a]
  }

  private detectReason(a: ScannerMemory, b: ScannerMemory): MergeReason {
    const isFeedbackA = a.filename.startsWith('feedback_')
    const isFeedbackB = b.filename.startsWith('feedback_')
    if (isFeedbackA && isFeedbackB) return 'feedback_duplicate'
    return 'semantic_duplicate'
  }

  /**
   * Deduplicate candidates using connected-components approach.
   * If candidate A's target overlaps with candidate B's sources (or vice versa),
   * merge them into a single candidate with the highest-confidence target.
   */
  private deduplicateCandidates(candidates: MergeCandidate[]): MergeCandidate[] {
    if (candidates.length <= 1) return candidates

    // Build adjacency: for each candidate, all files involved (target + sources)
    const groups: MergeCandidate[] = []

    for (const c of candidates) {
      const allFiles = new Set([c.targetFile, ...c.sourceFiles])
      let merged = false

      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi]
        const groupFiles = new Set([group.targetFile, ...group.sourceFiles])

        // Check overlap: any file in common?
        for (const f of allFiles) {
          if (groupFiles.has(f)) {
            // Merge c into this group — keep the existing target; merge source lists
            for (const src of c.sourceFiles) {
              if (!group.sourceFiles.includes(src) && src !== group.targetFile) {
                group.sourceFiles.push(src)
              }
            }

            if (c.similarity > group.similarity) {
              group.similarity = c.similarity
            }

            merged = true
            break
          }
        }
        if (merged) break
      }

      if (!merged) {
        groups.push({ ...c, sourceFiles: [...c.sourceFiles] })
      }
    }

    return groups
  }
}