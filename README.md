# opencode-memory

English | [ÁÆÄ‰Ωì‰∏≠Êñá](README-zh.md)

Pipeline-centered, model-agnostic long-term memory system for [OpenCode](https://opencode.ai).

Inspired by Claude Code's memory pipeline and Qwen Code's fact-layer architecture, rebuilt for OpenCode's event-driven plugin architecture. Free-model first: every LLM call point is independently configurable with graceful degradation.

## Features

### Core Pipeline
- **KAIROS Mode** ‚Ä?Append-only daily logs during active sessions (zero LLM cost), batch extraction on `session.idle`
- **Incremental Extraction** ‚Ä?Cursor-based message offset tracking; only new messages since the last extraction run are sent to the LLM (reduces cost on long sessions)
- **Two-Stage Recall** ‚Ä?Rule filter (free, zero model calls) + LLM rerank (one lightweight call on survivors only)
- **RecallHandle** ‚Ä?Async recall fires on `chat.message`, settles in background, injects on next `system.transform` turn ‚Ä?no blocking, no missed results
- **Active Tool Filter** ‚Ä?Transient tool-debug memories (e.g. "npm install failed") are filtered from recall when the tool is active; durable markers ("workaround", "known issue") survive
- **Memory Pressure** ‚Ä?3-level detection (normal/elevated/critical) based on file count, index size, and total size; critical pressure bypasses dream time gate, elevated halves it
- **Dream Consolidation** ‚Ä?4-phase pipeline: Prepare (orient+gather combined) ‚Ü?Consolidate ‚Ü?Prune, runs periodically with 3-gate scheduling + pressure-aware triggering ‚Ä?3 LLM calls instead of 4
- **Entry-Level Deletion** ‚Ä?`memory_delete` supports `entryId` parameter for removing individual entries from multi-entry memory files, not just whole files
- **Telemetry** ‚Ä?Structured JSONL event logging (`logEvent`/`queryEvents`/`cleanupOldEvents`) for extraction, recall, and dream lifecycle ‚Ä?never blocks the pipeline
- **Cross-Project Scope** ‚Ä?User-level memories (global preferences) + project-level memories (per-repo context), with priority override
- **6 Custom Tools** ‚Ä?`memory_save`, `memory_list`, `memory_search`, `memory_read`, `memory_delete` (with entry-level), `memory_append`
- **Staleness Awareness** ‚Ä?Memories older than N days get point-in-time caveats injected into context
- **Model-Agnostic** ‚Ä?Free-model defaults (`explore`/`quick`/`deep` categories), every stage independently configurable with `resolveAgentConfig` safety check

### Quality & Security (v0.2+)
- **Extraction Validator** ‚Ä?4-layer quality gate (schema ‚Ü?section ‚Ü?placeholder ‚Ü?length) before write; prevents garbage content from polluting the memory store
- **Related Memory Filtering** ‚Ä?`scoreMemory()` pre-filters existing memories to top-10 by keyword relevance; reduces extraction prompt token waste by 60-80%
- **Semantic Description** ‚Ä?LLM outputs `name`/`description` frontmatter; session memories become searchable by recall's keyword matching
- **Semantic Fingerprint** ‚Ä?TF-IDF keyword extraction + Jaccard similarity > 0.8 ‚Ü?merge; catches semantic overlap even when exact text differs (not SHA256)
- **Recall Usage Tracking** ‚Ä?`store.touch()` on recall hits; 180-day prune rule for non-explicit memories; **explicit memories are never auto-deleted**
- **Message Cache** ‚Ä?`chat.message` hook writes to `fact/messages/*.jsonl`; decouples extraction from SDK API, enables offline replay
- **MemoryPathGuard** ‚Ä?Symlink protection, `realpath()` check, path escape prevention; security layer for the auto-write system
- **Explicit Feedback Fast Track** ‚Ä?Detects explicit signals ("ËÆ∞‰Ωè", "always use", "never use") and saves directly with `confidence: explicit, source: agent_save`; bypasses Dream
- **Typed Memory Candidate** ‚Ä?Extraction produces `semantic/candidates/` with confidence levels; explicit/observed auto-promote, inferred/derived go through Dream review
- **Extract Cursor Enhancement** ‚Ä?Reads from local message cache first, falls back to SDK API; true incremental processing

### Observability & Evaluation (v0.3+)
- **Memory Audit** ‚Ä?`bun run audit` scans memory directory for quality issues (truncated descriptions, missing fields, empty bodies), duplicates (TF-IDF Jaccard), conflicts (version/technology-switch detection), and staleness (180-day never-recalled). Read-only ‚Ä?never modifies files.
- **Benchmark Framework** ‚Ä?`bun run benchmark` runs 5 test suites (Dedup, Recall, Conflict, ExtractionPipeline, Forgetting) in Mock mode with strict + adversarial dual-mode executors. Reports JSON/Markdown/Console.
- **Golden Benchmark** (v0.3.1) ‚Ä?`bun run benchmark --mode golden` runs 50 golden dataset cases with semantic comparison scoring. Reports Memory Intelligence Score.
- **Memory Quality Score** (v0.3.1) ‚Ä?`bun run quality` evaluates 5 dimensions (Completeness, Consistency, Freshness, Noise, Retrievability) and outputs overall quality score 0-100.
- **Semantic Comparator** (v0.3.1) ‚Ä?3-layer text comparison (Token Jaccard 20% + TF-IDF 50% + Bigram 30%) with CJK support + field-weighted memory comparison (content 50%, description 20%, type 20%, name 10%).
- **Hybrid-4Layer Comparator** (v0.3.2) ‚Ä?Embedding layer (35%) added to 3-layer lexical (65%), with automatic fallback to legacy-3layer on embedding failure. `TextComparisonResult` with per-layer breakdown for explainability. `cosineSimilarity` pure function.
- **LLM Provider Abstraction** (v0.3.2) ‚Ä?`CompletionProvider` and `EmbeddingProvider` separated interfaces; `ModelProvider` for text generation. OpenAI + Qwen/DashScope implementations with retry logic and timeout.
- **extractMemories()** (v0.3.2) ‚Ä?Side-effect-isolated core function: builds prompt, calls LLM, parses response, validates candidates, applies fingerprint dedup. Shared by production and benchmark ‚Ä?no store/adapter/IO dependency.
- **Real Extraction Benchmark** (v0.3.2) ‚Ä?`bun run benchmark --mode real --provider qwen --model qwen3-14b --repeat 3` runs real LLM extraction against golden dataset. First real Memory Intelligence Score.
- **Benchmark Cache** (v0.3.2) ‚Ä?`FileBenchmarkCache` with SHA-256 cache key including pipeline config, model params, runtime version, caseId, and repeatIndex (critical ‚Ä?without repeatIndex, repeat=3 hits same cache).
- **Repeat Controller** (v0.3.2) ‚Ä?Suite-level repeat policies: extraction=3 (LLM variance), recall=1 (deterministic), dedup=3, conflict=3, forgetting=1. Total 110 calls for 50 golden cases.
- **Statistics** (v0.3.2) ‚Ä?`computeStats` pure function: mean, stddev, 95% CI (normal approximation; Student-t planned for v0.3.3).
- **LLM Trace Logger** (v0.3.2) ‚Ä?JSONL trace of LLM calls (requestId, model, latency, tokens, cacheHit) for cost/latency analysis.
- **Benchmark Config** (v0.3.2) ‚Ä?Separate `benchmark.config.json` (not in memory.config.json); JSONC comment stripping, env var substitution ($VAR ‚Ü?process.env.VAR).
- **Evaluation Layer** ‚Ä?Independent evaluation primitives (fingerprint, scoring, comparison, metrics, types) shared by Audit, Benchmark, and Quality modules. No circular dependencies.
- **CLI Tools** ‚Ä?`scripts/audit-cli.ts`, `scripts/benchmark-cli.ts`, `scripts/quality-cli.ts` with `--json`, `--scope`, `--suite`, `--mode`, `--provider`, `--model`, `--repeat`, `--no-cache` flags

## Architecture

```
src/
‚îú‚îÄ‚îÄ index.ts              Plugin entry ‚Ä?wires hooks (system.transform, chat.message, event, tool)
‚îú‚îÄ‚îÄ config.ts             Configuration, type taxonomy, scope resolver, resolveAgentConfig, DreamMode
‚îú‚îÄ‚îÄ store.ts              Storage abstraction (FileSystemStore), frontmatter parser, touch(), pathguard integration
‚îú‚îÄ‚îÄ paths.ts              Path resolution (project + user dirs, git root, cursor + message cache paths)
‚îú‚îÄ‚îÄ prompt.ts             System prompt builder (instructions + MEMORY.md index injection)
‚îú‚îÄ‚îÄ recall.ts             Two-stage recall: rule filter ‚Ü?LLM rerank, RecallHandle (scoreMemory re-exported from evaluation)
‚îú‚îÄ‚îÄ extraction.ts         KAIROS extraction: validator + fingerprint + semantic description + explicit feedback + candidates
‚îú‚îÄ‚îÄ extraction-validator.ts  4-layer quality gate (schema/section/placeholder/length) ‚Ä?pure, no I/O
‚îú‚îÄ‚îÄ evaluation/           Shared evaluation primitives (v0.3+)
‚î?  ‚îú‚îÄ‚îÄ types.ts          EvaluationResult, EvaluationContext
‚î?  ‚îú‚îÄ‚îÄ metrics.ts        Pure math: precision, recallAtK, f1, reductionRate
‚î?  ‚îú‚îÄ‚îÄ fingerprint.ts    TF-IDF keyword extraction + Jaccard similarity
‚î?  ‚îú‚îÄ‚îÄ scoring.ts        scoreMemory extracted from recall.ts
‚î?  ‚îú‚îÄ‚îÄ comparison.ts     HybridComparator: 4-layer (3-layer + Embedding 35%) with fallback (v0.3.2), TextComparisonResult, cosineSimilarity
‚î?  ‚îú‚îÄ‚îÄ quality.ts        5 dimension check functions (v0.3.1)
‚î?  ‚îî‚îÄ‚îÄ quality-score.ts  MemoryQualityEvaluator + QualityReport (v0.3.1)
‚îú‚îÄ‚îÄ llm/                  LLM provider abstraction (v0.3.2)
‚î?  ‚îú‚îÄ‚îÄ provider.ts       CompletionProvider + EmbeddingProvider + ModelProvider interfaces
‚î?  ‚îú‚îÄ‚îÄ openai.ts          OpenAI completion + embedding (with retry, timeout)
‚î?  ‚îî‚îÄ‚îÄ qwen.ts            Qwen/DashScope completion + BGE-M3 embedding (with retry, timeout)
‚îú‚îÄ‚îÄ audit/                Read-only memory health scanner (v0.3+)
‚î?  ‚îú‚îÄ‚îÄ index.ts          MemoryAuditService ‚Ä?plugin-pattern analyzer orchestration
‚î?  ‚îú‚îÄ‚îÄ report.ts         AuditReport generation + JSON/Markdown/Console formatters
‚î?  ‚îî‚îÄ‚îÄ analyzer/
‚î?      ‚îú‚îÄ‚îÄ duplicate.ts  TF-IDF Jaccard >0.8 pair detection (reuses evaluation/fingerprint)
‚î?      ‚îú‚îÄ‚îÄ conflict.ts   Pair-wise topic similarity + version/tech-switch conflict detection
‚î?      ‚îú‚îÄ‚îÄ quality.ts    Frontmatter completeness, truncated description, empty body
‚î?      ‚îî‚îÄ‚îÄ staleness.ts  180-day prune rule, explicit memories never stale
‚îú‚îÄ‚îÄ message-cache.ts      Append-only JSONL message cache (chat.message ‚Ü?fact/messages/*.jsonl)
‚îú‚îÄ‚îÄ explicit-feedback.ts  Detects explicit signals ("ËÆ∞‰Ωè"/"always use") ‚Ä?direct save, bypasses Dream
‚îú‚îÄ‚îÄ candidate.ts          Typed memory candidates with confidence-based Dream routing
‚îú‚îÄ‚îÄ dream.ts              Dream consolidation: prepareDreamContext (orient+gather) ‚Ü?consolidate ‚Ü?prune + 180-day recall prune
‚îú‚îÄ‚îÄ pathguard.ts          Symlink protection, realpath check, path escape prevention
‚îú‚îÄ‚îÄ cursor.ts             Incremental extraction tracking (readCursor/writeCursor)
‚îú‚îÄ‚îÄ health.ts             Memory pressure detection (3-level), health score, DreamMode-typed windows
‚îú‚îÄ‚îÄ state.ts              Pipeline state (state.json), DreamMode union type, mergeState validation
‚îú‚îÄ‚îÄ telemetry.ts          Structured JSONL event logging (logEvent/queryEvents/cleanupOldEvents)
‚îú‚îÄ‚îÄ scan.ts               Directory scanning + manifest/selection formatting
‚îú‚îÄ‚îÄ staleness.ts          Age computation + freshness caveats (pure, no I/O)
‚îú‚îÄ‚îÄ promotion.ts          Dream change validation + confidence-based conflict resolution
‚îú‚îÄ‚îÄ capture.ts            Fact Layer: immutable session record with session-specific $id
‚îú‚îÄ‚îÄ adapter.ts            Runtime adapter (SDK ‚Ü?clean interface, git snapshot, health check)
‚îú‚îÄ‚îÄ migration.ts          Cross-version data migration
‚îú‚îÄ‚îÄ log.ts                File logger (avoids stdout pollution, Windows CJK safe)
‚îú‚îÄ‚îÄ lock.ts               File-based mutual exclusion (PID + stale timeout)
‚îú‚îÄ‚îÄ tools.ts              6 custom tool definitions for the main agent
‚îú‚îÄ‚îÄ fingerprint.ts        Re-export shim ‚Ü?evaluation/fingerprint.ts (deprecated, use new path)
‚îú‚îÄ‚îÄ lifecycle/            Lifecycle metadata (v0.3.3+)
‚î?  ‚îú‚îÄ‚îÄ types.ts          MemoryStatus (active|archived), LifecycleMetadata, parseLifecycle, lifecycleScoreMultiplier
‚î?  ‚îî‚îÄ‚îÄ archive-types.ts  ArchiveEntry, buildArchiveLine, parseArchiveLine, MANIFEST_AUTO_GENERATED_HEADER (v0.3.4)
‚îî‚îÄ‚îÄ index/                Manifest index managers (v0.3.4)
    ‚îî‚îÄ‚îÄ archive-index.ts  ArchiveIndexManager ‚Ä?readArchive/writeArchive/addEntry/removeEntry for ARCHIVE.md

benchmark/                Project-root test harness (not in src/, not packaged)
‚îú‚îÄ‚îÄ runner.ts             BenchmarkRunner ‚Ä?orchestrates case execution via executor (v0.3.2: BenchmarkResult + stats fields)
‚îú‚îÄ‚îÄ dataset.ts            Dataset loader (JSON case files from data/)
‚îú‚îÄ‚îÄ metrics.ts            Metric<T> implementations (Dedup, Recall@K, Conflict, F1, Obsolete)
‚îú‚îÄ‚îÄ reporter.ts           BenchmarkReport generation ‚Ü?reports/benchmark/latest.json
‚îú‚îÄ‚îÄ cache.ts             FileBenchmarkCache + NoopCache + computeCacheKey (v0.3.2)
‚îú‚îÄ‚îÄ repeat.ts            RepeatController + suite-level RepeatPolicy (v0.3.2)
‚îú‚îÄ‚îÄ stats.ts             computeStats: mean, stddev, CI95 (v0.3.2)
‚îú‚îÄ‚îÄ trace.ts             LLMTraceLogger: JSONL trace (v0.3.2)
‚îú‚îÄ‚îÄ config.ts            loadBenchmarkConfig: JSONC + env var substitution (v0.3.2)
‚îú‚îÄ‚îÄ report-schema.ts     BenchmarkReport v0.3.2 schema + formatters (v0.3.2)
‚îú‚îÄ‚îÄ executor/mock.ts      Mock executor: strict (returns expected) + adversarial (returns garbage)
‚îú‚îÄ‚îÄ executor/golden.ts    Golden executor: async runtime + HybridComparator (v0.3.1, updated v0.3.2)
‚îú‚îÄ‚îÄ executor/extraction.ts ExtractionExecutor: wraps extractMemories() (v0.3.2)
‚îú‚îÄ‚îÄ suites/               5 suite implementations (dedup, recall, conflict, extraction_pipeline, forgetting)
‚îî‚îÄ‚îÄ data/                 11 mock + 50 golden benchmark cases (v0.3.1)

scripts/                  CLI entry points (v0.3+)
‚îú‚îÄ‚îÄ audit-cli.ts          bun run audit [--json] [--scope user|project] [--format markdown]
‚îú‚îÄ‚îÄ benchmark-cli.ts      bun run benchmark [--mode mock|golden|real] [--provider X] [--model Y] [--repeat N] [--no-cache] (v0.3.2)
‚îú‚îÄ‚îÄ quality-cli.ts        bun run quality [--json] [--scope user|project|all] (v0.3.1)
‚îú‚îÄ‚îÄ repair-cli.ts         bun run repair [--scan] [--scope project|user|all] [--list] [--approve-all-low] [--restore X] (v0.3.3)
‚îî‚îÄ‚îÄ migrate-archive-index.ts  bun run scripts/migrate-archive-index.ts --dry-run|--apply [--scope=project|user|all] [--force] (v0.3.4)
```

### Memory Pipeline

```
User Message
    ‚î?
    ‚ñ?
chat.message hook ‚îÄ‚îÄ‚ñ?Recall (async, RecallHandle)
    ‚î?                    ‚î?
    ‚î?             Stage 1: Rule filter (free) + transient tool filter
    ‚î?             Stage 2: LLM rerank (one call) ‚Ä?skipped on critical pressure
    ‚î?                    ‚î?
    ‚ñ?                    ‚ñ?
system.transform hook ‚îÄ‚îÄ‚ñ?Inject MEMORY.md index + recalled memories (from RecallHandle)
    ‚î?
    ‚ñ?
Agent runs (with memory context)
    ‚î?
    ‚ñ?
session.idle event ‚îÄ‚îÄ‚ñ?Extraction (batch, KAIROS, cursor-incremental)
                    ‚îî‚îÄ‚îÄ‚ñ?Dream consolidation (if gates pass + pressure-aware)
                              ‚î?
                              ‚îî‚îÄ‚îÄ‚ñ?Telemetry events (JSONL, non-blocking)
```

### Memory Types

| Type | Scope Default | Purpose |
|------|--------------|---------|
| `user` | user | User role, goals, preferences, expertise |
| `feedback` | user | Guidance on approach ‚Ä?corrections AND confirmations |
| `project` | project | Ongoing work context, decisions, deadlines |
| `reference` | project | Pointers to external systems (dashboards, trackers) |

Scope is loosely bound to type ‚Ä?the agent can override via the `scope` parameter in `memory_save`.

## Installation

### As an OpenCode Plugin

Add to your `opencode.jsonc`:

```jsonc
{
  "plugins": {
    "opencode-memory": {
      "path": "path/to/opencode-memory",
      "enabled": true
    }
  }
}
```

Or place the plugin directory under `~/.config/opencode/plugins/opencode-memory/`.

### Requirements

- [OpenCode](https://opencode.ai) with plugin support
- [Bun](https://bun.sh) runtime (or Node.js 18.17+)
- [oh-my-openagent](https://github.com/anthropics/oh-my-openagent) agents (optional but recommended ‚Ä?provides `explore`/`quick`/`deep` categories)

## Configuration

Copy `memory.config.example.json` to `memory.config.json` and edit as needed:

```bash
cp memory.config.example.json memory.config.json
```

```jsonc
{
  "enabled": true,
  "features": {
    "recall": {
      "enabled": true,
      "agent": "explore",        // Subagent type for LLM rerank
      "background": true,        // Async prefetch (non-blocking)
      "llm_rerank": true,        // Set false for rule-filter-only mode
      "max_candidates": 20,      // Stage 1 survivors
      "max_results": 5,          // Final selected count
      "min_query_length": 5      // Skip short queries like "ok"
    },
    "extraction": {
      "enabled": true,
      "category": "quick",       // Subagent category for extraction
      "min_tokens_to_init": 10000,
      "min_tokens_between_update": 5000,
      "max_section_length": 2000,
      "max_total_tokens": 12000
    },
    "dream": {
      "enabled": true,
      "category": "deep",        // Subagent category for dream
      "min_hours_since_last": 24,
      "min_sessions_since_last": 5,
      "min_messages_since_last": 10,
      "lock_stale_timeout_ms": 3600000
    },
    "staleness": {
      "warn_after_days": 1
    },
    "scope": {
      "user_scope_enabled": true,
      "project_overrides_user": true
    }
  },
  "models": {
    "recall": null,       // null = use agent default; or set e.g. "opencode/north-mini-code-free"
    "extraction": null,
    "dream": null
  },
  "memoryPressure": {
    "maxFiles": 500,         // File count threshold
    "maxIndexSize": 25000,   // MEMORY.md byte limit
    "maxTotalSize": 5242880, // Total memory dir size (estimated)
    "elevatedRatio": 0.7,    // ‚â?0% ‚Ü?elevated
    "criticalRatio": 0.9     // ‚â?0% ‚Ü?critical
  },
  "telemetry": {
    "enabled": true,         // Set false to disable all event logging
    "maxAgeDays": 7,         // Auto-cleanup events older than 7 days
    "maxEventsPerFile": 1000
  },
  "agents": {
    "recall":   { "agent": "explore", "model": null },
    "extraction": { "category": "quick", "model": null },
    "dream":    { "category": "deep", "model": null }
  }
}
```

### Memory Storage Locations

| Scope | Path |
|-------|------|
| Project | `~/.config/opencode/memory/projects/<sanitized-git-root>/` |
| User | `~/.config/opencode/memory/user/` |

Each memory file is a Markdown file with YAML frontmatter:

```markdown
---
name: User Role
description: User is a senior backend engineer
type: user
scope: user
confidence: explicit
schema_version: 1
---

Memory body content...
```

## Testing

```bash
# Run all unit + integration tests (350 tests, 43 files)
bun test test/chain.test.ts test/candidate.test.ts test/config-pressure.test.ts \
     test/cursor.test.ts test/dream-prepare.test.ts test/entry-delete.test.ts \
     test/explicit-feedback.test.ts test/extraction-validator.test.ts \
     test/health-pressure.test.ts test/integration.test.ts test/lock-recall.test.ts \
     test/lock.test.ts test/message-cache.test.ts test/paths.test.ts test/pathguard.test.ts \
     test/promotion.test.ts test/prompt.test.ts test/recall-tracking.test.ts \
     test/resolve-agent.test.ts test/round10-integration.test.ts test/scan.test.ts \
     test/state-pressure.test.ts test/staleness.test.ts test/telemetry.test.ts \
     test/tools.test.ts test/transient-filter.test.ts \
     test/evaluation/fingerprint.test.ts test/evaluation/scoring.test.ts \
     test/evaluation/comparison.test.ts test/evaluation/comparison-extra.test.ts \
     test/evaluation/quality-score.test.ts test/evaluation/quality-score-extra.test.ts \
     test/audit/duplicate.test.ts test/audit/conflict.test.ts \
     test/audit/quality.test.ts test/audit/staleness.test.ts \
     test/benchmark/runner.test.ts test/benchmark/metrics.test.ts \
     test/benchmark/golden.test.ts test/benchmark/golden-extra.test.ts \
     test/benchmark/reporter.test.ts test/benchmark/dataset.test.ts \
     test/integration-v031.test.ts

# Run individual suites
bun test test/extraction-validator.test.ts   # 4-layer quality gate (10 tests)
bun test test/evaluation/fingerprint.test.ts  # TF-IDF Jaccard dedup (11 tests)
bun test test/evaluation/scoring.test.ts     # scoreMemory keyword match (8 tests)
bun test test/recall-tracking.test.ts        # touch() + tracking (4 tests)
bun test test/message-cache.test.ts          # JSONL message cache (5 tests)
bun test test/pathguard.test.ts              # Symlink/path security (6 tests)
bun test test/explicit-feedback.test.ts      # Explicit signal detection (5 tests)
bun test test/dream-prepare.test.ts          # Combined orient+gather (5 tests)
bun test test/candidate.test.ts              # Typed candidate detection (6 tests)
bun test test/promotion.test.ts             # Confidence override rules (25 tests)
bun test test/audit/duplicate.test.ts        # Duplicate analyzer (4 tests)
bun test test/audit/conflict.test.ts         # Conflict analyzer (5 tests)
bun test test/audit/quality.test.ts          # Quality analyzer (5 tests)
bun test test/audit/staleness.test.ts        # Staleness analyzer (4 tests)
bun test test/benchmark/runner.test.ts       # Benchmark runner (4 tests)
bun test test/benchmark/metrics.test.ts      # Benchmark metrics (12 tests)
bun test test/integration.test.ts            # Dream + Extraction + Plugin (12 tests)
bun test test/round10-integration.test.ts    # Cursor + Pressure + RecallHandle (14 tests)

# Audit CLI ‚Ä?scan memory health
bun run audit                                # console output
bun run audit --json                         # JSON to stdout
bun run audit --scope user                   # scan user scope only

# Benchmark CLI ‚Ä?run evaluation suites
bun run benchmark                            # all suites, mock mode
bun run benchmark --suite dedup              # specific suite only
bun run benchmark --adversarial              # adversarial mock (tests defense)
bun run benchmark --mode golden              # golden mode with semantic comparison (v0.3.1)
bun run benchmark --mode real --provider qwen --model qwen3-14b --repeat 3  # real LLM (v0.3.2)
bun run benchmark --mode real --no-cache     # real LLM without cache (v0.3.2)

# Quality CLI ‚Ä?memory quality scoring (v0.3.1)
bun run quality                              # scan project memory, console output
bun run quality --json                        # JSON to stdout
bun run quality --scope all                   # scan both user + project scopes

# Repair CLI ‚Ä?memory cleanup (v0.3.3)
bun run repair --scan --include-recent-sessions   # scan project scope, include all session_*.md
bun run repair --scan --scope all                  # scan both project + user scopes
bun run repair --list                               # list pending candidates
bun run repair --approve-all-low                    # approve all low-risk candidates (archive/delete)
bun run repair --restore session_2026-07-01-x.md    # restore archived file to active
bun run repair --clear                              # clear executed/rejected from queue

# Migration CLI ‚Ä?archive index migration (v0.3.4)
bun run scripts/migrate-archive-index.ts --dry-run --scope=project  # preview migration
bun run scripts/migrate-archive-index.ts --apply --scope=project    # execute migration
```

491 tests total across 55 files, 490 passing (1 flaky golden-extra duration test).

> **Note:** As of v0.4.2, the test suite has grown to **970 tests across 93 files** (966 pass + 4 pre-existing failures: C1/C2/C3 SDK timeouts require live OpenCode instance + flaky golden-extra duration). See Changelog below for per-version details.

## Design Principles

1. **Pipeline over replication** ‚Ä?Not a Claude Code clone; a pipeline-first design adapted to OpenCode's architecture
2. **Free-model first** ‚Ä?Every LLM stage degrades gracefully; rule filter works with zero model calls
3. **Incremental over reprocess** ‚Ä?Cursor tracks message offset; only new messages are sent to the LLM on re-extraction
4. **Pressure-aware scheduling** ‚Ä?Dream consolidation responds to memory pressure (critical triggers immediately, elevated halves time gate)
5. **Telemetry never blocks** ‚Ä?All event logging is fire-and-forget (`void logEvent`); failures are silent
6. **Loose coupling** ‚Ä?`type` ‚â?`scope`; type is semantic, scope is lifecycle, overridable per-memory
7. **Cooperative, not competitive** ‚Ä?Main agent writes memories proactively; extraction/dream are safety nets
8. **Defense in depth** ‚Ä?PathGuard (symlink/realpath/escape) + store-layer traversal check = two-layer security
9. **Quality gate before write** ‚Ä?Extraction output is validated (4-layer check) before entering the memory store
10. **Semantic dedup over hash** ‚Ä?TF-IDF Jaccard similarity catches semantic overlap even when exact text differs
11. **Confidence-based routing** ‚Ä?Explicit/observed memories auto-promote; inferred/derived go through Dream review
12. **Recall-driven governance** ‚Ä?180-day prune rule for unrecalled non-explicit memories; explicit memories are permanent
13. **Observability over assumptions** ‚Ä?Audit discovers real problems from actual memory state; confirmed issues become benchmark cases (v0.3+)
14. **Evaluation layer independence** ‚Ä?Shared evaluation primitives (fingerprint, scoring, comparison) serve audit, benchmark, and future modules without circular deps (v0.3+)
15. **CLI ‚â?Library** ‚Ä?CLI scripts are thin entry points; runners/services are library code, never the other way around (v0.3+)

## Memory System Conceptual Q&A

> A user-perspective summary of how the memory system works, complementing the technical documentation above.

### What the Memory System Is

A file-based persistence mechanism across sessions, so the agent carries forward into each new conversation:

- Who you are (identity, role, preferences)
- How you like to collaborate (corrected mistakes, validated approaches)
- Project context (motivation, progress, who is doing what)
- Where external resources live (Linear, Slack, etc. pointers)

Two scopes:

- **User-level** (cross-project, shared): identity and preferences
- **Project-level** (per-project): project context; overrides user-level on conflict

### Design Tensions

The system balances four tensions:

1. **Persistence vs Freshness** ‚Ä?A memory is a point-in-time snapshot ("true when written"); verify before recommending (does the file still exist? the function?), update or delete when stale
2. **Completeness vs Relevance** ‚Ä?`MEMORY.md` holds only index pointers (always loaded, <200 lines); full content is read on demand, preventing context bloat
3. **Automatic vs Controlled** ‚Ä?Semi-automatic: agent-driven primary + fallback auto-extraction; rejects forced auto-recording (avoids noise and loss of control)
4. **Derivable vs Non-derivable** ‚Ä?Only store what can't be derived from current state; code patterns, git history, AGENTS.md content, and debug fixes are never stored

Additional principles:

- **Type classification matches lifecycle**: `user` (stable), `feedback` (applies every turn; record both corrections AND confirmations), `project` (volatile), `reference` (navigation pointers)
- **Memory ‚â?Plan ‚â?Tasks**: Plan aligns approach within a conversation, Tasks track progress within a conversation, Memory persists across conversations
- **Instruction priority**: User > Skills > System prompt; memory is a tool, not an authority

### When It Writes

Two trigger modes:

1. **Explicit** ‚Ä?You say "remember‚Ä?, "forget‚Ä?, "always do this"; the agent writes or deletes immediately
2. **Inferred** ‚Ä?The agent proactively detects signals:
   - You reveal role/preferences/knowledge ‚Ü?`user`
   - You correct an approach ("no, not that") or confirm a non-obvious one ("yes, exactly") ‚Ü?`feedback`
   - You mention project who/what/why/when ‚Ü?`project` (relative dates converted to absolute)
   - You reference external systems ‚Ü?`reference`

Key: `feedback` records confirmations too ‚Ä?recording only corrections makes the agent overly cautious and drifts away from validated methods.

### Source Transparency

Agent statements about the memory system fall into three reliability layers:

- **Mechanism layer** (how it works, rules): from system prompt, reliable
- **Index layer** (what's stored): from `MEMORY.md` summary; full file content needs separate read to verify
- **Inference layer** (why it's designed this way): agent's rationalization based on mechanism; may have bias

## License

MIT

## Acknowledgments

- [Claude Code](https://claude.ai) ‚Ä?Original memory pipeline design inspiration
- [OpenCode](https://opencode.ai) ‚Ä?Plugin architecture and event-driven hooks
- [oh-my-openagent](https://github.com/anthropics/oh-my-openagent) ‚Ä?Agent category system
- [Qwen Code](https://github.com/QwenLM/qwen-code) ‚Ä?Fact layer architecture, recall-selection concept, symlink protection

## Changelog

### v0.4.1 ‚Ä?Memory Worthiness Engine (2026-07-22)

**MemoryPathPolicy**
- `MemoryPathPolicy` ‚Ä?ignore patterns for `.memory-backup/`, `.git/`, `node_modules/`, `MEMORY.md`, `ARCHIVE.md`
- Session-aware filtering: `ignoreSessions` option for audit vs default consumers
- Windows path compatibility (backslash ‚Ü?forward slash normalization)

**CoverageModel**
- `CoverageModel` interface with 3 implementations:
  - `LinearBufferedCoverage`: `0.5 + 0.5√ócoverage` for small sets (<100)
  - `SqrtCoverage`: `sqrt(coverage)` for medium sets (100-1000)
  - `LogCoverage`: `log(1+covered)/log(1+total)` for large sets (‚â?000)
- `selectCoverageModel()` auto-selects based on total set size

**ProvenanceValidator**
- `evaluateSourceTrust()` ‚Ä?source trust scores: user/feedback=1.0, extraction=0.8, session=0.6, migration=0.4
- `evaluateExtractionConfidence()` ‚Ä?method √ó confidenceScore: explicit=direct, llm√ó0.9/0.7, dream√ó0.8, no extraction=0.5
- `evaluateHistoryIntegrity()` ‚Ä?created event presence, timestamp monotonicity
- `calibrateClaimConfidence()` ‚Ä?confidence √ó extraction confidence with anomaly warnings
- `computeProvenanceConfidence()` ‚Ä?aggregates 4 sub-dimensions into overall score

**LifecycleValidator**
- `evaluateStatusAppropriateness()` ‚Ä?checks if archived/active status matches recall recency
- `evaluateStability()` ‚Ä?counts archive/restore events in history (0-1 stable, 2-3 oscillation warning, 4+ significant oscillation)
- `computeLifecycleValidity()` ‚Ä?combines status √ó stability √ó recency

**WorthinessScore**
- 3-dimension multiplicative model: `contentQuality √ó lifecycleValidity √ó provenanceConfidence`
- 5 recommendation levels (keep/review/archive/delete/critical)
- `ValidationFinding` structure with severity, action, reasons, metadata

**ProvenanceActor Unification**
- Added `extraction`, `dream`, `conflict-resolution` to `ProvenanceActor` union type
- Updated `validateProvenance()`, `isValidProvenanceEvent()`, `createProvenance()` to accept all 7 actors
- Backward compatible ‚Ä?existing provenance files parse correctly

**Test growth:** 818 ‚Ü?916 (+98), 88 files, 0 regression
**TypeScript:** `tsc --noEmit` clean

### v0.4.3 °™ Recall Feedback Foundation (2026-07-22)

**RecallEvent & UserFeedback**
- RecallEvent °™ append-only JSONL event store with mode/strategy/scope/retrievalConfigHash
- UserFeedback °™ positive/negative/ignored with source (user/system/benchmark)
- RecallEventStore °™ JSONL storage in act/recall/
- RecallQualityMetrics °™ precision@K, hit rate, positive ratio, per-memory usefulness
- RetrievalAdjustment °™ scoreModifier (-0.2 to +0.2), does NOT modify memory worthiness

**Temporal Ranking**
- TemporalClass °™ 4 types (preference/fact/workflow/session) with different decay curves
- 	emporalValidity() °™ replaces hard user > extraction priority
- djustedSourceTrust() °™ old user claims discounted, recent extraction boosted
- Updated ankCandidates() °™ combined source trust + temporal validity

**FindingCategory**
- Extended to 8 categories: quality, lifecycle, provenance, duplicate, contradiction, superseded, feedback, retrieval
- ValidationFinding.category field added

**Architecture boundary: Memory Truth vs Recall Behavior**
- Feedback modifies scoreModifier (retrieval ranking), NOT memory truth
- Memory provenance, lifecycle, worthiness are immutable by feedback

**Test growth:** 968 °˙ 1006 (+38), 97 files, 0 regression
**TypeScript:** 	sc --noEmit clean (0 errors)
### v0.4.0 ‚Ä?Provenance Foundation (2026-07-22)

**Provenance Schema**
- `MemoryProvenance` interface ‚Ä?source, created, extraction, history, transformation (reserved)
- Confidence dual-track: `confidence` (claim level) + `extraction.confidenceScore` (0-1)
- Serialization: provenance stored as JSON string in YAML frontmatter (compatible with existing flat parser)
- Validation: `validateProvenance()` + `isValidProvenance()` + `isValidProvenanceEvent()`
- Helpers: `createProvenance()`, `appendEvent()`, `mergeProvenance()`, `mergeConfidence()`, `mergeSourceType()`

**Injection Pipeline**
- `memory_save` handler auto-injects provenance via `injectProvenance()` ‚Ä?user never passes provenance
- `_provenanceOverride` internal parameter for system calls (extraction/dream/migration/repair)
- AC-7: user-provided `_provenanceOverride` is rejected; user-provided provenance is ignored

**Storage Migration**
- `parseFrontmatter` extended to recognize `provenance` key
- `touch()` preserves provenance during recall tracking updates
- `setFrontmatterField()` (repair service) preserves provenance ‚Ä?only modifies specified fields
- Migration script: `scripts/migrate-provenance.ts` ‚Ä?dry-run/apply/rollback with backup to `.memory-backup/`

**Repair & Promotion Integration**
- archive/restore preserve provenance + lifecycle fields
- `mergeProvenance()` ‚Ä?confidence takes highest rank, `confidenceScore` unchanged, history merged with merged event appended

**Test growth:** 721 ‚Ü?818 (+97), 80 files, 0 regression
**TypeScript:** `tsc --noEmit` clean (0 errors)

### v0.3.3 ‚Ä?Memory Repair Foundation (2026-07-20)

**Repair Foundation**
- `RepairService` ‚Ä?`archive()` / `delete()` / `restore()` operating on frontmatter metadata (archive = `status: archived` field, NOT file move)
- `FileCandidateQueue` ‚Ä?file-based JSON queue for repair candidates (add/get/getPending/updateStatus/clearExecuted)
- `AuditLog` ‚Ä?JSONL append-only log of all repair actions with query by type/filename
- `RepairCandidate` ‚Ä?typed candidate with risk assessment (low/medium/high) and `scope` field for multi-scope routing
- `MemoryMigrationScanner` ‚Ä?`LegacyScanner` (legacy/v1/) + `SessionScanner` (session_*.md, configurable threshold)
- `bun run repair` CLI ‚Ä?`--scan` / `--list` / `--approve` / `--approve-all-low` / `--restore` / `--clear` / `--scope project|user|all` / `--include-recent-sessions`

**Lifecycle Metadata**
- `MemoryStatus` (`active` | `archived`) ‚Ä?frontmatter field, defaults to active
- `LifecycleMetadata` interface ‚Ä?status + lastRecalledAt + recallCount + archivedAt
- `parseLifecycle()` ‚Ä?reads lifecycle fields from frontmatter with safe defaults
- `lifecycleScoreMultiplier()` ‚Ä?archived memories get 0.1x score (10x deprioritized but still searchable as last resort)

**explicit-feedback Tightening**
- Three-condition detection: signal ("ËÆ∞‰Ωè"/"always use") + action intent (verb) + user authority ‚Ä?descriptive observations no longer trigger auto-save
- 6 positive + 12 negative test cases covering edge cases like "Áî®Êà∑ÂñúÊ¨¢" / "the user prefers"

**Adapter Bridge**
- `AdapterLLMProvider` wraps RuntimeAdapter as `CompletionProvider` ‚Ä?enables benchmark to use OpenCode's adapter without exposing store/SDK
- `extractResponseText()` ‚Ä?exported from extraction.ts, handles 6+ response shapes (plain string, {content}, {message.content}, OpenAI {choices}, DashScope {output.text}, {text})

**Critical Bug Fixes (post-merge)**
- **P0:** `package.json` was zeroed out by commit `0adb23a` ‚Ä?restored all scripts + added `repair`
- **P0:** `repair-cli.ts` hardcoded `user` scope but 21 polluting memories were in `project` scope ‚Ä?added `--scope project|user|all` (default project)
- **P1:** `repair-cli.ts` missing `--scan` command ‚Ä?scanner couldn't enqueue candidates, `--list` always empty
- **P1:** `SessionScanner` 30-day threshold skipped all recent July session_*.md ‚Ä?added `--include-recent-sessions` flag (threshold=0)

**Real Cleanup Executed**
- 21 candidates cleared: 13 legacy/v1/ files deleted (low risk, v2 versions exist at top level) + 8 session_*.md files archived (status field set, files retained)
- MEMORY.md rebuilt: 32 ‚Ü?28 entries (4 stale legacy index entries removed)

**Test growth:** 491 ‚Ü?589 tests (+98), 63 files, 0 regressions (2 pre-existing C2/C3 SDK timeouts require live OpenCode instance)

### v0.3.2 ‚Ä?Memory Benchmark Reality Layer (2026-07-16)

**LLM Provider Abstraction**
- `CompletionProvider` + `EmbeddingProvider` separated interfaces (not all models support embedding)
- `ModelProvider` extends `CompletionProvider` (no embedding implied ‚Ä?inject separately)
- `OpenAIProvider` + `OpenAIEmbeddingProvider` ‚Ä?fetch-based, retry with exponential backoff, timeout
- `QwenProvider` + `QwenEmbeddingProvider` ‚Ä?DashScope API, BGE-M3 embedding

**extractMemories() Core Function**
- Side-effect-isolated core: prompt build ‚Ü?LLM call ‚Ü?parse ‚Ü?validate ‚Ü?fingerprint dedup
- No store/adapter/IO dependency ‚Ä?production and benchmark share same logic
- `ExtractionInput` (messages + context + metadata) ‚Ä?forward-extensible for v0.4+ tool events
- `ExtractionExecutor` wraps extractMemories() for benchmark use

**Hybrid-4Layer Comparator**
- 4-layer: Token Jaccard (15%) + TF-IDF (35%) + Bigram (15%) + Embedding (35%)
- Fallback to legacy-3layer (20%+50%+30%) when embedding unavailable or fails
- `TextComparisonResult` with per-layer breakdown for explainability
- `cosineSimilarity` pure function
- `ComparableMemory.metadata` optional field (not scored in v0.3.2)

**Benchmark Cache + Repeat + Stats**
- `FileBenchmarkCache` with SHA-256 cache key: pipeline + model + runtime + caseId + **repeatIndex** (critical ‚Ä?without repeatIndex, repeat=3 hits same cache)
- `RepeatController` with suite-level policies: extraction=3, recall=1, dedup=3, conflict=3, forgetting=1 (110 total calls for 50 cases)
- `computeStats` pure function: mean, stddev, 95% CI (normal approximation)
- `LLMTraceLogger`: JSONL trace for cost/latency analysis

**Benchmark Config + Report**
- Separate `benchmark.config.json` (not in memory.config.json) ‚Ä?different lifecycles
- `stripJsoncComments`: string-aware state machine (preserves URLs inside strings)
- `substituteEnvVars`: `$VAR_NAME` ‚Ü?`process.env[VAR_NAME]`
- `BenchmarkReport` v0.3.2 schema with model, comparator, cost, weights metadata

**CLI Integration**
- `--mode real` ‚Ä?real LLM extraction benchmark
- `--provider` ‚Ä?openai / qwen / ollama
- `--model` ‚Ä?model name override
- `--repeat N` ‚Ä?repeat count override
- `--no-cache` ‚Ä?disable cache

**Self-Review Fixes (8 issues)**
- OpenAI API: removed unsupported `top_k` parameter
- Config: JSONC comment stripping now string-aware (preserves URLs)
- Extraction: `confidenceValues` + `VALID_CONFIDENCE` ‚Ä?added missing `observed` level
- Embedding providers: added retry logic (was missing in both OpenAI and Qwen)
- Extraction: removed redundant dynamic import of `shouldMerge`
- Config: clarified `as` + `??` operator precedence with parentheses

**Test growth:** 373 ‚Ü?491 tests (+118), 55 files, 0 regressions

### v0.3.1 ‚Ä?Memory Quality Regression & Intelligence Benchmark (2026-07-15)

**Semantic Comparator**
- `DefaultMemoryComparator` with 3-layer text comparison: Token Jaccard (20%) + TF-IDF keyword (50%) + Character bigram (30%)
- CJK-aware tokenization (2-char bigram tokens for Chinese text)
- `compareMemory` field-weighted comparison: content (50%), description (20%), type (20%), name (10%)
- `ComparisonResult` with per-field scores and pass threshold

**Golden Benchmark Framework**
- `GoldenExecutor` wraps runtime executor + semantic comparator
- `GoldenCase` interface extends `BenchmarkCase` with model/reviewer/createdAt metadata
- 50 golden dataset cases: Extraction (15), Recall (15), Dedup (8), Conflict (7), Forgetting (5)
- `BenchmarkReport` upgraded: `intelligence_score` + per-suite score breakdown + v0.3.1 version

**Memory Quality Score**
- `MemoryQualityEvaluator` with 5 dimensions: Completeness (20%), Consistency (25%), Freshness (15%), Noise (20%), Retrievability (20%)
- `QualityReport` with overall score and per-dimension breakdown
- Pure dimension functions (no I/O, no side effects)

**CLI Tools**
- `bun run quality` ‚Ä?scan memory, output 5-dimension quality report
- `bun run benchmark --mode golden` ‚Ä?run golden benchmark with semantic comparison
- Flags: `--json`, `--scope`, `--mode golden`

**Self-Review Fixes** (commit `59b4a15`)
- `GoldenExecutor`: removed redundant `threshold` field ‚Ä?single threshold source via comparator's `passed` flag
- `BenchmarkReport`: `benchmarks` array marked `@deprecated`, derived from `suites` Record ‚Ä?single data source
- `checkConsistency`: bucket-optimized O(n¬∑k) with range `[s - floor(s/4), s + floor(s/4)]` (min ¬±1) ‚Ä?11x speedup over O(n¬≤), no false negatives at Jaccard=0.8 boundary
- `extractKeywords`: version-like tokens (`Python 3.10`) preserved as single token (`3_10`) ‚Ä?`3.10` no longer false-positive-duplicates `3.11`

**Test growth:** 258 ‚Ü?350 tests (+92), 43 files, 0 regressions

### v0.3.0 ‚Ä?Memory Observability & Evaluation Foundation (2026-07-15)

**Evaluation Layer**
- Evaluation primitives (types, metrics, fingerprint, scoring, comparison) as independent shared layer
- `fingerprint.ts` migrated from `src/` to `src/evaluation/` (re-export shim for backward compat)
- `scoreMemory` extracted from `recall.ts` to `src/evaluation/scoring.ts`
- `SemanticComparator<T>` generic interface + `TokenJaccardComparator` + `ArrayOverlapComparator`

**Audit Module**
- `MemoryAuditService` with plugin-pattern analyzer registration
- 4 analyzers: Duplicate (TF-IDF), Conflict (pair-wise + version/tech-switch), Quality (frontmatter), Staleness (180-day)
- Read-only constraint: never modifies memory files
- Report generation: JSON/Markdown/Console with severity scoring

**Benchmark Framework**
- `BenchmarkRunner` + `BenchmarkExecutor` strategy pattern (runner = orchestration, executor = per-case)
- `MockExecutor` with strict (returns expected) + adversarial (returns garbage) dual mode
- 5 test suites: Dedup, Recall, Conflict, ExtractionPipeline, Forgetting
- 11 benchmark cases with real-session-style data
- Report with environment metadata + baseline support

**CLI Tools**
- `bun run audit` ‚Ä?scan memory health, output findings + suggestions
- `bun run benchmark` ‚Ä?run evaluation suites in mock mode
- Flags: `--json`, `--scope`, `--suite`, `--format`, `--adversarial`

**Fixes**
- `store.ts` LSP type annotation fix (recall_count, last_recalled_at in inline type)
- Conflict analyzer precision fix (101 false positives ‚Ü?0, pair-wise + dedup)
- `vitest` added to devDependencies (LSP type resolution for test files)
- N-issue fixes: `uncertain:0` in promotion, `$id` with sessionId, `DreamMode` union type

**Test growth:** 216 ‚Ü?258 tests (+42), 34 files, 0 regressions

### v0.2.0 ‚Ä?Extraction Quality & Security (2026-07-15)

**Quality Gate (P0)**
- Extraction Validator ‚Ä?4-layer quality gate (schema/section/placeholder/length) before write
- Related Memory Filtering ‚Ä?`scoreMemory()` pre-filters to top-10, token -60~80%

**Quality Infrastructure (P1)**
- Semantic Description ‚Ä?LLM outputs `name`/`description` frontmatter for recall matching
- Semantic Fingerprint ‚Ä?TF-IDF Jaccard > 0.8 dedup, not SHA256
- Recall Usage Tracking ‚Ä?`store.touch()` + 180-day prune (never delete explicit)
- Message Cache ‚Ä?`chat.message` ‚Ü?`fact/messages/*.jsonl`, SDK decoupling

**Intelligence & Security (P2)**
- MemoryPathGuard ‚Ä?symlink protection, realpath check, path escape prevention
- Explicit Feedback Fast Track ‚Ä?direct save for "ËÆ∞‰Ωè"/"always use" signals
- Dream Prepare Merge ‚Ä?4-phase logic, 3 LLM calls (orient+gather combined)
- Typed Memory Candidate ‚Ä?confidence-based routing (explicit/observed auto-promote)
- Extract Cursor Enhancement ‚Ä?reads from local cache, SDK fallback

**Earlier fixes**
- Confidence level mismatch ‚Ä?`uncertain: 0` added to `promotion.ts` priority map
- `$id` uniqueness ‚Ä?session-specific URI in `capture.ts` and `extraction.ts`
- `DreamMode` union type ‚Ä?type safety for `state.ts` and `health.ts`

**Test growth:** 139 ‚Ü?216 tests (+77), 27 files, 0 regressions

### v0.1.0 ‚Ä?Initial Release

- KAIROS extraction, two-stage recall, Dream consolidation, telemetry, memory pressure
- 139 tests across 18 files

