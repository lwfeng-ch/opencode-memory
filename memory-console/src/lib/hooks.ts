"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchHealth,
  fetchMemories,
  fetchMemoryDetail,
  fetchMemoryHistory,
} from "./api";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });
}

export function useMemories(params?: {
  page?: number;
  pageSize?: number;
  scope?: string;
  type?: string;
  status?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ["memories", params],
    queryFn: () => fetchMemories(params),
  });
}

export function useMemoryDetail(id: string | null) {
  return useQuery({
    queryKey: ["memory", id],
    queryFn: () => fetchMemoryDetail(id!),
    enabled: !!id,
  });
}

export function useMemoryHistory(id: string | null) {
  return useQuery({
    queryKey: ["memory-history", id],
    queryFn: () => fetchMemoryHistory(id!),
    enabled: !!id,
  });
}
