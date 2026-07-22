/**
 * opencode-memory — Extraction Module (v0.3.4 Phase 4)
 *
 * Compatibility shim — re-exports all public API from the new extraction/ module.
 * All external imports from "./extraction.js" continue to work.
 *
 * Original file (1345 lines) split into:
 *   extraction/types.ts     — Public types
 *   extraction/builder.ts   — Prompt construction
 *   extraction/parser.ts    — LLM response parsing
 *   extraction/validator.ts — Candidate validation
 *   extraction/writer.ts    — Memory persistence
 *   extraction/core.ts      — Pipeline orchestration
 *   extraction/index.ts     — Public exports
 */

export type {
  Message,
  ExtractionContext,
  ExtractionMetadata,
  ExtractionInput,
  ExtractionOptions,
  MemoryCandidate,
  ExtractionResult,
} from "./extraction/types.js"

export {
  DEFAULT_SESSION_MEMORY_TEMPLATE,
  buildExtractionPrompt,
  formatMessagesForExtraction,
  DEFAULT_EXTRACTION_SYSTEM_PROMPT,
} from "./extraction/builder.js"

export {
  extractResponseText,
  parseExtractionResponse,
  extractConversationText,
  parseSemanticFrontmatter,
} from "./extraction/parser.js"

export {
  validateCandidate,
  validateExtractionOutput,
} from "./extraction/validator.js"

export {
  sessionSemanticPath,
  buildProvenanceFrontmatter,
  stripFrontmatter,
  formatFactSummary,
  formatExistingMemories,
  readProcessingMetadata,
  writeProcessingMetadata,
  recordExtractionFailure,
  recordExtractionSuccess,
  classifyFailure,
  computeRetryAfter,
} from "./extraction/writer.js"

export {
  extractMemories,
  extractSessionMemory,
} from "./extraction/core.js"