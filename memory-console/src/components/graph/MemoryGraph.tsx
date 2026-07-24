"use client";
import { useState } from "react";
import { ReactFlow, ReactFlowProvider, MiniMap, Controls, Background, type Node, type Edge, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MemoryNode } from "./MemoryNode";
import { ConflictNode } from "./ConflictNode";
import { EvidenceNode } from "./EvidenceNode";
import { ProposalNode } from "./ProposalNode";
import { ExecutionNode } from "./ExecutionNode";
import { NodeInspector } from "./NodeInspector";

const nodeTypes = { fact: MemoryNode, semantic: MemoryNode, trigger: MemoryNode, episode: MemoryNode, conflict: ConflictNode, evidence: EvidenceNode, proposal: ProposalNode, execution: ExecutionNode };
const defaultEdgeOptions = { style: { stroke: "#3b82f6", strokeWidth: 1.5 }, type: "smoothstep" as const };

interface MemoryGraphProps { initialNodes: Node[]; initialEdges: Edge[]; }

function GraphInner({ initialNodes, initialEdges }: MemoryGraphProps) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  return (
    <div className="flex h-full">
      <div className="flex-1 relative">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes} defaultEdgeOptions={defaultEdgeOptions}
          onNodeClick={(_e, n) => setSelectedNode(n)} onPaneClick={() => setSelectedNode(null)}
          fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false}>
          <Background color="#27272a" gap={24} size={1} />
          <Controls className="bg-zinc-900 border-zinc-700 rounded" />
          <MiniMap nodeColor={(n) => ({ fact: "#3b82f6", conflict: "#ef4444", evidence: "#a855f7", proposal: "#f59e0b", execution: "#22c55e" })[n.type ?? ""] ?? "#71717a"}
            className="bg-zinc-900 border border-zinc-800 rounded" />
        </ReactFlow>
      </div>
      <div className="w-64 border-l border-zinc-800 flex-shrink-0 overflow-y-auto">
        <NodeInspector node={selectedNode} />
      </div>
    </div>
  );
}

export function MemoryGraph(props: MemoryGraphProps) {
  return <ReactFlowProvider><GraphInner {...props} /></ReactFlowProvider>;
}