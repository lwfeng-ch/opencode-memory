"use client";
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

type ConflictNodeData = { label: string; status?: string; claimA?: string; claimB?: string };
type ConflictNodeType = Node<ConflictNodeData>;

function ConflictNodeInner({ data }: NodeProps<ConflictNodeType>) {
  const isOpen = data.status === "open";
  return (
    <div className={`px-3 py-2 shadow-lg min-w-[160px] rounded-sm ${isOpen ? "bg-red-950/80 border-2 border-red-500" : "bg-zinc-900 border border-zinc-700"}`}>
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-zinc-500" />
      <div className="text-xs text-red-400 uppercase tracking-wider font-medium">CONFLICT</div>
      <div className="text-sm font-medium text-zinc-100 mt-0.5">{data.label}</div>
      <div className="text-[10px] text-zinc-500 mt-1">{isOpen ? "● Open" : "● Resolved"}</div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-zinc-500" />
    </div>
  );
}
export const ConflictNode = memo(ConflictNodeInner);