export interface HealthResponse {
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

export interface MemoryHeader {
  filename: string;
  name: string;
  description: string | null;
  type: string | undefined;
  scope: string | undefined;
  confidence: string;
  status: string;
  mtimeMs: number;
  recallCount: number;
  lastRecalledAt: string | null;
}

export interface MemoryListResponse {
  memories: MemoryHeader[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MemoryDetailResponse {
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
