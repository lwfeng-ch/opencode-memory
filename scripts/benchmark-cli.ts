#!/usr/bin/env bun
/**
 * opencode-memory — Benchmark CLI (v0.3.2)
 *
 * Usage:
 *   bun run benchmark                                # run all suites, mock mode
 *   bun run benchmark --suite dedup                  # run specific suite
 *   bun run benchmark --mode golden                  # golden mode (mock runtime, v0.3.1)
 *   bun run benchmark --mode real --provider qwen    # real LLM mode (v0.3.2)
 *   bun run benchmark --mode real --model qwen3-14b --repeat 3
 *   bun run benchmark --mode real --no-cache         # disable cache
 *   bun run benchmark --json                          # JSON output
 */

import { DefaultBenchmarkRunner } from "../benchmark/runner.js"
import type { BenchmarkCase, BenchmarkExecutor, BenchmarkResult } from "../benchmark/runner.js"
import { loadDataset, filterBySuite } from "../benchmark/dataset.js"
import { generateBenchmarkReport, formatBenchmarkJSON, formatBenchmarkConsole, formatBenchmarkMarkdown } from "../benchmark/reporter.js"
import { createMockExecutor, type MockMode } from "../benchmark/executor/mock.js"
import { GoldenExecutor, type GoldenCase } from "../benchmark/executor/golden.js"
import { DefaultMemoryComparator, type ComparableMemory } from "../src/evaluation/comparison.js"
import { writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

// v0.3.2 imports
import { loadBenchmarkConfig, type BenchmarkConfig } from "../benchmark/config.js"
import { OpenAIProvider, OpenAIEmbeddingProvider } from "../src/llm/openai.js"
import { QwenProvider, QwenEmbeddingProvider } from "../src/llm/qwen.js"
import type { ModelProvider, EmbeddingProvider } from "../src/llm/provider.js"
import { FileBenchmarkCache, NoopCache, computeCacheKey } from "../benchmark/cache.js"
import { RepeatController } from "../benchmark/repeat.js"
import { computeStats } from "../benchmark/stats.js"
import { ExtractionExecutor } from "../benchmark/executor/extraction.js"
import type { ExtractionInput, MemoryCandidate } from "../src/extraction.js"
import { execSync } from "node:child_process"

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface BenchmarkArgs {
  json: boolean
  suite?: string
  format: "console" | "json" | "markdown"
  mode: MockMode
  benchmarkMode: "mock" | "golden" | "real"
  // v0.3.2 real mode options
  provider?: string
  model?: string
  repeat?: number
  noCache?: boolean
}

function parseArgs(argv: string[]): BenchmarkArgs {
  const result: BenchmarkArgs = {
    json: false,
    format: "console",
    mode: "strict",
    benchmarkMode: "mock",
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") {
      result.json = true
      result.format = "json"
    } else if (arg.startsWith("--suite=")) {
      result.suite = arg.split("=")[1]
    } else if (arg === "--suite" && i + 1 < argv.length) {
      result.suite = argv[++i]
    } else if (arg.startsWith("--format=")) {
      result.format = arg.split("=")[1] as "console" | "json" | "markdown"
    } else if (arg === "--adversarial") {
      result.mode = "adversarial"
    } else if (arg === "--mode" && i + 1 < argv.length) {
      const modeVal = argv[++i]
      if (modeVal === "golden") result.benchmarkMode = "golden"
      else if (modeVal === "real") result.benchmarkMode = "real"
    } else if (arg.startsWith("--mode=")) {
      const modeVal = arg.split("=")[1]
      if (modeVal === "golden") result.benchmarkMode = "golden"
      else if (modeVal === "real") result.benchmarkMode = "real"
    } else if (arg === "--provider" && i + 1 < argv.length) {
      result.provider = argv[++i]
    } else if (arg.startsWith("--provider=")) {
      result.provider = arg.split("=")[1]
    } else if (arg === "--model" && i + 1 < argv.length) {
      result.model = argv[++i]
    } else if (arg.startsWith("--model=")) {
      result.model = arg.split("=")[1]
    } else if (arg === "--repeat" && i + 1 < argv.length) {
      result.repeat = parseInt(argv[++i], 10)
    } else if (arg.startsWith("--repeat=")) {
      result.repeat = parseInt(arg.split("=")[1], 10)
    } else if (arg === "--no-cache") {
      result.noCache = true
    }
  }

  const envMode = process.env.BENCHMARK_MODE
  if (envMode === "adversarial") result.mode = "adversarial"

  return result
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

function createModelProvider(
  providerName: string,
  model: string,
  apiKey: string,
  baseUrl?: string,
): ModelProvider {
  switch (providerName) {
    case "openai":
      return new OpenAIProvider(model, apiKey, baseUrl)
    case "qwen":
      return new QwenProvider(model, apiKey)
    default:
      throw new Error(`Unknown provider: ${providerName}. Supported: openai, qwen`)
  }
}

function createEmbeddingProvider(
  config: BenchmarkConfig["embedding"],
): EmbeddingProvider | undefined {
  if (!config) return undefined
  switch (config.provider) {
    case "openai":
      return new OpenAIEmbeddingProvider(config.model, config.dimensions, config.apiKey)
    case "qwen":
      return new QwenEmbeddingProvider(config.apiKey)
    default:
      return undefined
  }
}

// ---------------------------------------------------------------------------
// MemoryCandidate → ComparableMemory conversion
// ---------------------------------------------------------------------------

function toComparableMemory(m: MemoryCandidate): ComparableMemory {
  return {
    content: m.content,
    name: m.name,
    description: m.description,
    type: m.type,
    metadata: { scope: m.scope, confidence: m.confidence, source: m.source },
  }
}

// ---------------------------------------------------------------------------
// Runtime version helpers
// ---------------------------------------------------------------------------

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim()
  } catch {
    return "unknown"
  }
}

