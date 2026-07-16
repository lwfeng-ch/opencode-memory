#!/usr/bin/env bun
/**
 * opencode-memory — Benchmark CLI
 *
 * Usage:
 *   bun run benchmark                    # run all suites, mock mode
 *   bun run benchmark --suite dedup      # run specific suite
 *   bun run benchmark --json             # JSON output
 */

import { DefaultBenchmarkRunner } from "../benchmark/runner.js"
import type { BenchmarkCase, BenchmarkExecutor, BenchmarkResult } from "../benchmark/runner.js"
import { loadDataset, filterBySuite } from "../benchmark/dataset.js"
import { generateBenchmarkReport, formatBenchmarkJSON, formatBenchmarkConsole, formatBenchmarkMarkdown } from "../benchmark/reporter.js"
import { createMockExecutor, type MockMode } from "../benchmark/executor/mock.js"
import { GoldenExecutor, type GoldenCase } from "../benchmark/executor/golden.js"
import { DefaultMemoryComparator } from "../src/evaluation/comparison.js"
import { writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

interface BenchmarkArgs {
  json: boolean
  suite?: string
  format: "console" | "json" | "markdown"
  mode: MockMode
  benchmarkMode: "mock" | "golden"
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
    } else if (arg.startsWith("--mode=")) {
      const modeVal = arg.split("=")[1]
      if (modeVal === "golden") result.benchmarkMode = "golden"
    }
  }

  // Check env var
  const envMode = process.env.BENCHMARK_MODE
  if (envMode === "adversarial") result.mode = "adversarial"

  return result
}

async function main() {
  const args = parseArgs(process.argv)

  // Load dataset
  const dataDir = join(process.cwd(), "benchmark", "data")
  const allCases = await loadDataset(dataDir)

  let results: BenchmarkResult[]

  if (args.benchmarkMode === "golden") {
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
    // v0.3.2 will replace with real LLM runtime
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
  const reportMode = args.benchmarkMode === "golden" ? "golden" : "mock"
  const report = generateBenchmarkReport(results, reportMode)

  // Output
  if (args.format === "json" || args.json) {
    console.log(formatBenchmarkJSON(report))
  } else if (args.format === "markdown") {
    console.log(formatBenchmarkMarkdown(report))
  } else {
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
