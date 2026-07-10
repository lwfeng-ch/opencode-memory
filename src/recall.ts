/**
 * opencode-memory — Two-stage recall pipeline
 *
 * Design rationale:
 *   Stage 1 (rule filter) is free — zero model calls, pure computation.
 *   Stage 2 (LLM rerank) runs one lightweight call on Stage 1 survivors only.
 *   This means the LLM input goes from N files to config.recall.maxCandidates
 *   (typically 200 → 20), dramatically reducing cost for free/weak models
 *   while keeping the rerank quality of a model-informed selection.
 *
 * Both stages degrade gracefully: if the LLM call fails (timeout, auth,
 * rate-limit), the system falls back to Stage 1 results with zero data loss.
 */

import type { MemoryHeader, MemoryPluginConfig, AgentSessionCreateOptions } from "./config.js";
import type { MemoryStore } from "./store.js";
import { scanMemoryFiles, formatManifest } from "./scan.js";
import { memoryAgeDays } from "./staleness.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface RelevantMemory {
  filename: string;
  content: string;
  mtimeMs: number;
}

export interface RecallResult {
  memories: RelevantMemory[];
  /** Stats for telemetry/debugging */
  stage1Count: number; // candidates after rule filter
  stage2Count: number; // final selected count
  llmUsed: boolean; // whether LLM rerank ran
}

