"use client";
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

type MemoryNodeData = { label: string; type?: string; confidence?: number; source?: string; status?: string };
type MemoryNodeType = Node<MemoryNodeData>;

function MemoryNodeInner({ data }: NodeProps<MemoryNodeType>) {
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 shadow-lg min-w-[160px]">
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-zinc-500" />
      <div className="text-xs text-zinc-400 uppercase tracking-wider">{data.type ?? "memory"}</div>
      <div className="text-sm font-medium text-zinc-100 mt-0.5">{data.label}</div>
      <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
        {data.confidence && <span>{(data.confidence * 100).toFixed(0)}%</span>}
        {data.status === "active" && <span className="text-green-400">●</span>}
        {data.status === "archived" && <span className="text-zinc-500">○</span>}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-zinc-500" />
    </div>
  );
}
export const MemoryNode = memo(MemoryNodeInner);