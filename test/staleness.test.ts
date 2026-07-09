/**
 * staleness.test.ts — Unit tests for staleness helpers.
 *
 * Pure functions with no I/O, so no setup/teardown needed.
 */

import { test, expect } from "bun:test";
import { memoryAgeDays, memoryAge, memoryFreshnessText, memoryFreshnessNote } from "../src/staleness.js";

const MS_PER_DAY = 86_400_000;

test("memoryAgeDays returns 0 for today", () => {
  expect(memoryAgeDays(Date.now())).toBe(0);
});

test("memoryAgeDays returns 1 for yesterday", () => {
  expect(memoryAgeDays(Date.now() - MS_PER_DAY)).toBe(1);
});

test("memoryAgeDays clamps future timestamps to 0", () => {
  expect(memoryAgeDays(Date.now() + MS_PER_DAY * 7)).toBe(0);
});

test("memoryAge returns human-readable strings", () => {
  const now = Date.now();
  expect(memoryAge(now)).toBe("today");
  expect(memoryAge(now - MS_PER_DAY)).toBe("yesterday");
  expect(memoryAge(now - MS_PER_DAY * 5)).toBe("5 days ago");
});

test("memoryFreshnessText is empty when fresh", () => {
  const text = memoryFreshnessText(Date.now(), 1);
  expect(text).toBe("");
});

test("memoryFreshnessText warns when stale", () => {
  const text = memoryFreshnessText(Date.now() - MS_PER_DAY * 3, 1);
  expect(text).toContain("3 days old");
  expect(text).toContain("point-in-time observations");
});

test("memoryFreshnessNote wraps stale text in system-reminder", () => {
  const note = memoryFreshnessNote(Date.now() - MS_PER_DAY * 3, 1);
  expect(note).toContain("<system-reminder>");
  expect(note).toContain("</system-reminder>");
  expect(note.endsWith("\n")).toBe(true);
});

test("memoryFreshnessNote returns empty when fresh", () => {
  expect(memoryFreshnessNote(Date.now(), 1)).toBe("");
});
