"use client";
import type { Node } from "@xyflow/react";
export function NodeInspector({ node }: { node: Node | null }) {
  if (!node) return <div className="text-sm text-zinc-500 p-4">Click a node to inspect</div>;
  const data = node.data as Record<string, unknown>;
  return (
    <div className="p-4 space-y-3">
      <h3 className="text-sm font-medium text-zinc-100">Node Inspector</h3>
      <div className="space-y-2 text-xs">
        <Row label="ID" value={node.id} />
        <Row label="Type" value={node.type ?? ""} />
        <Row label="Label" value={String(data.label ?? "")} />
        {data.confidence !== undefined && <Row label="Confidence" value={`${(Number(data.confidence) * 100).toFixed(0)}%`} />}
        {data.source !== undefined && <Row label="Source" value={String(data.source)} />}
        {data.status !== undefined && <Row label="Status" value={String(data.status)} />}
        {data.score !== undefined && <Row label="Score" value={`${(Number(data.score) * 100).toFixed(0)}%`} />}
      </div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-zinc-500">{label}</span><span className="text-zinc-300">{value}</span></div>;
}