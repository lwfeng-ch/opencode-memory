"use client";
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

type EvidenceNodeData = { label: string; score?: number };
type EvidenceNodeType = Node<EvidenceNodeData>;

function EvidenceNodeInner({ data }: NodeProps<EvidenceNodeType>) {
  return (
    <div className="bg-purple-950/40 border border-purple-700/50 rounded px-2 py-1.5 shadow-lg min-w-[120px]">
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-purple-500" />
      <div className="text-[10px] text-purple-400 uppercase tracking-wider">EVIDENCE</div>
      <div className="text-xs text-zinc-300 mt-0.5">{data.label}</div>
      {data.score && <div className="text-[10px] text-purple-300 mt-0.5">{(data.score * 100).toFixed(0)}%</div>}
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-purple-500" />
    </div>
  );
}
export const EvidenceNode = memo(EvidenceNodeInner);