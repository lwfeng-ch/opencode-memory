/**
 * opencode-memory — Extraction Core (v0.3.4 Phase 4)
 *
 * Pipeline orchestration: extractMemories() and extractSessionMemory().
 * Migrated from src/extraction.ts.
 */

import { readFile } from "fs/promises"
import type { MemoryPluginConfig } from "../config.js"
import { resolveAgentConfig } from "../config.js"
import type { MemoryStore } from "../store.js"
import type { RuntimeAdapter } from "../adapter.js"
import { getFactSessionPath } from "../paths.js"
import { readCursor, writeCursor } from "../cursor.js"
import { logEvent } from "../telemetry.js"
import { info as logInfo, error as logError } from "../log.js"
import { shouldMerge } from "../evaluation/fingerprint.js"
import { readMessages } from "../message-cache.js"
import { detectExplicitFeedback, buildExplicitFeedbackMemory } from "../explicit-feedback.js"
import { detectStructuredObservations, buildCandidateMemory, getCandidateDir } from "../candidate.js"
import { validateCandidate, validateExtractionOutput } from "./validator.js"
import {
  DEFAULT_EXTRACTION_SYSTEM_PROMPT,
  DEFAULT_SESSION_MEMORY_TEMPLATE,
  buildExtractionPrompt,
  formatMessagesForExtraction,
} from "./builder.js"
import {
  extractResponseText,
  extractConversationText,
  parseExtractionResponse,
  parseSemanticFrontmatter,
} from "./parser.js"
import {
  sessionSemanticPath,
  formatFactSummary,
  formatExistingMemories,
  buildProvenanceFrontmatter,
  recordExtractionFailure,
  recordExtractionSuccess,
  classifyFailure,
} from "./writer.js"
import type { ModelProvider } from "../llm/provider.js"
import type { ExtractionInput, ExtractionOptions, ExtractionResult, MemoryCandidate } from "./types.js"

// ---------------------------------------------------------------------------
// extractMemories() — side-effect-isolated core function
// ---------------------------------------------------------------------------

/**
 * Extract memory candidates from conversation messages.
 *
 * Side-effect-isolated core function:
 * - Deterministic boundary with injected external dependency (CompletionProvider)
 * - NOT a pure function (network side effects via provider.complete())
 * - Same input + same provider + temp=0 → high determinism (not guaranteed)
 *
 * Pipeline:
 *   Input → Build prompt → LLM call → Parse → Validate → Return candidates
 *
 * Does NOT:
 *   - Read from / write to MemoryStore
 *   - Track cursor offsets
 *   - Emit telemetry events
 *   - Manage session state
 *   - Touch file IO
 */
export async function extractMemories(
  input: ExtractionInput,
  provider: ModelProvider,
  options?: ExtractionOptions,
): Promise<ExtractionResult> {
  const t0 = Date.now()
  const promptVersion = options?.promptVersion ?? "extract-v1"

  // 1. Build system prompt
  const systemPrompt = DEFAULT_EXTRACTION_SYSTEM_PROMPT

  // 2. Build user prompt (serialize messages)
  const conversationText = formatMessagesForExtraction(input.messages)
  const userPrompt = [
    "Extract memories from this conversation:",
    "",
    conversationText,
  ].join("\n")

  // 3. Call provider
  const result = await provider.complete({
    systemPrompt,
    userPrompt,
    model: provider.model,
    temperature: 0,
    maxTokens: options?.maxMemories ? Math.min(options.maxMemories * 500, 4096) : 2048,
  })

  // 4. Parse LLM response
  const memories = parseExtractionResponse(result.content)

  // 5. Validate candidates
  let validated = memories
  if (options?.enableValidation !== false) {
    validated = memories.filter((m) => validateCandidate(m).valid)
  }

  // 6. Apply fingerprint dedup (if enabled)
  let finalMemories = validated
  if (options?.enableFingerprint && validated.length > 1) {
    const threshold = options.fingerprintThreshold ?? 0.8

    const merged: MemoryCandidate[] = []
    for (const candidate of validated) {
      let mergedWithExisting = false
      for (let i = 0; i < merged.length; i++) {
        if (shouldMerge(merged[i].content, candidate.content, threshold)) {
          const confidenceRank: Record<string, number> = { explicit: 3, observed: 2, inferred: 1, uncertain: 0 }
          const existingRank = confidenceRank[merged[i].confidence] ?? 0
          const newRank = confidenceRank[candidate.confidence] ?? 0
          if (newRank > existingRank) {
            merged[i] = candidate
          }
          mergedWithExisting = true
          break
        }
      }
      if (!mergedWithExisting) {
        merged.push(candidate)
      }
    }
    finalMemories = merged
  }

  // 7. Apply maxMemories cap
  if (options?.maxMemories && finalMemories.length > options.maxMemories) {
    finalMemories = finalMemories.slice(0, options.maxMemories)
  }

  // Apply confidence threshold
  if (options?.confidenceThreshold !== undefined) {
    const confidenceValues: Record<string, number> = { explicit: 1.0, observed: 0.75, inferred: 0.5, uncertain: 0.1 }
    finalMemories = finalMemories.filter((m) => (confidenceValues[m.confidence] ?? 0) >= options.confidenceThreshold!)
  }

  return {
    memories: finalMemories,
    raw: result.content,
    usage: result.usage,
    metadata: {
      model: provider.model,
      durationMs: Date.now() - t0,
      promptVersion,
    },
  }
}

