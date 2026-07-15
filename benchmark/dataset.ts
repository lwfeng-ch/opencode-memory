/**
 * opencode-memory — Benchmark Dataset Loader
 *
 * Loads benchmark test cases from JSON files in benchmark/data/.
 */

import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { BenchmarkCase, BenchmarkSuite } from "./runner.js"

/**
 * Load all benchmark cases from the data directory.
 * Each subdirectory corresponds to a suite (dedup/, recall/, etc.).
 * Each .json file contains an array of BenchmarkCase objects.
 */
export async function loadDataset(dataDir: string): Promise<BenchmarkCase[]> {
  const cases: BenchmarkCase[] = []

  let entries: string[]
  try {
    entries = await readdir(dataDir, { recursive: true })
  } catch {
    return cases
  }

  const jsonFiles = entries.filter((f) => f.endsWith(".json"))

  for (const relativePath of jsonFiles) {
    try {
      const filePath = join(dataDir, relativePath)
      const content = await readFile(filePath, "utf-8")
      const data = JSON.parse(content)

      // Data can be a single case or an array of cases
      const caseArray: any[] = Array.isArray(data) ? data : [data]

      for (const item of caseArray) {
        // Validate required fields
        if (!item.id || !item.suite || !item.version) {
          continue
        }
        cases.push({
          id: item.id,
          version: item.version,
          suite: item.suite as BenchmarkSuite,
          input: item.input,
          expected: item.expected,
          metadata: item.metadata,
        })
      }
    } catch {
      // Skip unparseable files
    }
  }

  return cases
}

/**
 * Filter cases by suite name.
 */
export function filterBySuite(cases: BenchmarkCase[], suite: BenchmarkSuite): BenchmarkCase[] {
  return cases.filter((c) => c.suite === suite)
}
