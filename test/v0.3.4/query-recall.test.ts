/**
 * Tests for v0.3.4 Phase 3 — Query-Driven Historical Recall
 *
 * Verifies:
 * - QueryIntentAnalyzer correctly detects historical keywords
 * - Normal queries return active-only scope
 * - isHistoricalQuery helper works
 * - archivedScoreMultiplier returns correct values
 * - RecallScope type is properly set
 */

import { describe, it, expect } from 'vitest'
import {
  QueryIntentAnalyzer,
  isHistoricalQuery,
  archivedScoreMultiplier,
  type RecallScope,
} from '../../src/recall/query-analyzer.js'

describe('QueryIntentAnalyzer', () => {
  const analyzer = new QueryIntentAnalyzer()

  describe('normal queries (active-only)', () => {
    it('should return active scope for empty query', () => {
      const result = analyzer.analyze('')
      expect(result.scope).toBe('active')
      expect(result.matchedKeywords).toHaveLength(0)
    })

    it('should return active scope for non-historical query', () => {
      const result = analyzer.analyze('How do I configure the database?')
      expect(result.scope).toBe('active')
      expect(result.matchedKeywords).toHaveLength(0)
    })

    it('should return active scope for current-focused query', () => {
      const result = analyzer.analyze('What is the current architecture?')
      expect(result.scope).toBe('active')
    })
  })

  describe('historical queries (active+archived)', () => {
    it('should detect Chinese historical keyword 以前', () => {
      const result = analyzer.analyze('以前我们怎么配置数据库的？')
      expect(result.scope).toBe('active+archived')
      expect(result.matchedKeywords).toContain('以前')
    })

    it('should detect Chinese historical keyword 之前', () => {
      const result = analyzer.analyze('之前讨论过 Docker 部署')
      expect(result.scope).toBe('active+archived')
      expect(result.matchedKeywords).toContain('之前')
    })

    it('should detect Chinese historical keyword 上次', () => {
      const result = analyzer.analyze('上次我们用的什么方案？')
      expect(result.scope).toBe('active+archived')
      expect(result.matchedKeywords).toContain('上次')
    })

    it('should detect Chinese historical keyword 曾经', () => {
      const result = analyzer.analyze('曾经遇到过这个问题吗？')
      expect(result.scope).toBe('active+archived')
      expect(result.matchedKeywords).toContain('曾经')
    })

    it('should detect Chinese historical keyword 历史', () => {
      const result = analyzer.analyze('历史记录中有没有类似的配置？')
      expect(result.scope).toBe('active+archived')
      expect(result.matchedKeywords).toContain('历史')
    })

    it('should detect Chinese compound keyword 之前讨论过', () => {
      const result = analyzer.analyze('之前讨论过 RAG 的实现方案')
      expect(result.scope).toBe('active+archived')
      expect(result.matchedKeywords).toContain('之前讨论过')
    })

    it('should detect English historical keyword previously', () => {
      const result = analyzer.analyze('How did we configure this previously?')
      expect(result.scope).toBe('active+archived')
      expect(result.matchedKeywords).toContain('previously')
    })

    it('should detect English historical keyword last time', () => {
      const result = analyzer.analyze('What was the approach last time we did this?')
      expect(result.scope).toBe('active+archived')
      expect(result.matchedKeywords).toContain('last time')
    })

    it('should detect English historical keyword previous discussion', () => {
      const result = analyzer.analyze('As per our previous discussion about the API')
      expect(result.scope).toBe('active+archived')
      expect(result.matchedKeywords).toContain('previous discussion')
    })

    it('should detect English historical keyword old version', () => {
      const result = analyzer.analyze('What was the old version of this setup?')
      expect(result.scope).toBe('active+archived')
      expect(result.matchedKeywords).toContain('old version')
    })
  })

  describe('isHistoricalQuery helper', () => {
    it('should return true for historical Chinese queries', () => {
      expect(isHistoricalQuery('以前我们怎么做的')).toBe(true)
    })

    it('should return true for historical English queries', () => {
      expect(isHistoricalQuery('What did we do previously?')).toBe(true)
    })

    it('should return false for normal queries', () => {
      expect(isHistoricalQuery('How do I set up the database?')).toBe(false)
    })

    it('should return false for empty query', () => {
      expect(isHistoricalQuery('')).toBe(false)
    })
  })

  describe('archivedScoreMultiplier', () => {
    it('should return 0.3 for active+archived scope', () => {
      expect(archivedScoreMultiplier('active+archived')).toBe(0.3)
    })

    it('should return 0 for active scope', () => {
      expect(archivedScoreMultiplier('active')).toBe(0)
    })
  })

  describe('query preservation', () => {
    it('should preserve original query text', () => {
      const result = analyzer.analyze('以前怎么配置的？')
      expect(result.query).toBe('以前怎么配置的？')
    })
  })
})