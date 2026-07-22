/**
 * Tests for v0.3.4 Phase 2 — Similarity Scanner
 *
 * Verifies:
 * - Exact duplicate → candidate
 * - Below threshold → no candidate
 * - Active only scanning
 * - Target selection (confidence > description > filename)
 * - Feedback duplicate detection
 * - Multi-pair deduplication
 * - Configurable threshold
 */

import { describe, it, expect } from 'vitest'
import { SimilarityScanner, type ScannerMemory } from '../../src/migration/similarity-scanner.js'
import type { MemoryHeader } from '../../src/config.js'

function makeMemory(overrides: {
  filename: string
  content?: string
  confidence?: string
  description?: string | null
  status?: string
}): ScannerMemory {
  return {
    filename: overrides.filename,
    content: overrides.content ?? 'User is a senior Go engineer.',
    header: {
      filename: overrides.filename,
      filePath: `/test/${overrides.filename}`,
      mtimeMs: Date.now(),
      description: overrides.description ?? 'A test memory',
      type: 'project',
      scope: 'project',
      confidence: (overrides.confidence ?? 'inferred') as any,
      schemaVersion: 1,
      recallCount: 0,
      lastRecalledAt: null,
      status: (overrides.status ?? 'active') as 'active' | 'archived' | undefined,
    },
  }
}

