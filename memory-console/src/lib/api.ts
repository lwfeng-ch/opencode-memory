import type {
  HealthResponse,
  MemoryListResponse,
  MemoryDetailResponse,
} from "@/types/api";

const API_BASE = "http://127.0.0.1:5173/api/v1";

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function fetchMemories(params?: {
  page?: number;
  pageSize?: number;
  scope?: string;
  type?: string;
  status?: string;
  search?: string;
}): Promise<MemoryListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize)
    searchParams.set("pageSize", String(params.pageSize));
  if (params?.scope) searchParams.set("scope", params.scope);
  if (params?.type) searchParams.set("type", params.type);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.search) searchParams.set("search", params.search);

  const url = `${API_BASE}/memories${
    searchParams.toString() ? `?${searchParams}` : ""
  }`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch memories: ${res.status}`);
  return res.json();
}

export async function fetchMemoryDetail(
  id: string,
): Promise<MemoryDetailResponse> {
  const res = await fetch(
    `${API_BASE}/memories/${encodeURIComponent(id)}`,
  );
  if (!res.ok) throw new Error(`Failed to fetch memory: ${res.status}`);
  return res.json();
}

export async function fetchMemoryHistory(id: string) {
  const res = await fetch(`${API_BASE}/memories/${encodeURIComponent(id)}/history`);
  if (!res.ok) throw new Error(`Failed to fetch history: ${res.status}`);
  return res.json();
}
