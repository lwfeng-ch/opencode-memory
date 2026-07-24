"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchHealth,
  fetchMemories,
  fetchMemoryDetail,
  fetchMemoryHistory,
  fetchProposals,
  approveProposal,
  rejectProposal,
  fetchAuditEvents,
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

export function useProposals() {
  return useQuery({ queryKey: ["proposals"], queryFn: fetchProposals, refetchInterval: 30_000 });
}

export function useApproveProposal() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: approveProposal, onSuccess: () => { qc.invalidateQueries({ queryKey: ["proposals"] }); } });
}

export function useRejectProposal() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: rejectProposal, onSuccess: () => { qc.invalidateQueries({ queryKey: ["proposals"] }); } });
}

export function useAuditEvents(params?: { page?: number }) {
  return useQuery({ queryKey: ["audit", params], queryFn: () => fetchAuditEvents(params) });
}
