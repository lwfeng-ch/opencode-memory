/**
 * paths.test.ts — Unit tests for path helpers.
 */

import { test, expect } from "bun:test";
import { sep } from "path";
import { sanitizePath, getDailyLogPath, getUserMemoryDir, isMemoryPath } from "../src/paths.js";

test("sanitizePath replaces slashes and colons with dashes", () => {
  expect(sanitizePath("foo/bar")).toBe("foo-bar");
  expect(sanitizePath("a:b")).toBe("a-b");
  // Windows path with drive letter has both a colon and backslashes.
  expect(sanitizePath("C:\\Users")).toBe("C--Users");
});

test("getDailyLogPath builds YYYY/MM/YYYY-MM-DD.md path", () => {
  const date = new Date(2026, 6, 9); // month is 0-indexed
  const path = getDailyLogPath("/tmp/mem", date);
  expect(path).toContain(`tmp${sep}mem`);
  expect(path).toContain("logs");
  expect(path).toContain("2026");
  expect(path).toContain("2026-07-09.md");
});

test("getUserMemoryDir returns a path ending in /user", () => {
  const dir = getUserMemoryDir();
  expect(dir.endsWith("user")).toBe(true);
});

test("isMemoryPath rejects paths outside memory directory", () => {
  const memoryDir = "/home/user/.config/opencode/memory/user";
  expect(isMemoryPath("/home/user/.config/opencode/memory/user/role.md", memoryDir)).toBe(true);
  expect(isMemoryPath("/etc/passwd", memoryDir)).toBe(false);
  expect(isMemoryPath("/home/user/.config/opencode/memory/user-sibling", memoryDir)).toBe(false);
});

test("isMemoryPath handles trailing separators", () => {
  const memoryDir = "/home/user/.config/opencode/memory/user/";
  expect(isMemoryPath("/home/user/.config/opencode/memory/user/role.md", memoryDir)).toBe(true);
});
