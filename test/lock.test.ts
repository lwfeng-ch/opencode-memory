/**
 * lock.test.ts — Unit tests for file-based locking.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm, stat, utimes } from "fs/promises";
import { acquireLock, releaseLock, getLockMtime, isLockHeld } from "../src/lock.js";

const LOCK_DIR = join(tmpdir(), "opencode-mem-lock-test-" + Date.now());
let lockPath: string;

beforeEach(async () => {
  lockPath = join(LOCK_DIR, "test.lock");
  await mkdir(LOCK_DIR, { recursive: true });
});

afterEach(async () => {
  try {
    await rm(LOCK_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

test("acquireLock returns true on first call and false on second", async () => {
  const first = await acquireLock(lockPath, 60_000);
  expect(first).toBe(true);

  const second = await acquireLock(lockPath, 60_000);
  expect(second).toBe(false);

  await releaseLock(lockPath);
});

test("releaseLock removes lock file", async () => {
  await acquireLock(lockPath, 60_000);
  await releaseLock(lockPath);

  await expect(stat(lockPath)).rejects.toThrow();
});

test("getLockMtime returns 0 when lock does not exist", async () => {
  expect(await getLockMtime(lockPath)).toBe(0);
});

test("isLockHeld returns false when lock does not exist", async () => {
  expect(await isLockHeld(lockPath, 60_000)).toBe(false);
});

test("isLockHeld returns true while lock is held", async () => {
  await acquireLock(lockPath, 60_000);
  expect(await isLockHeld(lockPath, 60_000)).toBe(true);
  await releaseLock(lockPath);
});

test("stale lock can be re-acquired", async () => {
  const oldMtime = new Date(Date.now() - 3_600_000); // 1 hour ago
  const { writeFile } = await import("fs/promises");
  await writeFile(lockPath, String(process.pid));
  await utimes(lockPath, oldMtime, oldMtime);

  const reacquired = await acquireLock(lockPath, 1_000); // 1 second stale timeout
  expect(reacquired).toBe(true);
});
