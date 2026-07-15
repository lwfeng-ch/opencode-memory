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
import type { BenchmarkCase, BenchmarkExecutor } from "../benchmark/runner.js"
import { loadDataset, filterBySuite } from "../benchmark/dataset.js"
import { generateBenchmarkReport, formatBenchmarkJSON, formatBenchmarkConsole, formatBenchmarkMarkdown } from "../benchmark/reporter.js"
import { createMockExecutor, type MockMode } from "../benchmark/executor/mock.js"
import { writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

interface BenchmarkArgs {
  json: boolean
  suite?: string
  format: "console" | "json" | "markdown"
  mode: MockMode
}

function parseArgs(argv: string[]): BenchmarkArgs {
  const result: BenchmarkArgs = {
    json: false,
    format: "console",
    mode: "strict",
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
  const cases: BenchmarkCase[] = args.suite
    ? filterBySuite(allCases, args.suite as BenchmarkCase["suite"])
    : allCases

  if (cases.length === 0) {
    console.log("No benchmark cases found.")
    process.exit(0)
  }

  // Create executor
  const executor: BenchmarkExecutor = createMockExecutor(args.mode)

  // Run
  const runner = new DefaultBenchmarkRunner()
  const results = await runner.run(cases, executor)

  // Generate report — map MockMode to BenchmarkMode for reporting
  const reportMode = args.mode === "adversarial" ? "mock" : "mock"
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
