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
 * Extract meaningful keywords from text (lowercase, > 3 chars, not stop words).
 */
export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  return [...new Set(words)]
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
