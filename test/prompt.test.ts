/**
 * prompt.test.ts — Unit tests for prompt helpers.
 */

import { test, expect } from "bun:test";
import { truncateEntrypoint } from "../src/prompt.js";

test("truncateEntrypoint returns content unchanged when under caps", () => {
  const content = "line one\nline two\nline three";
  const result = truncateEntrypoint(content, 10, 10_000);
  expect(result.wasLineTruncated).toBe(false);
  expect(result.wasByteTruncated).toBe(false);
  expect(result.content).toBe(content);
});

test("truncateEntrypoint truncates by lines", () => {
  const content = "a\n".repeat(50).trimEnd();
  const result = truncateEntrypoint(content, 10, 10_000);
  expect(result.wasLineTruncated).toBe(true);
  // Original content is truncated to maxLines; a warning is then appended.
  expect(result.content).toContain("WARNING");
  expect(result.content.split("\n").filter((l) => l === "a").length).toBe(10);
});

test("truncateEntrypoint sets byte flag only when actually truncated", () => {
  // 300 short lines → line truncation to 200 lines, but bytes may still be under cap
  const content = "short\n".repeat(300).trimEnd();
  const result = truncateEntrypoint(content, 200, 100_000);
  expect(result.wasLineTruncated).toBe(true);
  // Should NOT set byte flag if the line-truncated content fits in byte cap
  expect(result.wasByteTruncated).toBe(false);
});

test("truncateEntrypoint truncates by bytes when necessary", () => {
  const content = "x".repeat(10_000);
  const result = truncateEntrypoint(content, 10_000, 1_000);
  expect(result.wasByteTruncated).toBe(true);
  // The raw content is cut to at most maxBytes; the appended warning can push
  // the final total slightly above maxBytes.
  expect(result.byteCount).toBeLessThan(content.length);
  expect(result.byteCount).toBeLessThanOrEqual(1_500);
});
