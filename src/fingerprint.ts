/**
 * opencode-memory — Fingerprint (re-export shim)
 *
 * Migrated to src/evaluation/fingerprint.ts in v0.3.0.
 * This file re-exports for backward compatibility.
 * Update imports to use ./evaluation/fingerprint.js directly.
 *
 * @deprecated Use ./evaluation/fingerprint.js instead
 */

export {
  extractKeywords,
  jaccardSimilarity,
  computeFingerprint,
  shouldMerge,
} from "./evaluation/fingerprint.js"