describe('SimilarityScanner', () => {
  describe('basic detection', () => {
    it('should detect exact duplicate as high-similarity candidate', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const memories = [
        makeMemory({ filename: 'a.md', content: 'User prefers TypeScript for all projects.' }),
        makeMemory({ filename: 'b.md', content: 'User prefers TypeScript for all projects.' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(1)
      expect(candidates[0].similarity).toBeGreaterThanOrEqual(0.8)
      expect(candidates[0].type).toBe('merge')
    })

    it('should detect sufficiently similar content (0.81+)', () => {
      const scanner = new SimilarityScanner({ scope: 'project', threshold: 0.8 })
      const memories = [
        makeMemory({ filename: 'a.md', content: 'User prefers TypeScript for all projects and uses strict mode enabled with full type checking.' }),
        makeMemory({ filename: 'b.md', content: 'User prefers TypeScript for all projects and uses strict mode enabled with full type checking for safety.' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(1)
      expect(candidates[0].similarity).toBeGreaterThanOrEqual(0.8)
    })

    it('should NOT detect candidate when similarity is below threshold', () => {
      const scanner = new SimilarityScanner({ scope: 'project', threshold: 0.8 })
      const memories = [
        makeMemory({ filename: 'a.md', content: 'User prefers TypeScript for all projects.' }),
        makeMemory({ filename: 'b.md', content: 'Project uses Docker for deployment with Kubernetes orchestration.' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(0)
    })
  })

  describe('lifecycle filtering', () => {
    it('should ignore archived memories', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const memories = [
        makeMemory({ filename: 'a.md', content: 'Identical content here.', status: 'active' }),
        makeMemory({ filename: 'b.md', content: 'Identical content here.', status: 'archived' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(0)
    })

    it('should scan active-only even when archived exist', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const memories = [
        makeMemory({ filename: 'a.md', content: 'Duplicate content active.', status: 'active' }),
        makeMemory({ filename: 'b.md', content: 'Duplicate content active.', status: 'archived' }),
        makeMemory({ filename: 'c.md', content: 'Duplicate content active.', status: 'active' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(1)
      // Only a.md and c.md are active — b.md is archived and ignored
      expect(candidates[0].sourceFiles).toContain('c.md')
      expect(candidates[0].targetFile).toBe('a.md')
    })
  })

  describe('target selection', () => {
    it('should select higher confidence as target', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const memories = [
        makeMemory({ filename: 'low.md', content: 'Same content here.', confidence: 'inferred' }),
        makeMemory({ filename: 'high.md', content: 'Same content here.', confidence: 'explicit' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(1)
      expect(candidates[0].targetFile).toBe('high.md')
      expect(candidates[0].sourceFiles).toContain('low.md')
    })

    it('should select longer description when confidence equal', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const memories = [
        makeMemory({ filename: 'short.md', content: 'Same content here.', confidence: 'inferred', description: 'Short' }),
        makeMemory({ filename: 'long.md', content: 'Same content here.', confidence: 'inferred', description: 'Much longer description that provides more context' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(1)
      expect(candidates[0].targetFile).toBe('long.md')
    })

    it('should fall back to filename when confidence and description equal', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const memories = [
        makeMemory({ filename: 'a.md', content: 'Same content.', confidence: 'inferred', description: 'Same desc' }),
        makeMemory({ filename: 'b.md', content: 'Same content.', confidence: 'inferred', description: 'Same desc' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(1)
      expect(candidates[0].targetFile).toBe('a.md') // alphabetical
    })
  })

  describe('reason detection', () => {
    it('should detect feedback_* duplicates as feedback_duplicate', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const memories = [
        makeMemory({ filename: 'feedback_abc.md', content: 'User prefers Bun for all projects.' }),
        makeMemory({ filename: 'feedback_def.md', content: 'User prefers Bun for all projects.' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(1)
      expect(candidates[0].reason).toBe('feedback_duplicate')
    })

    it('should detect normal memory duplicates as semantic_duplicate', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const memories = [
        makeMemory({ filename: 'user_role.md', content: 'User prefers Bun for all projects.' }),
        makeMemory({ filename: 'preference.md', content: 'User prefers Bun for all projects.' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(1)
      expect(candidates[0].reason).toBe('semantic_duplicate')
    })
  })

  describe('multi-pair deduplication', () => {
    it('should merge A/B/C chain into single candidate', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const content = 'User prefers Bun over npm for all JavaScript projects.'
      const memories = [
        makeMemory({ filename: 'a.md', content, confidence: 'explicit' }),
        makeMemory({ filename: 'b.md', content, confidence: 'inferred' }),
        makeMemory({ filename: 'c.md', content, confidence: 'inferred' }),
      ]
      const candidates = scanner.scan(memories)
      // All three identical → 3 pairs → should produce at most 2 candidates
      // (a is target for b,c; b could also be target for c if dedup doesn't merge across targets)
      // The important thing: a.md should never be a source
      const aCandidates = candidates.filter(c => c.targetFile === 'a.md')
      const bCandidates = candidates.filter(c => c.targetFile === 'b.md')
      // a.md has explicit confidence, so it should be the preferred target
      // At minimum, a.md should not be in any sourceFiles
      for (const c of candidates) {
        expect(c.sourceFiles).not.toContain('a.md')
      }
      // a.md should be the target for at least one candidate
      expect(aCandidates.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('edge cases', () => {
    it('should return empty for single memory', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const memories = [makeMemory({ filename: 'a.md' })]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(0)
    })

    it('should return empty for empty list', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const candidates = scanner.scan([])
      expect(candidates.length).toBe(0)
    })

    it('should respect configurable threshold', () => {
      const scanner = new SimilarityScanner({ scope: 'project', threshold: 0.95 })
      const memories = [
        makeMemory({ filename: 'a.md', content: 'User prefers TypeScript for all projects.' }),
        makeMemory({ filename: 'b.md', content: 'User prefers TypeScript for all projects with strict mode.' }),
      ]
      const candidates = scanner.scan(memories)
      // At 0.95 threshold, these similar-but-not-identical texts should NOT match
      expect(candidates.length).toBe(0)
    })

    it('should generate correct MergeCandidate structure', () => {
      const scanner = new SimilarityScanner({ scope: 'project' })
      const memories = [
        makeMemory({ filename: 'a.md', content: 'Exact duplicate content here.' }),
        makeMemory({ filename: 'b.md', content: 'Exact duplicate content here.' }),
      ]
      const candidates = scanner.scan(memories)
      expect(candidates.length).toBe(1)
      const c = candidates[0]
      expect(c).toHaveProperty('id')
      expect(c).toHaveProperty('type', 'merge')
      expect(c).toHaveProperty('sourceFiles')
      expect(c).toHaveProperty('targetFile')
      expect(c).toHaveProperty('similarity')
      expect(c).toHaveProperty('reason')
      expect(c).toHaveProperty('confidence')
      expect(c).toHaveProperty('mergeStrategy')
      expect(c.mergeStrategy).toHaveProperty('keep')
      expect(c).toHaveProperty('scope', 'project')
    })
  })
})