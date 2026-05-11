"use client";

import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

type GraphNode = {
  id: string;
  label: string;
  node_type: string;
  slug: string;
};

type GraphEdge = {
  from_node_id: string;
  id: string;
  relation: string;
  to_node_id: string;
  weight: number;
};

type KnowledgeGraphProps = {
  edges: GraphEdge[];
  nodes: GraphNode[];
};

function nodeColor(type: string) {
  if (type === "page") {
    return "#00a7ff";
  }

  if (type === "tag") {
    return "#00c48c";
  }

  return "#ff8a3d";
}

function nodeTypeRank(type: string) {
  if (type === "page") {
    return 0;
  }

  if (type === "tag") {
    return 2;
  }

  return 1;
}

function truncateLabel(value: string) {
  return value.length > 34 ? `${value.slice(0, 31)}...` : value;
}

function degreeMap(edges: GraphEdge[]) {
  const degree = new Map<string, number>();

  for (const edge of edges) {
    degree.set(edge.from_node_id, (degree.get(edge.from_node_id) ?? 0) + 1);
    degree.set(edge.to_node_id, (degree.get(edge.to_node_id) ?? 0) + 1);
  }

  return degree;
}

function sortNodes(nodes: GraphNode[], edges: GraphEdge[]) {
  const degrees = degreeMap(edges);

  return [...nodes].sort((left, right) => {
    const typeDelta = nodeTypeRank(left.node_type) - nodeTypeRank(right.node_type);

    if (typeDelta !== 0) {
      return typeDelta;
    }

    return (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0) || left.label.localeCompare(right.label);
  });
}

function gridPosition(index: number, columns: number, startX: number, startY: number, gapX: number, gapY: number) {
  return {
    x: startX + (index % columns) * gapX,
    y: startY + Math.floor(index / columns) * gapY
  };
}

function buildFlowNodes(nodes: GraphNode[], edges: GraphEdge[]) {
  const sorted = sortNodes(nodes, edges);
  const pages = sorted.filter((node) => node.node_type === "page");
  const tags = sorted.filter((node) => node.node_type === "tag");
  const concepts = sorted.filter((node) => node.node_type !== "page" && node.node_type !== "tag");
  const pageColumns = pages.length > 12 ? 2 : 1;
  const conceptColumns = concepts.length > 28 ? 4 : concepts.length > 12 ? 3 : 2;
  const pageRows = Math.ceil(pages.length / pageColumns);
  const conceptRows = Math.ceil(concepts.length / conceptColumns);
  const tagStartY = 80 + Math.max(pageRows, conceptRows) * 112 + 80;
  const positioned = [
    ...pages.map((node, index) => ({
      node,
      position: gridPosition(index, pageColumns, 40, 80, 250, 112)
    })),
    ...concepts.map((node, index) => ({
      node,
      position: gridPosition(index, conceptColumns, 430, 80, 260, 112)
    })),
    ...tags.map((node, index) => ({
      node,
      position: gridPosition(index, 4, 430, tagStartY, 220, 90)
    }))
  ];

  return positioned.map<Node>(({ node, position }) => ({
    data: {
      label: truncateLabel(node.label)
    },
    draggable: true,
    id: node.id,
    position,
    style: {
      background: "rgba(255, 255, 255, 0.94)",
      border: `1px solid ${nodeColor(node.node_type)}`,
      borderRadius: 12,
      boxShadow: "0 10px 22px rgba(17, 24, 39, 0.08)",
      color: "#111827",
      cursor: "grab",
      fontSize: 12,
      fontWeight: 800,
      maxWidth: 210,
      padding: "9px 12px",
      width: node.node_type === "page" ? 220 : 200
    },
    type: "default"
  }));
}

function buildFlowEdges(edges: GraphEdge[], showLabels: boolean) {
  return edges.map<Edge>((edge) => ({
    animated: edge.relation !== "links_to",
    id: edge.id,
    label: showLabels ? edge.relation : undefined,
    labelStyle: {
      fill: "#64748b",
      fontSize: 10,
      fontWeight: 800
    },
    source: edge.from_node_id,
    style: {
      opacity: 0.38,
      strokeWidth: Math.min(3, Math.max(1, Number(edge.weight) || 1))
    },
    target: edge.to_node_id,
    type: "smoothstep"
  }));
}

export function KnowledgeGraph({ edges, nodes }: KnowledgeGraphProps) {
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const layoutNodes = useMemo(() => buildFlowNodes(nodes, edges), [edges, nodes]);
  const layoutEdges = useMemo(() => buildFlowEdges(edges, showEdgeLabels), [edges, showEdgeLabels]);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(layoutNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useEffect(() => {
    setFlowNodes(layoutNodes);
  }, [layoutNodes, setFlowNodes]);

  useEffect(() => {
    setFlowEdges(layoutEdges);
  }, [layoutEdges, setFlowEdges]);

  if (nodes.length === 0) {
    return (
      <div className="empty-state">
        No graph nodes indexed yet. Open the LLM Wiki and run Generate knowledge graph.
      </div>
    );
  }

  return (
    <div className="knowledge-graph-shell">
      <ReactFlow
        edges={flowEdges}
        fitView
        maxZoom={1.5}
        minZoom={0.08}
        nodes={flowNodes}
        nodesDraggable
        nodesFocusable
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        panOnDrag
        panOnScroll
      >
        <Panel className="graph-controls-panel" position="top-left">
          <strong>{nodes.length} nodes</strong>
          <span>{edges.length} links. Drag nodes to reorganize the map.</span>
          <div>
            <button onClick={() => setFlowNodes(layoutNodes)} type="button">
              Reset layout
            </button>
            <button onClick={() => setShowEdgeLabels((current) => !current)} type="button">
              {showEdgeLabels ? "Hide link labels" : "Show link labels"}
            </button>
          </div>
        </Panel>
        <Background gap={28} />
        <MiniMap nodeColor={(node) => String(node.style?.border ?? "#00a7ff").split(" ")[2] ?? "#00a7ff"} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
