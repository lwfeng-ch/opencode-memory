/**
 * scan.test.ts — Unit tests for manifest and memory block formatting.
 */

import { test, expect } from "bun:test";
import { formatManifest, formatSelectedMemories, formatMemoriesByScope } from "../src/scan.js";
import type { MemoryHeader } from "../src/config.js";

function makeHeader(overrides: Partial<MemoryHeader> = {}): MemoryHeader {
  return {
    filename: "user_role.md",
    name: "User Role",
    description: "Senior backend engineer",
    type: "user",
    scope: "user",
    confidence: "explicit",
    mtimeMs: Date.now(),
    ...overrides,
  } as MemoryHeader;
}

test("formatManifest includes scope:type tag when both present", () => {
  const h = makeHeader({ scope: "user", type: "user" });
  const manifest = formatManifest([h]);
  expect(manifest).toContain("[user:user]");
  expect(manifest).toContain("user_role.md");
  expect(manifest).toContain("Senior backend engineer");
});

test("formatManifest uses type only when scope is missing", () => {
  const h = makeHeader({ scope: undefined, type: "project" });
  const manifest = formatManifest([h]);
  expect(manifest).toContain("[project]");
  expect(manifest).not.toContain("[undefined:project]");
});

test("formatSelectedMemories wraps each memory in <memory> block", () => {
  const h = makeHeader();
  const content = new Map([[h.filename, "## User\nSenior backend engineer."]]);
  const formatted = formatSelectedMemories([h], content, 1);
  expect(formatted).toContain("<memory ");
  expect(formatted).toContain("filename=\"user_role.md\"");
  expect(formatted).toContain("---content---");
  expect(formatted).toContain("---end---");
  expect(formatted).toContain("</memory>");
});

test("formatMemoriesByScope returns empty when no memories", () => {
  expect(formatMemoriesByScope([], [], new Map(), 1)).toBe("");
});

test("formatMemoriesByScope includes both user and project sections", () => {
  const userHeader = makeHeader({ filename: "pref.md", type: "feedback", scope: "user" });
  const projectHeader = makeHeader({ filename: "deadline.md", type: "project", scope: "project" });
  const content = new Map([
    [userHeader.filename, "Uses tabs."],
    [projectHeader.filename, "Deadline is Friday."],
  ]);
  const formatted = formatMemoriesByScope([userHeader], [projectHeader], content, 1);
  expect(formatted).toContain("## Current Project Memory");
  expect(formatted).toContain("## User Long-term Memory");
});