function getPackageVersion(): string {
  try {
    const pkg = require("../../package.json")
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

// ---------------------------------------------------------------------------
// Real benchmark runner (v0.3.2)
// ---------------------------------------------------------------------------

async function runRealBenchmark(
  goldenCases: GoldenCase[],
  provider: ModelProvider,
  comparator: DefaultMemoryComparator,
  cache: FileBenchmarkCache | NoopCache,
  repeatController: RepeatController,
  cliRepeat?: number,
): Promise<BenchmarkResult[]> {
  const gitCommit = getGitCommit()
  const packageVersion = getPackageVersion()
  const executor = new ExtractionExecutor(provider)
  const results: BenchmarkResult[] = []

  for (const case_ of goldenCases) {
    const suite = case_.suite
    const repeatCount = cliRepeat ?? repeatController.getRepeatCount(suite)
    const scores: number[] = []
    let cacheHits = 0
    let llmCalls = 0
    let totalTokens = { input: 0, output: 0 }

    for (let run = 1; run <= repeatCount; run++) {
      const start = Date.now()

      // Compute cache key
      const cacheKey = computeCacheKey({
        pipeline: {
          version: packageVersion,
          promptVersion: "extract-v1",
          config: { maxMemories: 10, confidenceThreshold: 0.7 },
        },
        model: {
          name: provider.model,
          temperature: 0,
        },
        runtime: { gitCommit, packageVersion },
        caseId: case_.id,
        suite,
        repeatIndex: run,
      })

      // Check cache
      let extractionResult: { memories: MemoryCandidate[]; raw: string; usage?: { inputTokens: number; outputTokens: number } } | null
      extractionResult = await cache.get(cacheKey)

      if (extractionResult) {
        cacheHits++
      } else {
        // Cache miss — call LLM
        llmCalls++
        const input = case_.input as ExtractionInput
        const result = await executor.execute(input)
        extractionResult = result
        if (result.usage) {
          totalTokens.input += result.usage.inputTokens
          totalTokens.output += result.usage.outputTokens
        }
        // Save to cache
        await cache.set(cacheKey, result)
      }

      // Convert to ComparableMemory
      const actualMem = extractionResult.memories.length > 0
        ? toComparableMemory(extractionResult.memories[0])
        : { content: "", name: "", description: "", type: "" }

      // Compare
      const expected = case_.expected as ComparableMemory
      const comparison = await comparator.compareMemory(expected, actualMem)
      scores.push(comparison.score)
    }

    // Compute stats
    const stats = computeStats(scores)
    const passed = stats.mean >= 0.7

    results.push({
      caseId: case_.id,
      suite,
      passed,
      score: Math.round(stats.mean * 1e10) / 1e10,
      actual: null,
      expected: case_.expected,
      durationMs: 0,
      // v0.3.2 fields
      runs: repeatCount,
      scores,
      stddev: stats.stddev,
      ci95: stats.ci95,
      cacheHits,
      llmCalls,
      comparatorMode: undefined,
      modelUsed: provider.model,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv)

  // Load dataset
  const dataDir = join(process.cwd(), "benchmark", "data")
  const allCases = await loadDataset(dataDir)

  let results: BenchmarkResult[]

  if (args.benchmarkMode === "real") {
    // v0.3.2: Real LLM benchmark
    const config = loadBenchmarkConfig()
    const providerName = args.provider ?? config.completion.provider
    const modelName = args.model ?? config.completion.model
    const apiKey = config.completion.apiKey

    if (!apiKey || apiKey === "$QWEN_API_KEY") {
      console.error("Error: API key not configured. Set QWEN_API_KEY env var or configure benchmark.config.json")
      process.exit(1)
    }

    const provider = createModelProvider(providerName, modelName, apiKey)
    const embeddingProvider = createEmbeddingProvider(config.embedding)
    const comparator = new DefaultMemoryComparator({ embeddingProvider, threshold: 0.7 })
    const cache = args.noCache
      ? new NoopCache()
      : new FileBenchmarkCache(config.cache.dir)
    const repeatController = new RepeatController()

    // Load golden cases
    const goldenCases = (args.suite
      ? filterBySuite(allCases, args.suite as BenchmarkCase["suite"])
      : allCases
    ).filter((c) => c.id.startsWith("golden-")) as GoldenCase[]

    if (goldenCases.length === 0) {
      console.log("No golden benchmark cases found.")
      process.exit(0)
    }

    console.log(`Running real LLM benchmark: ${goldenCases.length} cases, ${args.repeat ?? "auto"} repeats`)
    console.log(`Provider: ${providerName}, Model: ${modelName}`)
    console.log(`Cache: ${args.noCache ? "disabled" : "enabled"}, Embedding: ${embeddingProvider ? "available" : "unavailable"}`)
    console.log("")

    results = await runRealBenchmark(
      goldenCases,
      provider,
      comparator,
      cache,
      repeatController,
      args.repeat,
    )

    // Print summary
    const totalLlmCalls = results.reduce((s, r) => s + (r.llmCalls ?? 0), 0)
    const totalCacheHits = results.reduce((s, r) => s + (r.cacheHits ?? 0), 0)
    const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length
    const passed = results.filter((r) => r.passed).length

    console.log(`Memory Intelligence Score: ${(avgScore * 100).toFixed(1)}`)
    console.log(`Passed: ${passed}/${results.length}`)
    console.log(`LLM calls: ${totalLlmCalls}, Cache hits: ${totalCacheHits}`)
    console.log(`Comparator: ${embeddingProvider ? "hybrid-4layer" : "legacy-3layer"}`)
  } else if (args.benchmarkMode === "golden") {
    // Golden mode: use GoldenExecutor with mock runtime (returns expected as actual)
    const goldenCases = (args.suite
      ? filterBySuite(allCases, args.suite as BenchmarkCase["suite"])
      : allCases
    ).filter((c) => c.id.startsWith("golden-")) as GoldenCase[]

    if (goldenCases.length === 0) {
      console.log("No golden benchmark cases found.")
      process.exit(0)
    }

    // Mock runtime: returns expected output (baseline score = 100)
    const expectedLookup = new Map<string, unknown>()
    for (const c of goldenCases) {
      expectedLookup.set(JSON.stringify(c.input), c.expected)
    }
    const runtime = async (input: unknown) => {
      return expectedLookup.get(JSON.stringify(input)) ?? input
    }
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.8))
    results = await executor.execute(goldenCases)
  } else {
    // Mock mode: existing behavior
    const cases: BenchmarkCase[] = args.suite
      ? filterBySuite(allCases, args.suite as BenchmarkCase["suite"])
      : allCases

    if (cases.length === 0) {
      console.log("No benchmark cases found.")
      process.exit(0)
    }

    const executor: BenchmarkExecutor = createMockExecutor(args.mode)
    const runner = new DefaultBenchmarkRunner()
    results = await runner.run(cases, executor)
  }

  // Generate report
  const reportMode = args.benchmarkMode === "golden" ? "golden"
    : args.benchmarkMode === "real" ? "real" : "mock"
  const report = generateBenchmarkReport(results, reportMode)

  // Output
  if (args.format === "json" || args.json) {
    console.log(formatBenchmarkJSON(report))
  } else if (args.format === "markdown") {
    console.log(formatBenchmarkMarkdown(report))
  } else if (args.benchmarkMode !== "real") {
    console.log(formatBenchmarkConsole(report))
  }

  // Write to file
  const reportPath = join(process.cwd(), "reports", "benchmark", "latest.json")
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8")
}

main().catch((err) => {
  console.error("Benchmark failed:", err)
  process.exit(1)
})
