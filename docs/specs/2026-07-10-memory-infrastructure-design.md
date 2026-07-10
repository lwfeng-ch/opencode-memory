# Agent Memory Infrastructure Design

> **Date**: 2026-07-10
> **Status**: Approved (pending implementation plan)
> **Scope**: opencode-memory plugin architecture overhaul

## 1. Problem Statement

The current memory system has three write paths, all of which failed in
production:

1. **Agent-driven saves** (primary) — the LLM is instructed to call
   `memory_save` when it learns something worth remembering, but the LLM
   often doesn't. "Auto-triggering" is actually LLM-judgment-dependent,
   not event-driven.

2. **Extraction** (safety net) — fires on `session.idle`, but all failures
   are silently swallowed (`void fn().catch(() => {})`). The SDK adapter
   wrapping `session.prompt` as `session.chat` was never tested against
   the real SDK client. Failures are invisible.

3. **Dream** (consolidation) — gated behind 24h + 5 sessions, so it
   doesn't run during development.

**Core architectural deficit**: no observability, no fact layer, no
guaranteed capture. LLM failure = data loss.

## 2. Design Direction

**Hybrid Memory Trigger Architecture** — not "fix the existing system"
and not "redesign everything", but a layered architecture where:

- **Explicit memory** (user preferences, corrections, decisions) remains
  LLM-driven — this information requires semantic understanding.
- **Implicit memory** (what files changed, what tools were called, how
  long the session lasted) is captured automatically by the runtime —
  this information is factual and doesn't need LLM judgment.
- **Dream/Evolution** consolidates facts into long-term knowledge.
- **Observability** makes every pipeline stage visible.

### Key Principle

> Raw Record is the Fact Layer, not extraction's backup.
> Extraction and Dream are fact-to-knowledge transformers.
> LLM failure does not lose data; it only delays knowledge formation.

## 3. Layered Architecture

```
+-------------------------------+
|       Observability           |
| status / logs / metrics       |
+---------------^---------------+
                |
+---------------+---------------+
|       Semantic Memory         |
| md memories / indexes         |
+---------------^---------------+
                |
+---------------+---------------+
|          Fact Layer           |
| session json / events         |
+---------------^---------------+
                |
+---------------+---------------+
|       Processing Layer        |
| extraction / dream / recall   |
+---------------^---------------+
                |
+---------------+---------------+
|        Trigger Layer          |
| idle/message/tool events      |
+---------------^---------------+
                |
+---------------+---------------+
|        Adapter Layer          |
| OpenCode Runtime abstraction  |
+-------------------------------+
```

### Trigger Layer

Receives OpenCode events and dispatches them. Does NOT directly handle
processing — routes to Processing Layer via `dispatch()`.

Events consumed:
- `session.idle` — trigger capture + extraction + dream (gated)
- `chat.message` — trigger recall (unchanged) + increment message counter
- `tool.execute.after` — increment tool counter + record tool event
- `experimental.chat.system.transform` — inject memory prompt (unchanged)

```typescript
function dispatch(event: MemoryEvent, ctx: PluginContext): void {
  switch (event.type) {
    case "session.idle":
      void captureSession(ctx)        // mandatory, zero LLM
      void tryExtraction(ctx)        // optional, LLM
      void tryDream(ctx)             // optional, LLM, gated
      break
    case "chat.message":
      messageCounter++
      void tryRecall(ctx)            // existing, unchanged
      break
    case "tool.execute.after":
      toolCounter++
      recordToolEvent(event)         // type, name, success, duration_ms only
      break
  }
}
```

First version: direct `dispatch()` calls, no event queue. Code structure
stays separated for future queue insertion.

### Fact Layer

**File structure**:

```
<memoryDir>/
  fact/
    sessions/
      2026/
        07/
          session_xxx.json       ← IMMUTABLE: factual payload only
  processing/
    extraction/
      session_xxx.status.json   ← MUTABLE: processing lifecycle metadata
    dream/
      session_xxx.status.json
```

**Constraints**:
- JSON only, never Markdown
- Zero LLM content — factual data exclusively
- **Fact payload is immutable** after write — never modified by any
  processing stage. This preserves replay capability.
- **Processing metadata is mutable** — stored in separate files under
  `processing/`, updated as extraction/dream progress.
- `captureSession()` is always deterministic

**Raw Session Record format**:

