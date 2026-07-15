/**
 * opencode-memory — Extraction Pipeline Benchmark Suite
 *
 * Tests the extraction pipeline (validator + store + fingerprint) with
 * mock LLM output. Does NOT test LLM quality — that's v0.3.1 Golden mode.
 *
 * In strict mode, returns expected fields directly (tests downstream pipeline).
 * In adversarial mode, the runner's mock executor returns garbage → metric should score 0.
 */

import { validateExtractionOutput } from "../../src/extraction-validator.js"
import type { BenchmarkCase } from "../runner.js"

export interface ExtractionInput {
  conversation: Array<{ role: string; content: string }>
}

export interface ExtractionExpected {
  fields: Record<string, string>
}

/**
 * Execute an extraction case: validate the mock LLM output.
 * Since mock returns expected, validation should always pass in strict mode.
 */
export async function executeExtractionCase(case_: BenchmarkCase): Promise<ExtractionExpected> {
  // In strict mode, we return the expected fields directly.
  // The mock executor already returned case_.expected, so we just pass it through.
  // The real test is whether validateExtractionOutput accepts the output.
  const expected = case_.expected as ExtractionExpected
  const body = Object.entries(expected.fields)
    .map(([k, v]) => `# ${k}\n${v}`)
    .join("\n\n")

  // Validate — should pass for well-formed expected output
  const validation = validateExtractionOutput(body)
  if (!validation.valid) {
    // If validation fails, return empty fields (metric will score 0)
    return { fields: {} }
  }
  return expected
}
