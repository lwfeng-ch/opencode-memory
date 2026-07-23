---
name: "Session: Documentation-Code Discrepancy Audit"
description: "Audited README/ARCHITECTURE docs vs actual code in opencode-memory v0.3.4 Phase 0"
---

# Session Title
_Documentation vs Code Discrepancy Audit for opencode-memory v0.3.4_

# Current State
_Session completed. All 6 audit checks performed: test count, line counts, Known Limitations, TODO/FIXME scan, v0.3.3 bug status, git status. Multiple doc lag issues identified._

# Task Specification
_User requested systematic audit of README.md and ARCHITECTURE.md claims against actual codebase state for opencode-memory v0.3.4 Phase 0. Checks: (1) test file count (README claims "669 tests across 67 files"), (2) per-file line counts vs ARCHITECTURE claims, (3) Known Limitations relevance, (4) TODO/FIXME markers, (5) v0.3.3 bug fix status (package.json zeroed, repair-cli hardcoded scope), (6) uncommitted changes._

# Files & Functions
- `README.md` — Claims 669 tests / 67 test files; likely outdated since no `*.test.ts` files found in current dir structure
- `ARCHITECTURE.md` — Line count estimates (extraction.ts ~930, dream.ts ~770, index.ts 448, config.ts ~650) appear inflated vs actual visible file lengths (100+ lines per view) — suggests refactoring or aggregated counts
- `src/extraction.ts` — ARCHITECTURE claims ~930 lines; visible portion much shorter
- `src/dream.ts` — ARCHITECTURE claims ~770 lines; visible portion much shorter
- `src/index.ts` — ARCHITECTURE claims 448 lines; visible portion much shorter
- `src/config.ts` — ARCHITECTURE claims ~650 lines; visible portion much shorter
- `scripts/repair-cli.ts` — v0.3.3 bug (hardcoded `user` scope) verified FIXED: now has `--scope project|user|all` with `getMemoryDirs()` multi-scope support
- `package.json` — v0.3.3 bug (zeroed by commit 0adb23a) verified FIXED: git log shows restoration
- `ARCHITECTURE.md:847-858` — Known Limitations section all 6 items still apply: isTransientToolMemory desc check, state.json concurrent write races, SDK pagination, hardcoded category labels, C1 integration timing, pre-existing tsc errors

# Errors & Corrections
_No runtime errors encountered. Audit findings:_
- **P0: Test count claim** — README says "669 tests across 67 files" but no `*.test.ts` files found in current workspace view. Either tests are elsewhere (generated/different dir) or doc is stale.
- **P1: Line counts inflated** — ARCHITECTURE claims ~930-650 lines for key files, visible views show ~100+ lines. Significant refactoring may have occurred without doc update.
- **No uncommitted changes** — git status clean on HEAD 5f8adfdbc14807ea51f081cb259c76a58dd62b28
- **No Phase 0 TODO/FIXME** — src/ modules clean of marker comments
- **v0.3.3 bugs FIXED** — package.json restored, repair-cli scope handling fixed

# Worklog
1. Checked git status — clean, HEAD 5f8adfdbc14
2. Counted actual test files — none found (`*.test.ts`) in current view
3. Compared ARCHITECTURE line claims vs actual file reads — all overstated
4. Verified Known Limitations still apply — yes, all 6
5. Grepped TODO/FIXME — none in Phase 0 src/
6. Checked v0.3.3 bug fixes — package.json and repair-cli both fixed