// ---------------------------------------------------------------------------
// Extraction entrypoint
// ---------------------------------------------------------------------------

/**
 * Run extraction on a session.
 *
 * Reads the immutable fact record (captured by capture.ts) plus a recent
 * message snapshot, sends them to an extraction LLM sub-agent via the
 * RuntimeAdapter, and writes the distilled output to
 * `semantic/sessions/session_xxx.md` with provenance frontmatter.
 *
 * All failures are caught and logged — extraction never throws.
 */
export async function extractSessionMemory(
  sessionId: string,
  memoryDir: string,
  store: MemoryStore,
  config: MemoryPluginConfig,
  adapter: RuntimeAdapter,
  statePath: string,
): Promise<{ success: boolean; error?: string }> {
  const semanticFile = sessionSemanticPath(sessionId)
  const t0 = Date.now()

  void logEvent(memoryDir, {
    timestamp: new Date().toISOString(),
    type: "extraction.started",
    session_id: sessionId,
  })

  try {
    // Step 1: Read the fact record
    const factPath = getFactSessionPath(memoryDir, sessionId)
    let factRecord: {
      $id: string; session_id: string; created_at: string; ended_at: string;
      project: string; project_dir: string; runtime: { opencode_version: string; plugin_version: string; model: string };
      git: { branch: string; head: string; changed_files: Array<{ path: string; changes: string }> };
      stats: { messages: number; tool_calls: number; duration_minutes: number };
      events: Array<{ type: string; name: string; success: boolean; duration_ms: number }>;
      integrity: { hash: string };
    }
    try {
      const raw = await readFile(factPath, { encoding: "utf-8" })
      factRecord = JSON.parse(raw) as typeof factRecord
    } catch {
      const errorMsg = `No fact record found for session ${sessionId} at ${factPath}`
      await recordExtractionFailure(memoryDir, sessionId, statePath, errorMsg, null)
      return { success: false, error: errorMsg }
    }

    // Step 2: Read existing session notes (for incremental update)
    let currentContent: string
    const fileExists = await store.exists(semanticFile)
    if (fileExists) {
      try {
        const raw = await store.read(semanticFile)
        const { stripFrontmatter } = await import("./writer.js")
        currentContent = stripFrontmatter(raw)
      } catch {
        currentContent = DEFAULT_SESSION_MEMORY_TEMPLATE
      }
    } else {
      currentContent = DEFAULT_SESSION_MEMORY_TEMPLATE
    }

    if (currentContent.trim().length === 0) {
      currentContent = DEFAULT_SESSION_MEMORY_TEMPLATE
    }

    // Step 2.5: Read extraction cursor
    const cursor = await readCursor(memoryDir, sessionId)
    const cursorOffset = cursor?.processedMessageOffset ?? 0

    // Step 3: Read recent message snapshot
    let messages: unknown[] = []
    const safeOffset = cursorOffset

    try {
      const cached = await readMessages(memoryDir, sessionId, safeOffset)
      if (cached.length > 0) {
        messages = cached.map((m) => ({ role: m.role, content: m.content }))
      }
    } catch {
      // Cache read failed — fall through to SDK
    }

    if (messages.length === 0) {
      try {
        const allMessages = await adapter.session.messages(sessionId, 500)
        const sdkOffset = cursorOffset > allMessages.length ? 0 : cursorOffset
        messages = allMessages.slice(sdkOffset)
      } catch {
        // Message snapshot is optional
      }
    }

    // If no new messages, skip extraction
    if (messages.length === 0) {
      await writeCursor(memoryDir, {
        sessionId,
        processedMessageOffset: cursorOffset,
        lastProcessedAt: new Date().toISOString(),
        lastTouchedFiles: [],
      })
      await recordExtractionSuccess(memoryDir, sessionId, statePath, semanticFile)
      void logEvent(memoryDir, {
        timestamp: new Date().toISOString(),
        type: "extraction.completed",
        session_id: sessionId,
        duration_ms: Date.now() - t0,
      })
      return { success: true }
    }
    const conversationText = extractConversationText(messages)

    // Step 3.5: Scan for explicit feedback signals
    for (const msg of messages) {
      const text = typeof msg === "object" && msg !== null
        ? (msg as Record<string, unknown>).content as string ?? ""
        : typeof msg === "string" ? msg : ""
      if (typeof text !== "string") continue
      const feedback = detectExplicitFeedback(text)
      if (feedback) {
        try {
          const filename = `feedback_${Date.now()}.md`
          await store.write(filename, buildExplicitFeedbackMemory(feedback))
        } catch { /* non-fatal */ }
      }
    }

    // Step 4: Build fact summary
    const factSummary = formatFactSummary(factRecord)

    // Step 5: Read existing semantic memories
    let existingMemories = "(none)"
    try {
      const headers = await store.list()
      existingMemories = formatExistingMemories(headers, factSummary)
    } catch {
      // Listing failed — proceed without
    }

    // Step 6: Build the extraction prompt
    const prompt = buildExtractionPrompt(
      currentContent,
      conversationText,
      config.extraction.maxSectionLength,
      factSummary,
      existingMemories,
    )

    // Step 6: Spawn an extraction sub-agent session
    let extractSessionId: string
    try {
      const createOpts = resolveAgentConfig(config, "extraction")
      const extractSession = await adapter.session.create(createOpts)
      extractSessionId = extractSession.id
    } catch (err: unknown) {
      const errorMsg = `Failed to create extraction agent session: ${
        err instanceof Error ? err.message : "unknown error"
      }`
      await recordExtractionFailure(memoryDir, sessionId, statePath, errorMsg, classifyFailure(err))
      return { success: false, error: errorMsg }
    }

    // Step 7: Send the prompt and collect the response
    let response: unknown
    try {
      const promptOpts: { agent?: string; model?: string } = {}
      if (config.models.extraction) promptOpts.model = config.models.extraction
      response = await adapter.session.prompt(extractSessionId, prompt, promptOpts)
    } catch (err: unknown) {
      const errorMsg = `Extraction agent prompt failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`
      await recordExtractionFailure(memoryDir, sessionId, statePath, errorMsg, classifyFailure(err))
      return { success: false, error: errorMsg }
    }

    const responseText = extractResponseText(response)

    if (!responseText || responseText.trim().length === 0) {
      const errorMsg = "Extraction agent returned empty response"
      await recordExtractionFailure(memoryDir, sessionId, statePath, errorMsg, null)
      return { success: false, error: errorMsg }
    }

    // Step 8: Parse LLM frontmatter, validate, and write
    const { name, description, body: responseBody } = parseSemanticFrontmatter(responseText)
    const validation = validateExtractionOutput(responseBody)
    if (!validation.valid) {
      const errorMsg = `Extraction output validation failed: ${validation.errors.join("; ")}`
      logError("memory:extraction", `session=${sessionId} validation: ${validation.errors.join("; ")}`)
      await recordExtractionFailure(memoryDir, sessionId, statePath, errorMsg, null)
      return { success: false, error: errorMsg }
    }

    const provenance = buildProvenanceFrontmatter(sessionId, name, description)
    const semanticContent = provenance + responseBody

    // Update extraction cursor
    const newOffset = (cursorOffset > messages.length ? 0 : cursorOffset) + messages.length
    await writeCursor(memoryDir, {
      sessionId,
      processedMessageOffset: newOffset,
      lastProcessedAt: new Date().toISOString(),
      lastTouchedFiles: [semanticFile],
    })

    // Check semantic fingerprint for dedup
    const existing = await store.exists(semanticFile) ? await store.read(semanticFile) : ""
    if (existing && shouldMerge(existing, semanticContent)) {
      logInfo("memory:extraction", `session=${sessionId} skipped duplicate (fingerprint match)`)
      await recordExtractionSuccess(memoryDir, sessionId, statePath, semanticFile)
      return { success: true }
    }

    await store.write(semanticFile, semanticContent)

    // Step 8.5: Detect structured observations
    const candidates = detectStructuredObservations(
      messages.map((m) => ({
        role: typeof m === "object" && m !== null ? (m as Record<string, unknown>).role as string : undefined,
        content: typeof m === "object" && m !== null ? (m as Record<string, unknown>).content as string : String(m),
      }))
    )
    for (const candidate of candidates) {
      const candidateFile = `${getCandidateDir(memoryDir)}/${candidate.candidateType}_candidate_${Date.now()}.md`
      try {
        await store.write(candidateFile, buildCandidateMemory(candidate, sessionId))
      } catch { /* non-fatal */ }
    }

    // Step 9: Record success
    await recordExtractionSuccess(memoryDir, sessionId, statePath, semanticFile)
    return { success: true }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Unknown extraction error"
    await recordExtractionFailure(memoryDir, sessionId, statePath, errorMsg, null)
    return { success: false, error: errorMsg }
  }
}