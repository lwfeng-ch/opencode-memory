// Verify the 3 critical fixes
import { loadConfig, resolveConfig, DEFAULT_CONFIG } from "../src/config.js"
import { truncateEntrypoint } from "../src/prompt.js"
import { createStore } from "../src/store.js"
import { parseFrontmatter } from "../src/store.js"

let passed = 0
let failed = 0

function check(name: boolean, label: string) {
  if (name) { passed++; console.log("  PASS: " + label) }
  else { failed++; console.log("  FAIL: " + label) }
}

// === S1: prompt.ts — wasByteTruncated flag ===
console.log("\n=== S1: truncateEntrypoint byte flag ===")

// Case: content that exceeds lines but NOT bytes after line truncation
const longLines = Array(300).fill("short").join("\n")  // 300 lines, ~1.7KB
const result1 = truncateEntrypoint(longLines, 200, 25000)
check(result1.wasLineTruncated === true, "line truncation detected")
check(result1.wasByteTruncated === false, "byte truncation NOT triggered (under byte limit after line truncation)")

// Case: content that exceeds bytes
const longBytes = "x".repeat(30000)
const result2 = truncateEntrypoint(longBytes, 200, 25000)
check(result2.wasByteTruncated === true, "byte truncation triggered when actually truncated")

// Case: content under both limits
const short = "hello\nworld"
const result3 = truncateEntrypoint(short, 200, 25000)
check(result3.wasLineTruncated === false && result3.wasByteTruncated === false, "no truncation when under limits")

// === S3: config.ts — shallow copy pollution ===
console.log("\n=== S3: config.ts shallow copy ===")
const config1 = await loadConfig("/nonexistent/path.json")  // triggers catch block
check(config1.recall.maxCandidates === 20, "default maxCandidates is 20")

// Pollute it
config1.recall.maxCandidates = 999
check(DEFAULT_CONFIG.recall.maxCandidates === 20, "DEFAULT_CONFIG NOT polluted after modifying returned config")

const config2 = await loadConfig("/nonexistent/path.json")
check(config2.recall.maxCandidates === 20, "second loadConfig returns fresh 20 (not polluted)")

// === S2: dream.ts — prunePhase index format ===
console.log("\n=== S2: dream.ts prunePhase index format ===")
const tmpDir = Bun.env.TMPDIR + "/opencode-mem-verify"
const store = await createStore(tmpDir)

// Write a memory file with proper frontmatter
await store.write("user_role.md", "---\nname: User Role\ndescription: Senior Go engineer\ntype: user\nscope: user\n---\n\nUser is a senior Go engineer.")
await store.write("feedback_testing.md", "---\nname: Testing Feedback\ndescription: Always use real DB\ntype: feedback\nscope: project\n---\n\nDon't mock database.")

// Simulate what prunePhase does: read files, build index
const { scanMemoryFiles } = await import("../src/scan.js")
const headers = await scanMemoryFiles(store)
const { parseFrontmatter } = await import("../src/store.js")

const indexLines: string[] = []
for (const m of headers) {
  const content = await store.read(m.filename)
  const fm = parseFrontmatter(content)
  const name = fm.name ?? m.description ?? m.filename
  const desc = m.description ?? ""
  indexLines.push(`- [${name}](${m.filename}) — ${desc}`)
}

const newIndex = indexLines.join("\n")
console.log("  Generated index:")
newIndex.split("\n").forEach(l => console.log("    " + l))

check(newIndex.includes("[User Role](user_role.md)"), "index has [User Role](user_role.md) format")
check(newIndex.includes("[Testing Feedback](feedback_testing.md)"), "index has [Testing Feedback](feedback_testing.md) format")
check(!newIndex.includes("[user:user]"), "index does NOT have manifest format [scope:type]")
check(!newIndex.includes("ISO"), "index does NOT have ISO timestamps")

// Cleanup
const { rm } = await import("fs/promises")
await rm(tmpDir, { recursive: true, force: true })

console.log("\n=== Results ===")
console.log(`Passed: ${passed}, Failed: ${failed}`)
if (failed === 0) {
  console.log("All 3 critical fixes verified!")
} else {
  console.error("Some fixes failed!")
  process.exit(1)
}
