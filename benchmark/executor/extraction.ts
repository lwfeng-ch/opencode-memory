/**
 * opencode-memory — Extraction Benchmark Executor (v0.3.2)
 *
 * Wraps extractMemories() into a benchmark-friendly interface.
 * Takes a CompletionProvider and options; each execute() call runs
 * the full extraction pipeline (prompt → LLM → parse → validate).
 */

import type { ModelProvider } from "../../src/llm/provider.js"
import type {
  ExtractionInput,
  ExtractionOptions,
  ExtractionResult,
} from "../../src/extraction.js"
import { extractMemories } from "../../src/extraction.js"

// ---------------------------------------------------------------------------
// Generic executor interface (extraction-specific)
// ---------------------------------------------------------------------------

/**
 * Generic executor interface for benchmark types.
 * Extended by ExtractionExecutor for type narrowing.
 */
export interface BenchmarkExecutor<TInput = unknown, TExpected = unknown, TActual = unknown> {
  execute(input: TInput): Promise<TActual>
}

// ---------------------------------------------------------------------------
// ExtractionExecutor
// ---------------------------------------------------------------------------

/**
 * Extraction-specific benchmark executor.
 *
 * Wraps extractMemories() — the side-effect-isolated core function.
 * Each execute() call:
 *   1. Calls extractMemories(input, provider, options)
 *   2. Returns full ExtractionResult
 *
 * Used by golden benchmark to run real extraction against golden cases.
 */
export class ExtractionExecutor
  implements BenchmarkExecutor<ExtractionInput, unknown, ExtractionResult>
{
  readonly suite = "extraction_pipeline" as const
  private readonly provider: ModelProvider
  private readonly options?: ExtractionOptions

  constructor(provider: ModelProvider, options?: ExtractionOptions) {
    this.provider = provider
    this.options = options
  }

  /**
   * Execute a single extraction case.
   * @param input ExtractionInput (messages + context + metadata)
   * @returns ExtractionResult with memories, raw, usage, and metadata
   */
  async execute(input: ExtractionInput): Promise<ExtractionResult> {
    return extractMemories(input, this.provider, this.options)
  }
}
