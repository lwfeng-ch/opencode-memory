/**
 * opencode-memory — Extraction Module (v0.3.4 Phase 4)
 *
 * Public exports for the extraction pipeline.
 * All external consumers import from "./extraction.js" (shim) or
 * from "./extraction/index.js" directly.
 */

export { extractMemories, extractSessionMemory } from "./core.js"
export { extractResponseText } from "./parser.js"
export { validateCandidate, validateExtractionOutput } from "./validator.js"
export { DEFAULT_SESSION_MEMORY_TEMPLATE, buildExtractionPrompt, formatMessagesForExtraction, DEFAULT_EXTRACTION_SYSTEM_PROMPT } from "./builder.js"
export { buildProvenanceFrontmatter, stripFrontmatter, formatFactSummary, formatExistingMemories } from "./writer.js"
export { parseSemanticFrontmatter } from "./parser.js"

export type { Message, ExtractionContext, ExtractionMetadata, ExtractionInput, ExtractionOptions, MemoryCandidate, ExtractionResult } from "./types.js"