```json
{
  "$id": "memory://fact-session/v1",
  "session_id": "ses_xxx",
  "created_at": "2026-07-10T10:00:00Z",
  "ended_at": "2026-07-10T12:00:00Z",
  "project": "opencode-memory",
  "project_dir": "/path/to/project",

  "runtime": {
    "opencode_version": "1.15.13",
    "plugin_version": "0.2.0",
    "model": "glm-5.2"
  },

  "git": {
    "branch": "main",
    "head_before": "abc1234",
    "head_after": "def5678",
    "changed_files": [
      { "path": "src/recall.ts", "changes": "+120 -30" }
    ]
  },

  "stats": {
    "messages": 38,
    "tool_calls": 52,
    "duration_minutes": 120
  },

  "events": [
    {
      "type": "tool_call",
      "name": "memory_save",
      "success": true,
      "duration_ms": 1200
    }
  ],

  "integrity": {
    "hash": "sha256:..."
  }
}
```

**Processing metadata file** (`processing/extraction/session_xxx.status.json`):

```json
{
  "$id": "memory://processing-extraction/v1",
  "session_id": "ses_xxx",
  "extraction": {
    "status": "pending",
    "attempts": 0,
    "last_error": null,
    "retry_after": null,
    "failure_type": null,
    "semantic_file": null
  },
  "dream": {
    "status": "not_started"
  }
}
```

This file is mutable — updated as extraction and dream progress.
The fact record stays immutable, preserving replay capability.

**Tool event privacy**: only `type`, `name`, `success`, `duration_ms`.
Never store tool arguments (privacy, token bloat, file bloat).

**Schema management**: `schemas/fact-session.schema.json` and
`schemas/semantic-memory.schema.json` with JSON Schema standard `$id`
fields. Dream checks schema version before reading historical records.

### Semantic Memory Layer

**File structure**:

```
<memoryDir>/
  semantic/
    staging/              ← Dream proposed changes (pending validation)
      proposed_change_001.md
    sessions/             ← Extraction output (per-session structured notes)
      session_xxx.md
    memories/             ← Long-term memories (agent saves + promoted)
      user_role.md
      feedback_xxx.md
      project_xxx.md
  MEMORY.md               ← Index (unchanged format)
```

**Constraints**:
- Markdown only, never JSON
- LLM-generated content lives here
- `semantic/staging/` is the transaction boundary for Dream

**Provenance** — frontmatter `source` field (schema v2):

```yaml
---
name: User Prefers Chinese Communication
description: User prefers Chinese replies
type: feedback
scope: user
confidence:
  level: explicit    # explicit | observed | inferred | derived
source:
  kind: agent_save   # agent_save | extraction | dream
  fact_id: null       # link to fact record if not agent_save
schema_version: 2
---
```

**Confidence levels** (standardized):

| Level | Meaning | Source kind |
|-------|---------|-------------|
| `explicit` | User explicitly stated | `agent_save` |
| `observed` | Runtime fact captured | (fact record directly) |
| `inferred` | LLM extraction inferred | `extraction` |
| `derived` | Dream LLM derived | `dream` |

**Priority rule** (enforced by code, not LLM judgment):

```
explicit > observed > inferred > derived
```

Lower-confidence memories CANNOT override higher-confidence ones.

### Processing Layer

#### captureSession()

```
captureSession(sessionId, runtimeSnapshot):
  1. Read git info: branch, HEAD before/after, changed files
  2. Read counters: message count, tool call count
  3. Compute duration from first message to idle
  4. Assemble JSON record (zero LLM)
  5. Write to fact/sessions/YYYY/MM/session_xxx.json
  6. Update state.json: capture.last_capture_at, total_sessions_captured
```

**Forbidden in captureSession**: LLM calls, prompts, semantic judgment,
file content reading (beyond git metadata).

#### tryExtraction()

```
tryExtraction(sessionId):
  1. Read fact/sessions/.../session_xxx.json (raw record)
  2. Call adapter.session.messages(sessionId, limit=N) for recent snapshot
  3. Read existing semantic memories (to avoid duplicate extraction)
  4. Assemble prompt: raw record + message snapshot + existing memories + rules
  5. Call adapter.session.create() + adapter.session.prompt()
  6. Success:
     - Write semantic/sessions/session_xxx.md
     - Update fact record: processing.extraction.status = "done"
     - Update state.json: extraction stats
  7. Failure:
     - Classify failure type (timeout, model_unavailable, invalid_schema, permission)
     - Update fact record: processing.extraction.status = "failed"
                            processing.extraction.attempts++
                            processing.extraction.last_error = message
                            processing.extraction.failure_type = classified
     - Set retry_after for retryable failures
     - Raw record already on disk — no data loss
```