export interface ScopedRecallResult extends RecallResult {
  /** Memories originating from the user-level store. */
  userMemories: RelevantMemory[];
  /** Memories originating from the project-level store. */
  projectMemories: RelevantMemory[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ScoredCandidate {
  header: MemoryHeader;
  score: number;
  source: "user" | "project";
}

// ---------------------------------------------------------------------------
// Stage 1 — Rule filter scoring
// ---------------------------------------------------------------------------

/**
 * Type-keyword map for the type bonus in Stage 1 scoring.
 * Each entry maps a set of trigger words to a memory type.
 */
const TYPE_KEYWORDS: Array<{ words: string[]; type: string }> = [
  { words: ["user", "role"], type: "user" },
  { words: ["feedback", "correct", "stop"], type: "feedback" },
  { words: ["project", "deadline"], type: "project" },
  { words: ["reference", "url", "link"], type: "reference" },
];

/**
 * Score a memory header against the query.
 *
 * Three additive components:
 *   1. Keyword overlap — count of query words (>2 chars) that appear in
 *      the header's description or filename (case-insensitive)
 *   2. Type bonus — +2 when query contains type-related trigger words
 *      matching the memory's type
 *   3. Recency bonus — max(0, 3 - floor(ageDays / 7)), decays over 3 weeks
 */
function scoreMemory(query: string, header: MemoryHeader): number {
  const queryLower = query.toLowerCase();

  // --- Keyword overlap ---
  const queryWords = queryLower
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const descriptionLower = header.description?.toLowerCase() ?? "";
  const filenameLower = header.filename.toLowerCase();

  let keywordScore = 0;
  for (const word of queryWords) {
    if (descriptionLower.includes(word) || filenameLower.includes(word)) {
      keywordScore++;
    }
  }

  // --- Type bonus ---
  let typeBonus = 0;
  if (header.type !== undefined) {
    for (const entry of TYPE_KEYWORDS) {
      if (entry.type === header.type && entry.words.some((w) => queryLower.includes(w))) {
        typeBonus += 2;
      }
    }
  }

  // --- Recency bonus — only applies when there's at least some keyword/type relevance ---
  // Without this guard, fresh files score 3+ even with zero relevance, flooding recall
  // with unrelated memories. Recency should amplify relevance, not create it.
  let recencyBonus = 0;
  if (keywordScore > 0 || typeBonus > 0) {
    const ageDays = memoryAgeDays(header.mtimeMs);
    recencyBonus = Math.max(0, 3 - Math.floor(ageDays / 7));
  }

  return keywordScore + typeBonus + recencyBonus;
}

// ---------------------------------------------------------------------------
// Stage 2 — LLM rerank helpers
// ---------------------------------------------------------------------------

/**
 * Build the system prompt sent to the LLM for the rerank step.
 *
 * Instructs the model to select relevant filenames from a manifest and
 * output ONLY valid JSON — no commentary, no markdown fences.
 */
function buildSelectionPrompt(
  query: string,
  manifest: string,
  maxResults: number,
): string {
  return (
    "You are selecting memories for an AI coding agent.\n" +
    "\n" +
    `Query: ${query}\n` +
    "\n" +
    "Available memories:\n" +
    `${manifest}\n` +
    "\n" +
    `Select up to ${maxResults} filenames that are clearly useful.\n` +
    'Be conservative — if unsure, exclude. Empty list is valid.\n' +
    'Output ONLY valid JSON: {"selected_memories": ["file1.md", ...]}'
  );
}

/**
 * Extract a JSON selection response from the LLM's reply.
 *
 * Tries several common response shapes (string, `{ content }`, `{ response }`,
 * `{ message: { content } }`, OpenAI `{ choices: [...] }`, generic array-of-
 * messages) and falls back to regex extraction from the stringified body.
 *
 * Returns an empty array on any failure (no JSON found, malformed, wrong
 * shape) — the caller treats an empty selection as valid.
 */
function parseSelectionResponse(
  response: unknown,
): string[] {
  // 1. Normalise response to a text string
  let text = "";

  if (typeof response === "string") {
    text = response;
  } else if (Array.isArray((response as Record<string, unknown>)?.parts)) {
    // Handle SDK message shape: { info: AssistantMessage, parts: [{ type: "text", text: "..." }] }
    const parts = (response as Record<string, unknown>).parts as Array<Record<string, unknown>>;
    text = parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("\n");
  } else if (typeof (response as any)?.content === "string") {
    text = (response as any).content;
  } else if (typeof (response as any)?.response === "string") {
    text = (response as any).response;
  } else if (typeof (response as any)?.text === "string") {
    text = (response as any).text;
  } else if (typeof (response as any)?.message?.content === "string") {
    text = (response as any).message.content;
  } else if (Array.isArray((response as any)?.choices)) {
    const first = (response as any).choices[0];
    text = first?.message?.content ?? first?.text ?? "";
  } else if (Array.isArray((response as any)?.messages)) {
    const msgs = (response as any).messages as Array<{ content?: string }>;
    const last = msgs[msgs.length - 1];
    text = last?.content ?? "";
  } else {
    try {
      text = JSON.stringify(response);
    } catch {
      return [];
    }
  }

  if (text.length === 0) return [];

  // 2. Extract JSON blob containing "selected_memories"
  const jsonMatch = text.match(/\{[\s\S]*"selected_memories"[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed.selected_memories)) {
      return parsed.selected_memories.filter(
        (f: unknown): f is string => typeof f === "string",
      );
    }
  } catch {
    // Malformed JSON — fall through to empty
  }

  return [];
}

// ---------------------------------------------------------------------------
// Result building
// ---------------------------------------------------------------------------

/**
 * Read full content for each memory header from the store.
 *
 * Failures for individual files (deleted between scan and read, permission
 * errors) are silently dropped — the result may contain fewer entries than
 * requested.
 */
async function buildResultFromHeaders(
  headers: MemoryHeader[],
  store: MemoryStore,
): Promise<RelevantMemory[]> {
  const results = await Promise.allSettled(
    headers.map(async (h): Promise<RelevantMemory> => ({
      filename: h.filename,
      content: await store.read(h.filename),
      mtimeMs: h.mtimeMs,
    })),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<RelevantMemory> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Recall memories relevant to a query string.
 *
 * Two-stage design:
 *
 * **Stage 1 (Rule Filter) — free, zero model calls:**
 *   1. Scan all memory files via `scanMemoryFiles(store)`
 *   2. Score each by keyword overlap, type match, and recency
 *   3. Keep the top `config.recall.maxCandidates` (default 20)
 *
 * **Stage 2 (LLM Rerank) — one lightweight call:**
 *   1. Format survivors as a text manifest
 *   2. Ask the configured agent to select the most relevant filenames
 *   3. Parse the JSON response, validate against the candidate set
 *   4. If the LLM call fails at any point, fall back to Stage 1 results
 *
 * @param query  - Natural-language query to match against
 * @param store  - MemoryStore instance
 * @param config - Plugin configuration (recall section)
 * @param client - OpenCode session API client with `session.create` and
 *                 `session.chat`. Duck-typed so any provider that exposes
 *                 these two methods can be used.
 * @returns      Selected memories with telemetry stats
 */
export async function recallMemories(
  query: string,
  store: MemoryStore,
  config: MemoryPluginConfig,
  client: {
    session: {
      create: (opts: AgentSessionCreateOptions) => Promise<{ id: string }>;
      chat: (id: string, opts: { message: string }) => Promise<unknown>;
    };
  },
): Promise<RecallResult> {
  // -----------------------------------------------------------------------
  // Stage 1: Rule filter
  // -----------------------------------------------------------------------

  const allHeaders = await scanMemoryFiles(store);

  const scored = allHeaders.map((header) => ({
    header,
    score: scoreMemory(query, header),
  }));

  const nonZero = scored.filter((s) => s.score > 0);

  if (nonZero.length === 0) {
    return {
      memories: [],
      stage1Count: 0,
      stage2Count: 0,
      llmUsed: false,
    };
  }

  nonZero.sort((a, b) => b.score - a.score);

  const candidateHeaders = nonZero
    .slice(0, config.recall.maxCandidates)
    .map((c) => c.header);
  const stage1Count = candidateHeaders.length;

  // -----------------------------------------------------------------------
  // Stage 2: LLM rerank (optional — gated by config)
  // -----------------------------------------------------------------------

  if (config.recall.llmRerankDisabled) {
    // LLM rerank disabled — return top N from rule filter
    const selected = candidateHeaders.slice(0, config.recall.maxResults);
    const memories = await buildResultFromHeaders(selected, store);
    return {
      memories,
      stage1Count,
      stage2Count: memories.length,
      llmUsed: false,
    };
  }

  // Build manifest for the LLM
  const manifest = formatManifest(candidateHeaders);

  // Create session for the rerank call
  let sessionId: string;
  try {
    const createOpts: AgentSessionCreateOptions = {};
    if (config.models.recall) createOpts.model = config.models.recall;
    const session = await client.session.create(createOpts);
    sessionId = session.id;
  } catch {
    // Graceful degradation: LLM unavailable → use rule-filtered results
    const selected = candidateHeaders.slice(0, config.recall.maxResults);
    const memories = await buildResultFromHeaders(selected, store);
    return {
      memories,
      stage1Count,
      stage2Count: memories.length,
      llmUsed: false,
    };
  }

  // Send the selection prompt
  const prompt = buildSelectionPrompt(
    query,
    manifest,
    config.recall.maxResults,
  );

  try {
      const response = await client.session.chat(sessionId, {
        message: prompt,
      });

    const selectedFilenames = parseSelectionResponse(response);

    // Validate filenames against the candidate set
    const validFilenames = new Set(candidateHeaders.map((h) => h.filename));
    const valid = selectedFilenames.filter((f) => validFilenames.has(f));

    const selectedHeaders = candidateHeaders.filter((h) =>
      valid.includes(h.filename),
    );
    const memories = await buildResultFromHeaders(selectedHeaders, store);

    return {
      memories,
      stage1Count,
      stage2Count: memories.length,
      llmUsed: true,
    };
  } catch {
    // LLM call or parsing failed — fall back to rule-filtered results
    const selected = candidateHeaders.slice(0, config.recall.maxResults);
    const memories = await buildResultFromHeaders(selected, store);
    return {
      memories,
      stage1Count,
      stage2Count: memories.length,
      llmUsed: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Multi-scope recall
// ---------------------------------------------------------------------------

/**
 * Read a single candidate's content from the correct store.
 */
async function readScopedCandidate(
  c: ScoredCandidate,
  userStore: MemoryStore,
  projectStore: MemoryStore,
): Promise<RelevantMemory> {
  const store = c.source === "user" ? userStore : projectStore;
  const content = await store.read(c.header.filename);
  return { filename: c.header.filename, content, mtimeMs: c.header.mtimeMs };
}

/**
 * Read and split selected candidates into user/project arrays.
 */
async function processSelected(
  selected: ScoredCandidate[],
  userStore: MemoryStore,
  projectStore: MemoryStore,
  config: MemoryPluginConfig,
): Promise<{
  memories: RelevantMemory[];
  userMemories: RelevantMemory[];
  projectMemories: RelevantMemory[];
}> {
  const userMemories: RelevantMemory[] = [];
  const projectMemories: RelevantMemory[] = [];

  for (const c of selected) {
    const rm = await readScopedCandidate(c, userStore, projectStore);
    if (c.source === "user") userMemories.push(rm);
    else projectMemories.push(rm);
  }

  const memories = config.scope.projectOverridesUser
    ? [...projectMemories, ...userMemories]
    : [...userMemories, ...projectMemories];

  return { memories, userMemories, projectMemories };
}

/**
 * Score a set of headers against the query, returning sorted scored entries.
 */
function scoreHeaders(
  query: string,
  headers: MemoryHeader[],
): Array<{ header: MemoryHeader; score: number }> {
  return headers
    .map((header) => ({ header, score: scoreMemory(query, header) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Recall memories from both user and project stores.
 *
 * Two-stage design mirroring `recallMemories`, but operating on both stores
 * simultaneously:
 *
 * Stage 1 runs independently on each store, taking top N/2 from each
 * (minimum 5 per store). Candidates with the same filename in both scopes
 * are deduplicated with priority based on `config.scope.projectOverridesUser`.
 *
 * Stage 2 (LLM rerank) runs once on the merged candidate set. The manifest
 * includes scope tags so the model can distinguish user vs project memories.
 *
 * @param query        - Natural-language query to match against
 * @param userStore    - MemoryStore for the user-level memory directory
 * @param projectStore - MemoryStore for the project-level memory directory
 * @param config       - Plugin configuration
 * @param client       - OpenCode session API client
 * @returns            Selected memories split by scope, with telemetry stats
 */
export async function recallMemoriesMultiScope(
  query: string,
  userStore: MemoryStore,
  projectStore: MemoryStore,
  config: MemoryPluginConfig,
  client: {
    session: {
      create: (opts: AgentSessionCreateOptions) => Promise<{ id: string }>;
      chat: (id: string, opts: { message: string }) => Promise<unknown>;
    };
  },
): Promise<ScopedRecallResult> {
  // -----------------------------------------------------------------------
  // Stage 1: Score both stores independently
  // -----------------------------------------------------------------------

  const [userHeaders, projectHeaders] = await Promise.all([
    scanMemoryFiles(userStore),
    scanMemoryFiles(projectStore),
  ]);

  const userScored = scoreHeaders(query, userHeaders);
  const projectScored = scoreHeaders(query, projectHeaders);

  // Take top N/2 from each store (minimum 5 per store)
  const perStore = Math.max(5, Math.floor(config.recall.maxCandidates / 2));

  const userCandidates: ScoredCandidate[] = userScored
    .slice(0, perStore)
    .map((c) => ({ ...c, source: "user" }));
  const projectCandidates: ScoredCandidate[] = projectScored
    .slice(0, perStore)
    .map((c) => ({ ...c, source: "project" }));

  // Merge with dedup by filename
  // Priority: projectOverridesUser → project wins; otherwise → user wins (kept first)
  const candidateMap = new Map<string, ScoredCandidate>();
  for (const c of userCandidates) {
    candidateMap.set(c.header.filename, c);
  }
  for (const c of projectCandidates) {
    const existing = candidateMap.get(c.header.filename);
    if (!existing || config.scope.projectOverridesUser) {
      candidateMap.set(c.header.filename, c);
    }
    // When !projectOverridesUser and existing exists, keep the user version
  }

  const mergedCandidates = [...candidateMap.values()];
  const stage1Count = mergedCandidates.length;

  if (stage1Count === 0) {
    return {
      memories: [],
      userMemories: [],
      projectMemories: [],
      stage1Count: 0,
      stage2Count: 0,
      llmUsed: false,
    };
  }

  // -----------------------------------------------------------------------
  // Stage 2: LLM rerank (optional — gated by config)
  // -----------------------------------------------------------------------

  if (config.recall.llmRerankDisabled) {
    const selected = mergedCandidates.slice(0, config.recall.maxResults);
    const result = await processSelected(selected, userStore, projectStore, config);
    return {
      ...result,
      stage1Count,
      stage2Count: result.memories.length,
      llmUsed: false,
    };
  }

  // Build manifest for the LLM — formatManifest already includes scope tags
  // when the header's scope field is populated
  const manifest = formatManifest(mergedCandidates.map((c) => c.header));

  // Create session for the rerank call
  let sessionId: string;
  try {
    const createOpts: AgentSessionCreateOptions = {};
    if (config.models.recall) createOpts.model = config.models.recall;
    const session = await client.session.create(createOpts);
    sessionId = session.id;
  } catch {
    // Graceful degradation: LLM unavailable → use rule-filtered results
    const selected = mergedCandidates.slice(0, config.recall.maxResults);
    const result = await processSelected(selected, userStore, projectStore, config);
    return {
      ...result,
      stage1Count,
      stage2Count: result.memories.length,
      llmUsed: false,
    };
  }

  // Send the selection prompt
  const prompt = buildSelectionPrompt(query, manifest, config.recall.maxResults);

  try {
      const response = await client.session.chat(sessionId, {
        message: prompt,
      });

    const selectedFilenames = parseSelectionResponse(response);

    // Validate filenames against the merged candidate set
    const validFilenames = new Set(mergedCandidates.map((c) => c.header.filename));
    const valid = selectedFilenames.filter((f) => validFilenames.has(f));

    const selectedCandidates = mergedCandidates.filter((c) =>
      valid.includes(c.header.filename),
    );
    const result = await processSelected(selectedCandidates, userStore, projectStore, config);

    return {
      ...result,
      stage1Count,
      stage2Count: result.memories.length,
      llmUsed: true,
    };
  } catch {
    // LLM call or parsing failed — fall back to rule-filtered results
    const selected = mergedCandidates.slice(0, config.recall.maxResults);
    const result = await processSelected(selected, userStore, projectStore, config);
    return {
      ...result,
      stage1Count,
      stage2Count: result.memories.length,
      llmUsed: false,
    };
  }
}
