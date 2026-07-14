/**
 * opencode-memory — Extraction Output Validator
 *
 * Pure validation functions that check extraction LLM output before writing
 * to the memory store. Prevents garbage content from polluting the memory library.
 *
 * All functions are pure: no I/O, no side effects.
 */

// Types
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface ValidationOptions {
  maxContentBytes?: number
}

// Constants
const DEFAULT_MAX_BYTES = 12_000

// Placeholder patterns — italic description lines from session memory template
// User-specified: _A short summary_, _TODO_, _unknown_
const PLACEHOLDER_PATTERNS = [
  /^_A short 5-10 word title_$/i,
  /^_What is being worked on right now\?.*$/i,
  /^_What did the user ask for\?.*$/i,
  /^_Important files.*$/i,
  /^_Common commands.*$/i,
  /^_Errors encountered.*$/i,
  /^_What worked.*$/i,
  /^_Step-by-step.*$/i,
  /^_TODO_$/i,
  /^_unknown_$/i,
  /^_A short summary_$/i,
]

/**
 * Validate extraction LLM output before writing to the store.
 * 4 layers: schema (empty) -> section (headers) -> placeholder -> length
 */
export function validateExtractionOutput(
  content: string,
  options?: ValidationOptions,
): ValidationResult {
  const errors: string[] = []
  const maxBytes = options?.maxContentBytes ?? DEFAULT_MAX_BYTES

  // 1. Schema check - empty
  const trimmed = content.trim()
  if (trimmed.length === 0) {
    errors.push("Content is empty")
    return { valid: false, errors }
  }

  // 2. Length check
  const byteLength = Buffer.byteLength(content, "utf-8")
  if (byteLength > maxBytes) {
    errors.push(`Content size (${byteLength} bytes) exceeds maximum (${maxBytes} bytes)`)
  }

  // 3. Section check - must have markdown headers
  const lines = content.split("\n")
  const headerLines = lines.filter((l) => /^#{1,2}\s+\S/.test(l))
  if (headerLines.length === 0) {
    errors.push("No markdown section headers found — content must be structured with # headers")
    return { valid: false, errors }
  }

  // 4. Placeholder check - count sections that are placeholder-only
  let placeholderSectionCount = 0
  let currentSectionHasRealContent = false
  let inSection = false

  for (const line of lines) {
    if (/^#{1,2}\s+\S/.test(line)) {
      if (inSection && !currentSectionHasRealContent) {
        placeholderSectionCount++
      }
      inSection = true
      currentSectionHasRealContent = false
      continue
    }
    if (line.trim() === "") continue
    const isPlaceholder = PLACEHOLDER_PATTERNS.some((p) => p.test(line.trim()))
    if (!isPlaceholder) {
      currentSectionHasRealContent = true
    }
  }
  if (inSection && !currentSectionHasRealContent) {
    placeholderSectionCount++
  }

  if (placeholderSectionCount > 0 && placeholderSectionCount === headerLines.length) {
    errors.push(`${placeholderSectionCount} sections contain only placeholder text — fill in real content or remove empty sections`)
  }

  return { valid: errors.length === 0, errors }
}