**Retry policy**:

| Failure type | Action |
|-------------|--------|
| `timeout` | Retry on next idle |
| `model_unavailable` | Retry on next idle |
| `invalid_schema` | Fix prompt (don't retry until prompt updated) |
| `permission_denied` | Manual intervention required |

**Extraction input includes existing memories** to prevent duplicate
extraction. The prompt tells the LLM what memories already exist so it
doesn't recreate them.

#### tryDream()

**Staging area** — Dream never directly modifies long-term memories:

```
tryDream():
  1. Check gates (mode-specific)
  2. Read fact records + semantic memories
  3. LLM analyzes: merge candidates, stale files, gaps
  4. Write proposed changes to semantic/staging/
  5. Promotion layer validates and promotes
```

**Promotion Layer** (`src/promotion.ts`):

```
promoteStaging():
  1. Read semantic/staging/*.md
  2. For each proposed change:
     a. Check confidence priority (can this override existing?)
     b. If yes: move to semantic/memories/, update MEMORY.md
     c. If no: discard with log
  3. Clean staging directory
```

**Dream gate modes**:

| Mode | Time gate | Session gate | Memory pressure | Use case |
|------|-----------|-------------|-----------------|----------|
| `development` | every idle | 0 | none | Dev/testing |
| `normal` | 24h | 5 sessions | none | Daily use |
| `production` | 7 days | threshold | memory_count > 500 OR index_size > 25KB | Long-running |

Configured via `memory.config.json` → `features.dream.mode`.

**Memory pressure trigger**: beyond time/session gates, Dream triggers
when memory entropy is high (too many files, index too large).

**Conflict resolution** (`src/promotion.ts`):

| Old confidence | New confidence | Action |
|----------------|----------------|--------|
| explicit | derived | Reject |
| explicit | inferred | Reject |
| observed | inferred | Reject |
| inferred | derived | Reject |
| explicit | explicit | Create conflict |
| same level | same level | Merge proposal |

**Explicit-vs-explicit conflicts** are written to `semantic/conflicts/`
for manual resolution. The system never auto-overwrites two
user-stated facts — it surfaces the contradiction.

```
semantic/
  conflicts/
    2026-07-10_user_language_preference.md   ← conflict report
```

### Adapter Layer

**Runtime abstraction** — not just a prompt wrapper:

```typescript
interface RuntimeAdapter {
  session: {
    create(opts: AgentSessionCreateOptions): Promise<{ id: string }>
    prompt(id: string, message: string, opts?: PromptOptions): Promise<unknown>
    messages(id: string, limit?: number): Promise<unknown[]>
  }

  workspace: {
    current(): Promise<string>
  }

  git: {
    snapshot(): Promise<GitSnapshot>
  }

  capabilities: RuntimeCapabilities

  healthCheck(): Promise<AdapterHealthResult>
}

interface GitSnapshot {
  branch: string
  head: string
  changedFiles: Array<{ path: string; changes: string }>
}

interface RuntimeCapabilities {
  sessionCreate: boolean
  messageRead: boolean
  eventStream: boolean
  backgroundTask: boolean
  toolHook: boolean
}

interface AdapterHealthResult {
  sessionCreate: boolean
  sessionMessages: boolean
  sessionPrompt: "working" | "untested" | "failed"
  errors: string[]
}
```

**Capability discovery**: `RuntimeCapabilities` lets the plugin adapt to
different OpenCode versions without code changes. If a future version
renames `session.idle` to `session.finished`, the adapter translates.

**Self-check** (on plugin init):
1. Try `session.create({})` — record success/failure
2. Try `session.messages(anySessionId)` — record success/failure
3. Do NOT try `session.prompt()` (has side effects)
4. Write results to `state.json: adapter_status`
5. If `session.create` fails → `console.error("[memory] adapter self-check failed")`
6. Does NOT block plugin loading — failure only logged

### Observability Layer

#### state.json

```json
{
  "version": 1,
  "updated_at": "2026-07-10T12:30:00Z",

  "health": {
    "score": 92,
    "status": "healthy"
  },

  "adapter_status": {
    "session_create": true,
    "session_messages": true,
    "session_prompt": "untested",
    "last_check": "2026-07-10T10:00:00Z",
    "errors": []
  },

  "capture": {
    "last_session_id": "ses_xxx",
    "last_capture_at": "2026-07-10T12:00:00Z",
    "total_sessions_captured": 15
  },

  "extraction": {
    "last_success_at": "2026-07-10T12:01:00Z",
    "last_failure_at": "2026-07-10T11:00:00Z",
    "total_successes": 12,
    "total_failures": 1,
    "last_error": "adapter session.prompt timeout"
  },

  "dream": {
    "last_run_at": "2026-07-09T20:00:00Z",
    "mode": "development",
    "total_runs": 3,
    "last_error": null
  },

  "recall": {
    "last_query_at": "2026-07-10T11:55:00Z",
    "total_queries": 28,
    "llm_rerank_used": 22,
    "llm_rerank_failed": 2
  },

  "events_received": {
    "session.idle": { "total": 15, "last_received_at": "2026-07-10T12:00:00Z" },
    "chat.message": { "total": 38, "last_received_at": "2026-07-10T11:55:00Z" },
    "tool.execute.after": { "total": 52, "last_received_at": "2026-07-10T11:58:00Z" }
  }
}
```

**Health score** (0-100):

| Component | Weight | Condition |
|-----------|--------|-----------|
| Adapter working | 30 | `session_create && session_messages` |
| Capture active | 30 | `last_capture` within mode window |
| Extraction healthy | 20 | `total_failures < total_successes` |
| Dream running | 20 | `last_run` within mode gate window |

**Mode-based activity windows** (prevents false alarms when user is
simply away for a few days):

| Mode | Capture window | Dream window |
|------|---------------|-------------|
| `development` | 1 hour | 1 hour |
| `normal` | 24 hours | 24 hours |
| `production` | 7 days | 7 days |

If the user hasn't been active for 3 days in `normal` mode, the capture
window is 24h from the *last activity*, not from now — so the health
score stays high when the system is simply idle.

**Events tracking**: cumulative totals + `last_received_at` only. No
per-event log. If `session.idle.total` is 0, events aren't reaching
the plugin — immediate problem diagnosis.

#### Logging strategy

Replace all empty catches with structured console output:

```typescript
// Failure — always log
void tryExtraction(ctx).catch((err) => {
  console.error(`[memory:extraction] session=${ctx.sessionId} error=${err.message}`)
  updateState(...)
})

// Success — log for debugging
void tryExtraction(ctx).then(() => {
  console.log(`[memory:extraction] session=${ctx.sessionId} success`)
  updateState(...)
})
```

Levels:
- `console.error` — failures, exceptions
- `console.warn` — graceful degradation (LLM unavailable, fallback to rule filter)
- `console.log` — normal flow (capture complete, extraction success)

No structured logging framework — `console.*` + `state.json` is
sufficient for v1.

#### Tools (3 new)

**`memory_status`** — human-readable diagnostic report:

```
Memory System Status

Storage:
  Project dir: writable (15 files)
  User dir: writable (3 files)

Adapter:
  session.create: working
  session.messages: working
  session.prompt: untested
  Last check: 2026-07-10 10:00

Capture (Fact Layer):
  Last capture: 2026-07-10 12:00 (30 min ago)
  Total sessions: 15

Extraction:
  Last success: 2026-07-10 12:01
  Last failure: 2026-07-10 11:00 (adapter timeout)
  Stats: 12 success, 1 failed

Dream:
  Mode: development
  Last run: 2026-07-09 20:00
  Stats: 3 runs total

Health Score: 92/100

Events received:
  session.idle: 15 (last: 2026-07-10 12:00)
  chat.message: 38 (last: 2026-07-10 11:55)
  tool.execute.after: 52 (last: 2026-07-10 11:58)
```

**`memory_rebuild`** — regenerate MEMORY.md index from existing memory
files. Use case: index corruption, manual file additions.

**`memory_replay`** — re-process `fact/` records through extraction.
Use case: model upgrade, prompt iteration, bug fix in extraction logic.
The Fact Layer's greatest value — memories can be rebuilt from facts
at any time.

## 4. File Layout (Final)

```
src/
  adapter.ts          ← Runtime adapter + self-check + capability discovery
  capture.ts          ← Fact Layer: deterministic session capture
  config.ts           ← Add dream.mode, processing config
  dream.ts            ← Staging area, priority rules, gate modes
  extraction.ts       ← Input: raw record + messages + existing memories
  health.ts           ← Health score calculation
  index.ts            ← dispatch() routing, hook registration
  lock.ts             ← Unchanged
  migration.ts        ← Legacy v1 → v2 migration on plugin init
  paths.ts            ← Add fact/ and semantic/ path functions
  promotion.ts        ← Staging → validation → promote, conflict resolution
  prompt.ts           ← Unchanged
  recall.ts           ← Unchanged (two-stage recall)
  scan.ts             ← Unchanged
  schema.ts           ← Schema version management
  staleness.ts        ← Unchanged
  state.ts            ← state.json read/write/update
  store.ts            ← Unchanged
  tools.ts            ← Add memory_status, memory_rebuild, memory_replay

memory/
  fact/
    sessions/
      YYYY/MM/session_xxx.json       ← IMMUTABLE fact payload
  processing/
    extraction/
      session_xxx.status.json        ← mutable processing metadata
    dream/
      session_xxx.status.json
  semantic/
    staging/           ← Dream proposed changes (pending validation)
    conflicts/         ← explicit-vs-explict conflicts (manual resolution)
    sessions/          ← Extraction output
    memories/          ← Long-term memories
  legacy/
    v1/                ← Pre-migration backup (never deleted)
  schemas/
    fact-session.schema.json
    semantic-memory.schema.json
  state.json
  MEMORY.md
```

## 5. Existing Code Changes

| File | Change |
|------|--------|
| `src/index.ts` | Major: dispatch() routing, adapter upgrade, self-check, empty catch → logging, new tool.execute.after hook |
| `src/extraction.ts` | Major: input changes to raw record + messages + existing memories, provenance, retry policy |
| `src/dream.ts` | Major: staging area, priority rules, gate modes, memory pressure trigger |
| `src/config.ts` | Minor: add `dream.mode`, `dream.memoryPressure` config |
| `src/paths.ts` | Minor: add `getFactDir()`, `getSemanticDir()`, `getStagingDir()`, `getProcessingDir()` |
| `src/tools.ts` | Minor: add 3 new tools (memory_status, memory_rebuild, memory_replay) |
| `src/recall.ts` | None (unchanged) |
| `src/store.ts` | None (unchanged) |
| `src/prompt.ts` | None (unchanged) |
| `src/scan.ts` | None (unchanged) |
| `src/staleness.ts` | None (unchanged) |
| `src/lock.ts` | None (unchanged) |
| **New** | `src/adapter.ts`, `src/capture.ts`, `src/health.ts`, `src/promotion.ts`, `src/schema.ts`, `src/state.ts`, `src/migration.ts` |

## 6. Implementation Priority

```
Phase 0: Migration foundation
    ↓
Phase 1: Observability (state.ts, health.ts, logging)
    ↓
Phase 2: Adapter abstraction (adapter.ts, self-check)
    ↓
Phase 3: Fact Layer (capture.ts, paths.ts)
    ↓
Phase 4: Extraction + Provenance
    ↓
Phase 5: Dream + Promotion + Conflict resolution
    ↓
Phase 6: Replay + Status tools
```

Phase 0 (Migration) must come first — without it, all subsequent
development risks losing or misplacing existing memory files.

## 7. Non-Goals (v1)

- Event queue / async job processing (dispatch() is sufficient)
- Continuous event capture throughout session (tool.execute.before/after
  for every action) — reliability first, granularity later
- Structured logging framework (console.* + state.json is enough)
- Cross-project memory synchronization
- Vector store / semantic search backend

## 8. Migration Strategy

### Goals

- Do not lose existing memory files
- Preserve provenance (mark as `legacy` source)
- Support rollback (copy, don't move)
- Do not block plugin startup

### Migration Flow

```
Plugin Init
    |
    v
detectSchemaVersion(memoryDir)
    |
    +---- v2 (already migrated) → skip
    |
    +---- v1 (legacy) → migrateLegacyMemory()
              |
              v
         1. Copy *.md → semantic/memories/*.md
         2. Update frontmatter: add source.kind=legacy, confidence=explicit
         3. Copy originals → legacy/v1/*.md (backup, never deleted)
         4. Update MEMORY.md path references
         5. Write migration marker file (semantic/.migrated)
```

### Migration Rules

- **Copy, never move** — originals go to `legacy/v1/`, copies go to
  `semantic/memories/`
- **Frontmatter upgrade** — add `source` and `confidence` fields:

```yaml
# Before (v1):
---
name: User Role
type: user
---

# After (v2):
---
name: User Role
type: user
scope: user
confidence:
  level: explicit
source:
  kind: legacy
  fact_id: null
schema_version: 2
---
```

- **Idempotent** — if `semantic/.migrated` marker exists, skip migration
- **Non-blocking** — migration runs async; plugin loads immediately
- **Rollback** — delete `semantic/`, `processing/`, `fact/`, remove
  `.migrated` marker, restore from `legacy/v1/`
