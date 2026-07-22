/**
 * opencode-memory — Extraction Types (v0.3.4 Phase 4, migrated from extraction.ts)
 */

// ---------------------------------------------------------------------------
// v0.3.2: Core extraction types (side-effect-isolated)
// ---------------------------------------------------------------------------

/** Chat message with typed role. */
export interface Message {
  role: "system" | "user" | "assistant" | "tool"
  content: string
}

/** Context that scopes the extraction (where/why/who). */
export interface ExtractionContext {
  project?: string
  agent?: string
  sessionId?: string
  scope?: "user" | "project"
}

/** Observability metadata (who generated this, when). */
export interface ExtractionMetadata {
  source?: string
  timestamp?: number
  client?: string
}

/** Input to extractMemories(). Designed for forward extension. */
export interface ExtractionInput {
  messages: Message[]
  context?: ExtractionContext
  metadata?: ExtractionMetadata
}

/** Extraction configuration — affects output, must be cache-keyed. */
export interface ExtractionOptions {
  maxMemories?: number
  confidenceThreshold?: number
  enableValidation?: boolean
  enableFingerprint?: boolean
  fingerprintThreshold?: number
  promotionMode?: string
  promptVersion?: string
}

/** A single extracted memory candidate produced by extractMemories(). */
export interface MemoryCandidate {
  name: string
  description: string
  content: string
  type: string
  scope?: string
  confidence: string
  /** Optional provenance source identifier */
  source?: string
}

/** Output of extractMemories(). */
export interface ExtractionResult {
  memories: MemoryCandidate[]
  raw: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  metadata?: {
    model: string
    durationMs: number
    promptVersion: string
  }
}