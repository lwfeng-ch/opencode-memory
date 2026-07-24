import type { MemoryHeader } from "../config.js";

export interface ApiHealthResponse {
  status: "ok" | "degraded" | "error";
  uptime: number;
  memoryCount: number;
  pipelineStatus: {
    capture: string;
    extraction: string;
    dream: string;
    governance: string;
  };
}

export interface ApiMemoryListResponse {
  memories: MemoryHeader[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiMemoryDetailResponse {
  filename: string;
  name: string;
  description: string;
  type: string;
  scope: string;
  confidence: string;
  status: string;
  content: string;
  provenance: Record<string, unknown>;
  mtimeMs: number;
  recallCount: number;
  lastRecalledAt: string | null;
}

export interface ApiMemoryHistoryResponse {
  events: Array<{
    action: string;
    timestamp: number;
    actor: string;
    detail?: string;
  }>;
}

export interface ApiErrorResponse {
  error: string;
  code: string;
}
