"use client";
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

type ExecutionNodeData = { label: string; result?: string; timestamp?: string };
type ExecutionNodeType = Node<ExecutionNodeData>;

function ExecutionNodeInner({ data }: NodeProps<ExecutionNodeType>) {
  return (
    <div className="bg-green-950/30 border border-green-700/40 rounded-lg px-3 py-2 shadow-lg min-w-[160px]">
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-green-500" />
      <div className="text-[10px] text-green-400 uppercase tracking-wider">EXECUTION</div>
      <div className="text-xs text-zinc-300 mt-0.5">{data.label}</div>
      <div className="text-[10px] text-green-300 mt-0.5">{data.result}</div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-green-500" />
    </div>
  );
}
export const ExecutionNode = memo(ExecutionNodeInner);