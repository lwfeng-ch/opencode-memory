/**
 * opencode-memory — Semantic Fingerprint
 *
 * TF-IDF inspired keyword extraction + Jaccard similarity for deduplication.
 * Better than SHA256 hash because it catches semantic overlap even when
 * exact text differs (e.g., "YOLOv11 training" vs "training YOLO model").
 *
 * Threshold: Jaccard > 0.8 → merge candidate.
 *
 * All functions are pure: no I/O, no side effects.
 *
 * Migrated from src/fingerprint.ts to src/evaluation/fingerprint.ts in v0.3.0.
 */

const STOP_WORDS = new Set([
  "the", "this", "that", "with", "from", "have", "will", "your", "been",
  "they", "were", "what", "when", "which", "into", "some", "them", "than",
  "only", "also", "then", "very", "just", "does", "here", "there",
  "about", "after", "before", "between", "through", "during",
  "user", "agent", "session", "memory", "file", "function",
])

/**
 * Extract meaningful keywords from text.
 *
 * Rules:
 *   - Lowercase
 *   - Preserve version-like patterns (e.g. "3.10", "v11", "YOLOv11") as single tokens
 *     by replacing dots within version numbers with underscores before splitting
 *   - Split on non-alphanumeric (keep letters, digits, spaces)
 *   - Words > 3 chars, not stop words → keyword
 *   - Version-like tokens (contains digit, > 2 chars) preserved as keywords
 *     so "Python 3_10" ≠ "Python 3_11"
 */
export function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase()
  // Preserve version-like patterns: "3.10" → "3_10", "v1.2.3" → "v1_2_3"
  const versionPreserved = lower.replace(/(\d+)\.(\d+)/g, "$1_$2")
  const cleaned = versionPreserved.replace(/[^a-z0-9_\s]/g, " ")
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0)
  const keywords = new Set<string>()

  for (const w of words) {
    // Version-like token: contains a digit and is > 2 chars (e.g. "3_10", "v11", "yolov11")
    const hasDigit = /\d/.test(w)
    const isVersionLike = hasDigit && w.length > 2

    if (isVersionLike) {
      keywords.add(w)
    } else if (w.length > 3 && !STOP_WORDS.has(w)) {
      keywords.add(w)
    }
  }

  return [...keywords]
}

/**
 * Compute Jaccard similarity between two sets.
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Compute a fingerprint (keyword set) from memory content.
 * Strips frontmatter and markdown formatting before extraction.
 */
export function computeFingerprint(content: string): Set<string> {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
  const text = body.replace(/^#+\s*/gm, "")
  return new Set(extractKeywords(text))
}

/**
 * Check if two contents are similar enough to merge.
 * Threshold: Jaccard similarity >= 0.8
 */
export function shouldMerge(
  existingContent: string,
  newContent: string,
  threshold: number = 0.8,
): boolean {
  const fp1 = computeFingerprint(existingContent)
  const fp2 = computeFingerprint(newContent)
  return jaccardSimilarity(fp1, fp2) >= threshold
}
