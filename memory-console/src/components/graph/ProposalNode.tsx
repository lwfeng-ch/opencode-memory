"use client";
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

type ProposalNodeData = { label: string; action?: string; risk?: string; status?: string };
type ProposalNodeType = Node<ProposalNodeData>;

function ProposalNodeInner({ data }: NodeProps<ProposalNodeType>) {
  return (
    <div className="bg-amber-950/30 border border-amber-700/40 rounded-lg px-3 py-2 shadow-lg min-w-[160px]">
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-amber-500" />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-amber-400 uppercase tracking-wider">{data.action ?? "proposal"}</span>
        <span className="text-[10px] text-amber-300">{data.risk?.toUpperCase()}</span>
      </div>
      <div className="text-xs text-zinc-300 mt-0.5">{data.label}</div>
      <div className="text-[10px] text-zinc-500 mt-0.5">{data.status}</div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-amber-500" />
    </div>
  );
}
export const ProposalNode = memo(ProposalNodeInner);